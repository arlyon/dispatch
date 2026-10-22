//! Read-only GitHub search, owned exclusively by the running desktop window.
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    process::Stdio,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::io::AsyncReadExt;

pub const QUERY: &str =
    "is:pr is:open -author:arlyon -review:approved -draft:true org:carpe-lab org:theadspend";
const REPO_QUERY: &str = "is:pr is:open -author:arlyon -review:approved -draft:true repo:InformaTSS/commercial-ai-sales-project";
const INTERVAL: Duration = Duration::from_secs(120);

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub url: String,
    pub repo: String,
    pub number: u64,
    pub title: String,
    pub author: String,
    pub updated_at: String,
    #[serde(default)]
    pub created_at: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeadState {
    pub url: String,
    pub read_order: u64,
    pub checking: bool,
    pub head: Option<String>,
    pub error: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceState {
    query: String,
    pub items: Vec<PullRequest>,
    pub total: Option<usize>,
    pub partial: bool,
    pub polling: bool,
    pub last_success: Option<u64>,
    pub error: Option<String>,
    pub heads: Vec<HeadState>,
    #[serde(skip)]
    head_reads: std::collections::HashMap<String, u64>,
}
impl Default for SourceState {
    fn default() -> Self {
        Self {
            query: format!(
                "{QUERY}\n{REPO_QUERY}\nExclude undismissed submitted reviews by arlyon; assignment is unrestricted."
            ),
            items: vec![],
            total: None,
            partial: false,
            polling: true,
            last_success: None,
            error: None,
            heads: vec![],
            head_reads: Default::default(),
        }
    }
}
impl SourceState {
    fn begin_head_read(&mut self, url: &str, clear: bool) -> u64 {
        let order = self.head_reads.entry(url.to_owned()).or_default();
        *order += 1;
        let order = *order;
        if let Some(head) = self.heads.iter_mut().find(|head| head.url == url) {
            head.checking = true;
            if clear {
                head.head = None;
                head.error = None;
                head.read_order = order;
            }
        } else {
            self.heads.push(HeadState {
                url: url.into(),
                read_order: 0,
                checking: true,
                head: None,
                error: None,
            });
        }
        order
    }
    fn accept_head(&mut self, order: u64, mut head: HeadState) {
        if self.head_reads.get(&head.url) != Some(&order) {
            return;
        }
        head.read_order = order;
        self.heads.retain(|previous| previous.url != head.url);
        self.heads.push(head);
    }
    fn accept(&mut self, result: Result<SearchResult, String>) {
        self.polling = false;
        match result {
            Ok(result) => {
                if result.partial && result.items.is_empty() {
                    self.partial = true;
                    self.error = Some("GitHub search incomplete; previous results retained".into());
                    return;
                }
                self.items = result.items;
                self.total = Some(result.total);
                self.partial = result.partial;
                self.last_success = Some(
                    SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs(),
                );
                self.error = None;
            }
            Err(error) => self.error = Some(error),
        }
    }
}
pub struct GitHub {
    state: Arc<Mutex<SourceState>>,
    task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    head_task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    head_wake: Arc<tokio::sync::Notify>,
    shutdown: tokio::sync::watch::Sender<bool>,
    pub(crate) opening: tokio::sync::Mutex<()>,
}
impl Default for GitHub {
    fn default() -> Self {
        Self {
            state: Arc::new(Mutex::new(SourceState::default())),
            task: Mutex::new(None),
            head_task: Mutex::new(None),
            head_wake: Arc::new(tokio::sync::Notify::new()),
            shutdown: tokio::sync::watch::channel(false).0,
            opening: tokio::sync::Mutex::new(()),
        }
    }
}
impl GitHub {
    pub fn start(&self) {
        self.start_with("gh".into(), INTERVAL);
        if let Ok(root) = crate::reviews::root() {
            self.start_heads("gh".into(), root, INTERVAL);
        }
    }
    fn start_with(&self, binary: String, interval: Duration) {
        let state = self.state.clone();
        *self.task.lock().unwrap() = Some(tauri::async_runtime::spawn(async move {
            let mut ticks = tokio::time::interval(interval);
            ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                ticks.tick().await;
                state.lock().unwrap().polling = true;
                let result = discover(&binary).await;
                state.lock().unwrap().accept(result);
            }
        }));
    }
    fn start_heads(&self, binary: String, root: std::path::PathBuf, interval: Duration) {
        let state = self.state.clone();
        let wake = self.head_wake.clone();
        *self.head_task.lock().unwrap() = Some(tauri::async_runtime::spawn(async move {
            let mut ticks = tokio::time::interval(interval);
            ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                tokio::select! { _ = ticks.tick() => {}, _ = wake.notified() => {} }
                let directory = root.clone();
                let requests =
                    tauri::async_runtime::spawn_blocking(move || crate::reviews::list(&directory))
                        .await;
                let Ok(Ok(requests)) = requests else {
                    state.lock().unwrap().heads.clear();
                    continue;
                };
                let urls: std::collections::BTreeSet<_> = requests
                    .iter()
                    .filter_map(|request| request.source.pr_url.clone())
                    .collect();
                {
                    let mut state = state.lock().unwrap();
                    state.heads.retain(|head| urls.contains(&head.url));
                    for url in &urls {
                        if let Some(head) = state.heads.iter_mut().find(|head| &head.url == url) {
                            head.checking = true;
                        } else {
                            state.heads.push(HeadState {
                                url: url.clone(),
                                read_order: 0,
                                checking: true,
                                head: None,
                                error: None,
                            });
                        }
                    }
                }
                let urls: Vec<_> = urls.into_iter().collect();
                // Only materialized requests, bounded by the existing 50-request listing.
                // Four concurrent, timed GETs; dropping this owner aborts their children.
                for batch in urls.chunks(4) {
                    let mut tasks = tokio::task::JoinSet::new();
                    for url in batch {
                        let binary = binary.clone();
                        let url = url.clone();
                        let state = state.clone();
                        tasks.spawn(async move { observe_head(&state, &binary, &url).await });
                    }
                    while tasks.join_next().await.is_some() {}
                }
            }
        }));
    }
    #[cfg(test)]
    pub(crate) async fn capture_with_progress(
        &self,
        binary: &str,
        root: &std::path::Path,
        url: &str,
        progress: impl FnMut(crate::github_snapshot::Progress),
    ) -> Result<crate::reviews::ReviewRequest, String> {
        self.capture(binary, root, url, false, progress).await
    }
    pub(crate) async fn capture_checkout(
        &self,
        binary: &str,
        root: &std::path::Path,
        url: &str,
        progress: impl FnMut(crate::github_snapshot::Progress),
    ) -> Result<crate::reviews::ReviewRequest, String> {
        self.capture(binary, root, url, true, progress).await
    }
    async fn capture(
        &self,
        binary: &str,
        root: &std::path::Path,
        url: &str,
        with_checkout: bool,
        mut progress: impl FnMut(crate::github_snapshot::Progress),
    ) -> Result<crate::reviews::ReviewRequest, String> {
        let mut order = None;
        let mut observed = false;
        let observe = |mut update: crate::github_snapshot::Progress| {
            // The actual capture metadata request shares the per-PR read order;
            // completion must never clear a genuinely later head observation.
            if update.phase == "metadata" {
                order = Some(self.state.lock().unwrap().begin_head_read(url, true));
            }
            if let (Some(order), Some(head)) = (order, update.head.as_ref())
                && update.phase == "comparison"
            {
                observed = true;
                self.state.lock().unwrap().accept_head(
                    order,
                    HeadState {
                        url: url.into(),
                        read_order: 0,
                        checking: false,
                        head: Some(head.to_ascii_lowercase()),
                        error: None,
                    },
                );
            }
            update.read_order = order;
            progress(update);
        };
        let result = if with_checkout {
            crate::github_snapshot::open_with_checkout(binary, root, url, observe).await
        } else {
            crate::github_snapshot::open_with_progress(binary, root, url, observe).await
        };
        if !observed && let Some(order) = order {
            self.state.lock().unwrap().accept_head(
                order,
                HeadState {
                    url: url.into(),
                    read_order: 0,
                    checking: false,
                    head: None,
                    error: Some("Capture metadata unavailable".into()),
                },
            );
        }
        result
    }
    pub fn wake_heads(&self) {
        self.head_wake.notify_one();
    }
    pub fn snapshot(&self) -> SourceState {
        self.state.lock().unwrap().clone()
    }
    pub fn stop(&self) {
        self.shutdown.send_replace(true);
        if let Some(task) = self.task.lock().unwrap().take() {
            task.abort();
        }
        if let Some(task) = self.head_task.lock().unwrap().take() {
            task.abort();
        }
    }
    pub(crate) fn cancellation(&self) -> tokio::sync::watch::Receiver<bool> {
        self.shutdown.subscribe()
    }
}
impl Drop for GitHub {
    fn drop(&mut self) {
        self.stop();
    }
}

// Never expose raw CLI stderr (which may contain private response data or credentials).
fn cli_error(stderr: &[u8]) -> String {
    let text = String::from_utf8_lossy(stderr).to_lowercase();
    let kind = if text.contains("rate limit") || text.contains("http 429") {
        "rate-limit"
    } else if text.contains("http 401")
        || text.contains("http 403")
        || text.contains("auth login")
        || text.contains("authentication")
    {
        "auth/permission"
    } else if text.contains("connect")
        || text.contains("timeout")
        || text.contains("resolve")
        || text.contains("network")
    {
        "network"
    } else {
        "GitHub API"
    };
    format!(
        "{kind} error; previous results retained. Check GitHub CLI access and retry on the next poll."
    )
}
pub(crate) async fn gh(binary: &str, args: &[&str], limit: u64) -> Result<Vec<u8>, String> {
    let mut child = tokio::process::Command::new(binary)
        .args(args)
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_PAGER", "cat")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| {
            "GitHub CLI unavailable; install gh and sign in using gh auth login.".to_string()
        })?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or("Missing GitHub stdout")?
        .take(limit + 1);
    let mut stderr = child
        .stderr
        .take()
        .ok_or("Missing GitHub stderr")?
        .take(64 * 1024);

    tokio::time::timeout(Duration::from_secs(45), async {
        let mut out = Vec::new();
        let mut err = Vec::new();
        tokio::try_join!(stdout.read_to_end(&mut out), stderr.read_to_end(&mut err))
            .map_err(|_| "Could not read GitHub response")?;
        if out.len() as u64 > limit {
            return Err("GitHub response exceeds the snapshot limit".into());
        }
        let status = child
            .wait()
            .await
            .map_err(|_| "Could not wait for GitHub CLI")?;
        if !status.success() {
            return Err(cli_error(&err));
        }
        Ok(out)
    })
    .await
    .map_err(|_| "network timeout; previous results retained".to_string())?
}
pub(crate) async fn api(binary: &str, endpoint: &str) -> Result<serde_json::Value, String> {
    let bytes = gh(
        binary,
        &[
            "api",
            "--hostname",
            "github.com",
            "--method",
            "GET",
            endpoint,
        ],
        16_000_000,
    )
    .await?;
    serde_json::from_slice(&bytes).map_err(|_| "Invalid GitHub JSON response".into())
}
async fn observe_head(state: &Arc<Mutex<SourceState>>, binary: &str, url: &str) {
    let order = state.lock().unwrap().begin_head_read(url, false);
    let head = read_head(binary, url).await;
    state.lock().unwrap().accept_head(order, head);
}
async fn read_head(binary: &str, input: &str) -> HeadState {
    let result = async {
        let url = crate::canonical_pr_url(input)?;
        let path = url
            .strip_prefix("https://github.com/")
            .ok_or("Invalid GitHub PR identity")?;
        let (repo, number) = path
            .split_once("/pull/")
            .ok_or("Invalid GitHub PR identity")?;
        if !approved_repo(repo) {
            return Err("PR is outside the approved source".to_string());
        }
        let value = api(binary, &format!("repos/{repo}/pulls/{number}")).await?;
        let head = value["head"]["sha"].as_str().ok_or("Missing GitHub head")?;
        if head.len() != 40 || !head.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("Invalid GitHub head".into());
        }
        Ok(head.to_ascii_lowercase())
    };
    match tokio::time::timeout(Duration::from_secs(10), result).await {
        Ok(Ok(head)) => HeadState {
            url: input.into(),
            read_order: 0,
            checking: false,
            head: Some(head),
            error: None,
        },
        Ok(Err(error)) => HeadState {
            url: input.into(),
            read_order: 0,
            checking: false,
            head: None,
            error: Some(error),
        },
        Err(_) => HeadState {
            url: input.into(),
            read_order: 0,
            checking: false,
            head: None,
            error: Some("GitHub head check timed out".into()),
        },
    }
}
struct SearchResult {
    items: Vec<PullRequest>,
    total: usize,
    partial: bool,
}
#[derive(Deserialize)]
struct SearchPage {
    total_count: usize,
    incomplete_results: bool,
    items: Vec<SearchItem>,
}
#[derive(Deserialize)]
struct SearchItem {
    html_url: String,
    number: u64,
    title: String,
    user: User,
    updated_at: String,
    #[serde(default)]
    created_at: String,
    pull_request: serde_json::Value,
}
#[derive(Deserialize)]
struct User {
    login: String,
}
#[cfg(test)]
async fn search(binary: &str) -> Result<SearchResult, String> {
    search_query(binary, QUERY).await
}

async fn discover(binary: &str) -> Result<SearchResult, String> {
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();
    let mut partial = false;
    // Separate searches keep the additional repository scoped exactly, not its whole organisation.
    for query in [QUERY, REPO_QUERY] {
        let result = search_query(binary, query).await?;
        partial |= result.partial;
        for item in result.items {
            if !item.author.eq_ignore_ascii_case("arlyon") && seen.insert(item.url.clone()) {
                candidates.push(item);
            }
        }
    }
    let mut eligible = HashSet::new();
    for batch in candidates.chunks(4) {
        let mut tasks = tokio::task::JoinSet::new();
        for item in batch {
            let binary = binary.to_owned();
            let item = item.clone();
            tasks.spawn(async move {
                let include = needs_review(&binary, &item).await?;
                Ok::<_, String>((item.url, include))
            });
        }
        while let Some(result) = tasks.join_next().await {
            let (url, include) = result.map_err(|_| "GitHub review check failed")??;
            if include {
                eligible.insert(url);
            }
        }
    }
    candidates.retain(|item| eligible.contains(&item.url));
    Ok(SearchResult {
        total: candidates.len(),
        items: candidates,
        partial,
    })
}

#[derive(Deserialize)]
struct SubmittedReview {
    state: String,
    user: Option<User>,
}
fn reviews_need_attention(reviews: &[SubmittedReview]) -> Result<bool, String> {
    let mut approvals = std::collections::HashMap::new();
    for review in reviews {
        let state = review.state.as_str();
        if !matches!(
            state,
            "PENDING" | "DISMISSED" | "COMMENTED" | "APPROVED" | "CHANGES_REQUESTED"
        ) {
            return Err("Unknown GitHub review state; previous results retained".into());
        }
        let author = review
            .user
            .as_ref()
            .map(|user| user.login.to_ascii_lowercase());
        if author.as_deref() == Some("arlyon") && !matches!(state, "PENDING" | "DISMISSED") {
            return Ok(false);
        }
        // Comments do not revoke an approval; a later opinion or dismissal does.
        if matches!(state, "APPROVED" | "CHANGES_REQUESTED" | "DISMISSED") {
            if author.is_none() && state == "APPROVED" {
                return Ok(false);
            }
            approvals.insert(author, state == "APPROVED");
        }
    }
    Ok(!approvals.values().any(|approved| *approved))
}
async fn needs_review(binary: &str, item: &PullRequest) -> Result<bool, String> {
    let mut reviews = Vec::new();
    for page in 1..=10 {
        let value = api(
            binary,
            &format!(
                "repos/{}/pulls/{}/reviews?per_page=100&page={page}",
                item.repo, item.number
            ),
        )
        .await?;
        let mut batch: Vec<SubmittedReview> = serde_json::from_value(value)
            .map_err(|_| "Invalid GitHub reviews response; previous results retained")?;
        let length = batch.len();
        reviews.append(&mut batch);
        if length < 100 {
            return reviews_need_attention(&reviews);
        }
    }
    Err("GitHub review history exceeds the check limit; previous results retained".into())
}

async fn search_query(binary: &str, query: &str) -> Result<SearchResult, String> {
    let mut items = Vec::new();
    let mut seen = HashSet::new();
    let mut total = 0;
    let mut partial = false;
    for page in 1..=10 {
        let bytes = gh(
            binary,
            &[
                "api",
                "--hostname",
                "github.com",
                "--method",
                "GET",
                "search/issues",
                "-H",
                "Cache-Control: no-cache",
                "-f",
                &format!("q={query}"),
                "-f",
                "sort=updated",
                "-f",
                "order=desc",
                "-f",
                "per_page=100",
                "-f",
                &format!("page={page}"),
            ],
            4_000_000,
        )
        .await?;
        let response: SearchPage =
            serde_json::from_slice(&bytes).map_err(|_| "Invalid GitHub search response")?;
        if page == 1 {
            total = response.total_count;
        }
        partial |= response.incomplete_results || response.total_count != total || total > 1000;
        let length = response.items.len();
        for item in response.items {
            let url = crate::canonical_pr_url(&item.html_url)?;
            let repo = url
                .strip_prefix("https://github.com/")
                .unwrap()
                .split("/pull/")
                .next()
                .unwrap()
                .to_string();
            if !approved_repo(&repo)
                || item.pull_request.is_null()
                || !url.ends_with(&format!("/{}", item.number))
            {
                return Err("Unexpected PR identity in GitHub search".into());
            }
            if seen.insert(url.clone()) {
                items.push(PullRequest {
                    url,
                    repo,
                    number: item.number,
                    title: item.title,
                    author: item.user.login,
                    updated_at: item.updated_at,
                    created_at: item.created_at,
                });
            }
        }
        if items.len() >= total || length < 100 {
            break;
        }
    }
    partial |= items.len() != total;
    Ok(SearchResult {
        items,
        total,
        partial,
    })
}
pub(crate) fn approved_repo(repo: &str) -> bool {
    repo.eq_ignore_ascii_case("InformaTSS/commercial-ai-sales-project")
        || matches!(
            repo.split('/')
                .next()
                .map(|s| s.to_ascii_lowercase())
                .as_deref(),
            Some("carpe-lab" | "theadspend")
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github_test_support::{FakeGh, page, reply};
    use serde_json::{Value, json};

    fn capture_plan(head: &str) -> Vec<Value> {
        vec![
            reply(
                json!({"title":"Pinned","base":{"sha":"a".repeat(40),"ref":"main"},"head":{"sha":head.repeat(40),"ref":"topic"}}),
            ),
            reply(
                json!({"merge_base_commit":{"sha":"a".repeat(40)},"files":[{"filename":"file.rs","status":"added"}]}),
            ),
            reply(
                json!({"truncated":false,"tree":[{"path":"file.rs","mode":"100644","sha":"e".repeat(40),"size":4}]}),
            ),
            json!({"stdout":"new\n"}),
        ]
    }
    async fn wait_for_call(fake: &FakeGh, count: &str) {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if std::fs::read_to_string(fake.directory.path().join("count"))
                    .ok()
                    .as_deref()
                    == Some(count)
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
    }
    #[tokio::test]
    async fn capture_head_order_rejects_cached_and_delayed_older_observations() {
        let github = GitHub::default();
        let root = crate::github_test_support::private_root();
        let url = "https://github.com/carpe-lab/repo/pull/42";
        let heads = FakeGh::new(vec![
            reply(json!({"head":{"sha":"c".repeat(40)}})),
            json!({"waitForRelease":true,"stdout":serde_json::to_string(&json!({"head":{"sha":"c".repeat(40)}})).unwrap()}),
        ]);
        observe_head(&github.state, &heads.binary, url).await;
        let state = github.state.clone();
        let binary = heads.binary.clone();
        let old = tokio::spawn(async move { observe_head(&state, &binary, url).await });
        wait_for_call(&heads, "2").await;
        let capture = FakeGh::new(capture_plan("d"));
        let request = github
            .capture_with_progress(&capture.binary, root.path(), url, |_| {})
            .await
            .unwrap();
        assert!(
            !old.is_finished(),
            "older C remains in flight while D is captured"
        );
        let at_capture = github.snapshot().heads[0].head.clone();
        std::fs::write(heads.directory.path().join("release"), b"go").unwrap();
        old.await.unwrap();
        assert_eq!(
            at_capture.as_deref(),
            Some(request.source.head.as_str()),
            "cached older C must not warn against captured D"
        );
        assert_eq!(
            github.snapshot().heads[0].head.as_deref(),
            Some(request.source.head.as_str()),
            "delayed older C must not replace captured D"
        );
    }
    #[tokio::test]
    async fn capture_head_order_keeps_later_verified_d_when_frozen_c_finishes() {
        let github = Arc::new(GitHub::default());
        let root = crate::github_test_support::private_root();
        let url = "https://github.com/carpe-lab/repo/pull/42";
        let mut plan = capture_plan("c");
        plan[0]["waitForRelease"] = json!(true);
        let capture = FakeGh::new(plan);
        let owner = github.clone();
        let directory = root.path().to_path_buf();
        let binary = capture.binary.clone();
        let job = tokio::spawn(async move {
            owner
                .capture_with_progress(&binary, &directory, url, |_| {})
                .await
                .unwrap()
        });
        wait_for_call(&capture, "1").await;
        let later = FakeGh::new(vec![reply(json!({"head":{"sha":"d".repeat(40)}}))]);
        observe_head(&github.state, &later.binary, url).await;
        assert!(!job.is_finished());
        std::fs::write(capture.directory.path().join("release"), b"go").unwrap();
        let request = job.await.unwrap();
        assert_eq!(request.source.head, "c".repeat(40));
        assert_eq!(
            github.snapshot().heads[0].head.as_deref(),
            Some("d".repeat(40).as_str()),
            "genuinely later D warning must survive frozen C completion"
        );
    }

    #[tokio::test]
    async fn fetches_actual_pages_with_exact_opaque_query_and_canonical_identity() {
        let fake = FakeGh::new(vec![page(101, false, 1..101), page(101, false, 101..102)]);
        let result = search(&fake.binary).await.unwrap();
        assert_eq!(result.items.len(), 101);
        assert!(!result.partial);
        assert_eq!(
            result.items[0].url,
            "https://github.com/carpe-lab/repo/pull/1"
        );
        let calls = fake.calls();
        assert_eq!(calls.len(), 2);
        for (index, args) in calls.iter().enumerate() {
            for expected in [
                format!("q={QUERY}"),
                "per_page=100".into(),
                "sort=updated".into(),
                "order=desc".into(),
                format!("page={}", index + 1),
            ] {
                assert!(args.contains(&expected), "{args:?}");
            }
            assert!(!args.iter().any(|a| a.contains("token")));
        }
    }
    #[tokio::test]
    async fn incomplete_cap_pagination_drift_and_bad_json_are_honest() {
        let fake = FakeGh::new(vec![page(0, true, 1..1)]);
        assert!(search(&fake.binary).await.unwrap().partial);
        let fake = FakeGh::new(
            (0..10)
                .map(|p| page(1001, false, p * 100 + 1..p * 100 + 101))
                .collect(),
        );
        let result = search(&fake.binary).await.unwrap();
        assert!(result.partial);
        assert_eq!(result.items.len(), 1000);
        let fake = FakeGh::new(vec![page(101, false, 1..101), page(100, false, 100..101)]);
        assert!(search(&fake.binary).await.unwrap().partial);
        let fake = FakeGh::new(vec![json!({"stdout":"invalid"})]);
        assert!(search(&fake.binary).await.is_err());
        let fake = FakeGh::new(vec![reply(
            json!({"total_count":1,"incomplete_results":false,"items":[{"html_url":"https://evil.test/carpe-lab/repo/pull/1","number":1,"title":"bad","user":{"login":"a"},"updated_at":"now","pull_request":{}}]}),
        )]);
        assert!(search(&fake.binary).await.is_err());
    }
    #[tokio::test]
    async fn page_failure_never_replaces_last_success_with_partial_or_zero() {
        for stderr in [
            "HTTP 401",
            "API rate limit exceeded",
            "network connection refused",
        ] {
            let fake = FakeGh::new(vec![
                page(1, false, 1..2),
                page(101, false, 1..101),
                json!({"stderr":stderr,"code":1}),
            ]);
            let mut state = SourceState::default();
            state.accept(search(&fake.binary).await);
            let last = state.last_success;
            state.accept(search(&fake.binary).await);
            assert_eq!(state.items.len(), 1);
            assert_eq!(state.total, Some(1));
            assert_eq!(state.last_success, last);
            assert!(state.error.is_some());
        }
    }
    #[tokio::test]
    async fn poll_is_immediate_and_window_shutdown_cancels_owned_cli_only() {
        assert_eq!(INTERVAL, Duration::from_secs(120));
        let fake = FakeGh::new(vec![
            page(1, false, 1..2),
            page(0, false, 1..1),
            reply(json!([])),
            json!({"delayMs":10000,"stdout":"{}"}),
        ]);
        let github = GitHub::default();
        github.start_with(fake.binary.clone(), Duration::from_millis(150));
        let mut shutdown = github.cancellation();
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if github.snapshot().last_success.is_some()
                    && fake.directory.path().join("count").exists()
                    && std::fs::read_to_string(fake.directory.path().join("count")).unwrap() == "4"
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
        let pid = std::fs::read_to_string(fake.directory.path().join("pid")).unwrap();
        github.stop();
        shutdown.changed().await.unwrap();
        assert!(*shutdown.borrow());
        tokio::time::sleep(Duration::from_millis(150)).await;
        assert!(
            !std::process::Command::new("kill")
                .args(["-0", pid.trim()])
                .stderr(Stdio::null())
                .status()
                .unwrap()
                .success()
        );
        assert_eq!(github.snapshot().items.len(), 1);
        assert_eq!(fake.calls().len(), 4);
    }
    #[tokio::test]
    #[ignore = "explicit bounded read-only live source proof"]
    async fn live_approved_search() {
        let result = discover("gh").await.unwrap();
        println!(
            "Live approved GitHub search: total={}, returned={}, partial={}",
            result.total,
            result.items.len(),
            result.partial
        );
    }
    #[tokio::test]
    #[ignore = "explicit live Git checkout proof; private temporary queue, no model or remote writes"]
    async fn live_real_pr_checkout() {
        let root = crate::github_test_support::private_root();
        let github = GitHub::default();
        let mut previous = "";
        let request = github
            .capture_checkout(
                "gh",
                root.path(),
                "https://github.com/InformaTSS/commercial-ai-sales-project/pull/283",
                |update| {
                    if update.phase != previous {
                        println!("Actual capture step: {}", update.phase);
                        previous = update.phase;
                    }
                },
            )
            .await
            .unwrap();
        assert!(crate::git_checkout::matches(&request.source.repo, &request.source.head).await);
        let branch = tokio::process::Command::new("git")
            .arg("-C")
            .arg(&request.source.repo)
            .args(["branch", "--show-current"])
            .output()
            .await
            .unwrap();
        assert!(branch.status.success());
        assert_eq!(
            String::from_utf8_lossy(&branch.stdout).trim(),
            request.source.head_ref
        );
        assert!(request.source.repo.join(".git").is_dir());
        let stored = crate::reviews::read_request(root.path(), &request.id).unwrap();
        assert_eq!(stored.source.repo, request.source.repo);
        println!(
            "Real checkout verified: branch={}, head={}, review_files={}",
            request.source.head_ref,
            request.source.head,
            request.files.len()
        );
    }
    #[tokio::test]
    async fn head_checks_only_materialized_prs_verify_sha_and_cancel_owned_children() {
        use crate::reviews::{self, ReviewRequest, Source};
        let root = crate::github_test_support::private_root();
        let url = "https://github.com/carpe-lab/repo/pull/42";
        let request = reviews::publish_remote(
            root.path(),
            ReviewRequest {
                version: 1,
                id: uuid::Uuid::new_v4().to_string(),
                title: "Materialized".into(),
                source: Source {
                    repo: root.path().into(),
                    base: "a".repeat(40),
                    head: "b".repeat(40),
                    base_ref: "main".into(),
                    head_ref: "topic".into(),
                    pr_url: Some(url.into()),
                },
                files: vec![],
            },
            String::new(),
        )
        .unwrap();
        let original = std::fs::read(request.source.repo.join("request.json")).unwrap();
        let fake = FakeGh::new(vec![
            reply(json!({"head":{"sha":"c".repeat(40)}})),
            json!({"delayMs":10000,"stdout":"{}"}),
        ]);
        let github = GitHub::default();
        github.state.lock().unwrap().items.push(PullRequest {
            url: "https://github.com/carpe-lab/repo/pull/43".into(),
            repo: "carpe-lab/repo".into(),
            number: 43,
            title: "Remote only".into(),
            author: "a".into(),
            updated_at: "now".into(),
            created_at: "now".into(),
        });
        github.start_heads(
            fake.binary.clone(),
            root.path().into(),
            Duration::from_secs(120),
        );
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if github
                    .snapshot()
                    .heads
                    .iter()
                    .any(|head| head.head.is_some() && !head.checking)
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(
            github.snapshot().heads[0].head.as_deref(),
            Some("c".repeat(40).as_str())
        );
        assert!(
            fake.calls()[0]
                .last()
                .unwrap()
                .ends_with("repos/carpe-lab/repo/pulls/42")
        );
        assert_eq!(fake.calls().len(), 1); // Discovery-only #43 was never checked.
        github.wake_heads();
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if std::fs::read_to_string(fake.directory.path().join("count"))
                    .ok()
                    .as_deref()
                    == Some("2")
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
        let pid = std::fs::read_to_string(fake.directory.path().join("pid")).unwrap();
        assert!(github.snapshot().heads[0].checking);
        github.stop();
        tokio::time::sleep(Duration::from_millis(150)).await;
        assert!(
            !std::process::Command::new("kill")
                .args(["-0", pid.trim()])
                .stderr(Stdio::null())
                .status()
                .unwrap()
                .success()
        );
        assert_eq!(
            std::fs::read(request.source.repo.join("request.json")).unwrap(),
            original
        );
    }
    #[tokio::test]
    async fn head_failures_or_metadata_only_are_unknown_not_sha_changes() {
        for response in [
            reply(json!({"updated_at":"newer","head":{}})),
            reply(json!({"head":{"sha":"not-a-sha"}})),
            json!({"stderr":"HTTP 401 private secret","code":1}),
        ] {
            let fake = FakeGh::new(vec![response]);
            let head = read_head(&fake.binary, "https://github.com/carpe-lab/repo/pull/42").await;
            assert!(head.head.is_none());
            assert!(head.error.is_some());
            assert!(!head.error.unwrap().contains("secret"));
        }
        let fake = FakeGh::new(vec![]);
        assert!(
            read_head(&fake.binary, "https://evil.test/carpe-lab/repo/pull/42")
                .await
                .head
                .is_none()
        );
        assert!(!fake.directory.path().join("count").exists());
    }
    #[test]
    fn errors_retain_success_and_zero_is_real() {
        let mut state = SourceState::default();
        state.accept(Ok(SearchResult {
            items: vec![PullRequest {
                url: "x".into(),
                repo: "r".into(),
                number: 1,
                title: "t".into(),
                author: "a".into(),
                updated_at: "now".into(),
                created_at: "now".into(),
            }],
            total: 1,
            partial: false,
        }));
        state.accept(Err("network".into()));
        assert_eq!(state.items.len(), 1);
        assert_eq!(state.total, Some(1));
        assert!(state.error.is_some());
        state.accept(Ok(SearchResult {
            items: vec![],
            total: 0,
            partial: false,
        }));
        assert_eq!(state.total, Some(0));
        assert!(state.items.is_empty());
        assert!(state.error.is_none());
    }
    #[test]
    fn review_filter_ignores_assignment_and_dismissed_or_pending_reviews() {
        let check = |values: serde_json::Value| {
            reviews_need_attention(&serde_json::from_value::<Vec<SubmittedReview>>(values).unwrap())
                .unwrap()
        };
        assert!(check(json!([])));
        for state in ["DISMISSED", "PENDING"] {
            assert!(check(json!([{"state":state,"user":{"login":"arlyon"}}])));
        }
        for state in ["COMMENTED", "APPROVED", "CHANGES_REQUESTED"] {
            assert!(!check(json!([{"state":state,"user":{"login":"ArLyOn"}}])));
        }
        assert!(check(
            json!([{"state":"COMMENTED","user":{"login":"other"}}])
        ));
        assert!(!check(
            json!([{"state":"APPROVED","user":{"login":"other"}}])
        ));
        assert!(!check(
            json!([{"state":"APPROVED","user":{"login":"other"}},{"state":"COMMENTED","user":{"login":"other"}}])
        ));
        for state in ["DISMISSED", "CHANGES_REQUESTED"] {
            assert!(check(
                json!([{"state":"APPROVED","user":{"login":"other"}},{"state":state,"user":{"login":"other"}}])
            ));
        }
    }
    #[tokio::test]
    async fn review_history_paginates_before_deciding() {
        let fake = FakeGh::new(vec![
            reply(json!(
                (0..100)
                    .map(|_| json!({"state":"COMMENTED","user":{"login":"other"}}))
                    .collect::<Vec<_>>()
            )),
            reply(json!([{"state":"COMMENTED","user":{"login":"arlyon"}}])),
        ]);
        let item = PullRequest {
            url: "https://github.com/carpe-lab/repo/pull/1".into(),
            repo: "carpe-lab/repo".into(),
            number: 1,
            title: "t".into(),
            author: "other".into(),
            updated_at: "now".into(),
            created_at: "now".into(),
        };
        assert!(!needs_review(&fake.binary, &item).await.unwrap());
        assert!(
            fake.calls()[1]
                .last()
                .unwrap()
                .ends_with("reviews?per_page=100&page=2")
        );
    }
    #[tokio::test]
    async fn discovery_combines_only_approved_scopes_and_checks_review_states() {
        let fake = FakeGh::new(vec![
            page(1, false, 1..2),
            reply(
                json!({"total_count":1,"incomplete_results":false,"items":[{"html_url":"https://github.com/InformaTSS/commercial-ai-sales-project/pull/2","number":2,"title":"Extra repo","user":{"login":"other"},"updated_at":"now","pull_request":{}}]}),
            ),
            reply(json!([])),
            reply(json!([])),
        ]);
        let result = discover(&fake.binary).await.unwrap();
        assert_eq!(result.total, 2);
        assert!(!result.partial);
        let calls = fake.calls();
        assert!(calls[0].contains(&format!("q={QUERY}")));
        assert!(calls[1].contains(&format!("q={REPO_QUERY}")));
        assert!(calls[0].contains(&"Cache-Control: no-cache".into()));
        assert!(approved_repo("InformaTSS/commercial-ai-sales-project"));
        assert!(!approved_repo("InformaTSS/another-repo"));
        assert_eq!(
            calls
                .iter()
                .filter(|args| args
                    .last()
                    .is_some_and(|endpoint| endpoint.contains("/reviews?")))
                .count(),
            2
        );
    }
    #[test]
    fn incomplete_empty_search_does_not_erase_previous_results() {
        let mut state = SourceState {
            total: Some(9),
            last_success: Some(1),
            ..Default::default()
        };
        state.accept(Ok(SearchResult {
            items: vec![],
            total: 0,
            partial: true,
        }));
        assert_eq!(state.total, Some(9));
        assert_eq!(state.last_success, Some(1));
        assert!(state.partial);
        assert!(state.error.is_some());
    }
    #[test]
    fn classifies_without_echoing_stderr() {
        for (input, kind) in [
            ("secret HTTP 401", "auth/permission"),
            ("secret API rate limit exceeded", "rate-limit"),
            ("secret connection refused", "network"),
        ] {
            let error = cli_error(input.as_bytes());
            assert!(error.starts_with(kind));
            assert!(!error.contains("secret"));
        }
    }
}
