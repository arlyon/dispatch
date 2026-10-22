mod agents;
mod attachments;
pub mod desktop;
mod desktop_ipc;
mod desktop_policy;
mod quiz;
mod quiz_stream;
pub mod reviews;
#[cfg(any(target_os = "macos", test))]
mod tray_indicator;
use serde_json::Value;
use std::process::{Command, Stdio};
use tauri::Manager;

fn canonical_pr_url(input: &str) -> Result<String, String> {
    let url = input.trim().split(['?', '#']).next().unwrap_or("");
    let path = url
        .strip_prefix("https://github.com/")
        .ok_or("Use a GitHub PR URL: https://github.com/owner/repo/pull/123")?;
    let parts: Vec<_> = path.trim_end_matches('/').split('/').collect();
    let valid_name = |name: &str| {
        !name.is_empty()
            && name != "."
            && name != ".."
            && name
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
    };
    if parts.len() != 4 || !valid_name(parts[0]) || !valid_name(parts[1]) || parts[2] != "pull" {
        return Err("Use a GitHub PR URL: https://github.com/owner/repo/pull/123".into());
    }
    let number: u64 = parts[3]
        .parse()
        .map_err(|_| "PR number must be a positive integer")?;
    if number == 0 {
        return Err("PR number must be positive".into());
    }
    Ok(format!(
        "https://github.com/{}/{}/pull/{number}",
        parts[0], parts[1]
    ))
}

#[tauri::command]
async fn describe_pr(url: String) -> Result<Value, String> {
    let url = canonical_pr_url(&url)?;
    tauri::async_runtime::spawn_blocking(move || {
        let output = Command::new("gh").args([
            "pr", "view", &url, "--json",
            "url,number,title,body,baseRefName,headRefName,headRefOid,baseRefOid,reviewDecision,isDraft,state",
        ]).stdin(Stdio::null()).output().map_err(|error| format!("Could not run GitHub CLI: {error}"))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
        }
        serde_json::from_slice(&output.stdout).map_err(|error| format!("Invalid GitHub response: {error}"))
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_attachment(id: String, bytes: Vec<u8>) -> Result<attachments::SavedImage, String> {
    tauri::async_runtime::spawn_blocking(move || attachments::save(&reviews::root()?, &id, &bytes))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn read_attachment(reference: String) -> Result<attachments::Image, String> {
    tauri::async_runtime::spawn_blocking(move || attachments::read(&reviews::root()?, &reference))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn list_reviews() -> Result<Vec<reviews::ReviewSummary>, String> {
    tauri::async_runtime::spawn_blocking(|| reviews::list(&reviews::root()?))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn open_review(id: String) -> Result<reviews::ReviewRequest, String> {
    tauri::async_runtime::spawn_blocking(move || reviews::read_request(&reviews::root()?, &id))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn review_result(id: String) -> Result<Option<reviews::ReviewResult>, String> {
    tauri::async_runtime::spawn_blocking(move || reviews::result(&reviews::root()?, &id))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn review_context(id: String) -> Result<Option<reviews::ReviewContext>, String> {
    tauri::async_runtime::spawn_blocking(move || reviews::context(&reviews::root()?, &id))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn file_identities(id: String) -> Result<std::collections::BTreeMap<String, String>, String> {
    tauri::async_runtime::spawn_blocking(move || reviews::file_identities(&reviews::root()?, &id))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn submit_review(
    id: String,
    feedback: reviews::Feedback,
) -> Result<reviews::ReviewResult, String> {
    tauri::async_runtime::spawn_blocking(move || reviews::submit(&reviews::root()?, &id, feedback))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn enqueue_self() -> Result<reviews::ReviewRequest, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let repo = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or("Cannot locate Dispatch source")?;
        reviews::enqueue_with_context(
            &reviews::root()?,
            repo,
            "main",
            "HEAD",
            Some(&reviews::ReviewContext {
                owner: reviews::ReviewOwner::App,
                ..Default::default()
            }),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn start_review_agent(
    app: tauri::AppHandle,
    id: String,
    agents: tauri::State<'_, agents::Agents>,
) -> Result<agents::AgentState, String> {
    if desktop::is_gui(&app) {
        return desktop::rpc(&app, desktop_ipc::Rpc::StartAgent { id }).await;
    }
    let (request, root) = tauri::async_runtime::spawn_blocking(move || {
        let root = reviews::root()?;
        let request = reviews::read_request(&root, &id)?;
        if reviews::result(&root, &id)?.is_some() {
            return Err("Archived reviews are read-only".into());
        }
        reviews::enable_reviewer(&root, &id)?;
        Ok::<_, String>((request, root))
    })
    .await
    .map_err(|e| e.to_string())??;
    agents.start(app, request, root)
}
#[tauri::command]
async fn list_review_agents(
    app: tauri::AppHandle,
    agents: tauri::State<'_, agents::Agents>,
) -> Result<Vec<agents::AgentState>, String> {
    if desktop::is_gui(&app) {
        desktop::rpc(&app, desktop_ipc::Rpc::ListAgents).await
    } else {
        Ok(agents.snapshots())
    }
}

#[tauri::command]
async fn start_quiz(
    app: tauri::AppHandle,
    id: String,
    saved: reviews::Feedback,
    quizzes: tauri::State<'_, quiz::Quizzes>,
) -> Result<quiz::QuizState, String> {
    let root = reviews::root()?;
    let request = reviews::read_request(&root, &id)?;
    quizzes.start(app, request, root, saved)
}
#[tauri::command]
async fn answer_quiz(
    id: String,
    answer: quiz::Answer,
    quizzes: tauri::State<'_, quiz::Quizzes>,
) -> Result<(), String> {
    quizzes.answer(&id, answer).await
}
#[tauri::command]
async fn end_quiz(
    id: String,
    quizzes: tauri::State<'_, quiz::Quizzes>,
) -> Result<quiz::QuizRunSummary, String> {
    quizzes.stop(&id).await
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(agents::Agents::default())
        .manage(quiz::Quizzes::default())
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                window.state::<agents::Agents>().stop_all();
                window.state::<quiz::Quizzes>().stop_all();
            }
        })
        .invoke_handler(tauri::generate_handler![
            describe_pr,
            save_attachment,
            read_attachment,
            list_reviews,
            open_review,
            review_result,
            review_context,
            file_identities,
            submit_review,
            enqueue_self,
            start_review_agent,
            list_review_agents,
            start_quiz,
            answer_quiz,
            end_quiz,
            desktop::desktop_bootstrap,
            desktop::desktop_ready,
            desktop::desktop_hide,
            desktop::desktop_checkpoint,
            desktop::desktop_checkpoint_failed,
            desktop::desktop_quit
        ]);
    if let Err(error) = desktop::run(builder, tauri::generate_context!()) {
        eprintln!("Dispatch: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normalizes_pr_links_without_expanding_hosts_or_paths() {
        assert_eq!(
            canonical_pr_url(" https://github.com/acme/repo/pull/42/?diff=split ").unwrap(),
            "https://github.com/acme/repo/pull/42"
        );
        for invalid in [
            "file:///etc/passwd",
            "https://github.com.evil.test/acme/repo/pull/42",
            "https://github.com/acme/repo/pull/0",
            "https://github.com/acme/repo/pull/42/files",
            "https://github.com/../repo/pull/1",
        ] {
            assert!(canonical_pr_url(invalid).is_err(), "{invalid}");
        }
    }
}
