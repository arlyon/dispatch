# PR polling self-host checkpoint

Review this worktree's committed **`06705d3 → HEAD`** range, not an unrelated discovered PR, for the polling implementation. The parent owns enqueue, tracked waiter and native GUI delivery; this worker has not opened Dispatch or written to the live queue. The accepted one-press save fix (`06705d3`) is the feature commit's base. Human feedback now refines post-save behavior: publish once, return to Inbox when other work or unknown source state remains, otherwise request normal guarded close.

## What to exercise now

- One neutral shared card renderer beneath subtle Local/Remote dividers. Local means materialized—including caller reviews and downloaded PRs—while Remote means not yet materialized. One canonical-URL working card per PR; history remains in Archive. Local oldest intake/pull first; Remote FIFO arrivals append without update-driven reshuffling. Any Remote can be selected. Expand **Remote source details** for the approved scopes/review policy/status/count; app-owned search is still updated-desc, immediate then every 120 seconds. No tray/daemon/notification/automatic-model side effects.
- Sources cover all repositories in carpe-lab and theadspend plus only InformaTSS/commercial-ai-sales-project. Open, non-draft PRs by others qualify regardless of assignment, unless anyone currently approves or arlyon has an undismissed submitted review. Actual review history is checked; dismissed/pending reviews do not exclude. A re-request alone does not override an undismissed arlyon review. Live Rust verification with this policy returned 22 eligible PRs, complete, without capturing diffs or publishing anything.
- Count plus repo/title/number/author/update details. CLI auth/rate/network failures retain the last successful list and show stale state; incomplete/capped pagination is partial, not a fake empty result.
- Click any Remote card: the same DOM card immediately moves to the end of Local, with natural-height vertical preparation expanding during its 300 ms travel. Peers/divider animate with bounded before/after measurements; no spacer, per-frame layout polling or JS scrolling. Real Rust metadata/base-resolution and Git clone/fetch/branch-checkout/file-read progress only. Completed steps show checks; the current operation spins. Returned files immediately replace preparation and smoothly contract to their actual tree height; review auto-selects without Ready/Open acknowledgement. No fake backend steps, simulation or completion timer.
- Capture now clones the repository, fetches the captured commits and checks out the actual named PR branch in a private per-review directory. Verify `git branch --show-current`, `git rev-parse HEAD` and checked-out files; the diff and agent cwd use this real Git repository. No user's working tree is changed, no hooks/dependencies/submodule setup run, and nothing is pushed. Old file-only entries upgrade on card selection without overwriting their immutable request or feedback. Existing pending duplicate recovery preference and same-revision reuse remain. Reviewer/Quiz are explicit opt-ins.
- Local/caller reviews, Archive, source comments, draft summary, read markers and quiz scope survive source refreshes and navigation. A late capture cannot replace newer navigation or an active quiz.
- Final summary names its exact feedback target: local repo/range or owner/repo #number and short pinned head. Saving publishes once; other pending reviews/remote candidates or non-authoritative state return to Inbox without automatic capture/model work. Confirmed no-other-work requests normal guarded close; explicit Cmd-S with no active review still closes normally. Existing error/quiz/cached-note guards remain.
- Only verified actual SHA differences on materialized Local PRs show the small amber **Branch has changed** icon. Hover/focus/click opens Refresh on that same card. The Rust app checks only existing materialized requests (initially/every 120 seconds and after capture), with four concurrent bounded GETs; no Remote head checks. Failed/unknown/checking state never claims freshness or authorizes false-empty close. Timestamps never imply drift. Captured B stays B if C appears; a later C warning survives B completion when appropriate. No new head version picker or global freshness banner.
- Ordinary different-review navigation preserves drafts without a Finish-notes requirement. A same-PR changed-head selection with unsent notes is guarded before capture and again before changed-head opening, including text typed during capture. Notes/results remain on their original immutable request; no semantic rerouting. No keyboard card-navigation shortcuts (Todo #9 remains deferred).
- Close the real main window/process: owned search, head-check and capture subprocesses stop; unrelated Ferropi session history/work remains untouched. No separate keepalive/tray/daemon.

## Evidence and remaining acceptance

- Bounded live read-only search through the Rust provider returned **9 total / 9 items / not partial** during implementation. No live PR diff/blob was fetched, no live review was queued, and no model was started. An additional metadata-only check confirmed a captured head SHA resolves through GitHub's non-recursive tree endpoint (37 root entries, not truncated).
- A headless Inbox render of that live search response displayed all 9 rows. This used mocked IPC; it is not native GUI proof. The new browser regression uses an own-source diff and mocked source/capture IPC; fake-gh Rust tests exercise real subprocess argument/JSON boundaries, pinned blob capture, same/new revisions and shutdown.
- `mise run setup`, `mise run fix`, `mise run check`, `mise run build`, the PR browser regression and existing comment/quiz/save-shortcut browser regressions passed. Original feature evidence is in `/tmp/dispatch-pr-polling-report.md`; integrated validation is in `/tmp/dispatch-pr-polling-report.7d3a383c.md`; the subsequent human-feedback refinement is recorded in `/tmp/dispatch-pr-polling-report.7d3a383c.d958b2ac.md`.
- Approved flow production UI evidence (mocked IPC) and real Rust fake-gh head/progress/cancellation tests are in `/tmp/dispatch-pr-polling-report.7d3a383c.d958b2ac.03fac2f0.33eb3470.md`. Screenshots/timings are from real App/Inbox, not the throwaway prototype. This amendment has no new live GitHub/native/model evidence. The earlier P1 shared read-freshness fix was independently cleared and remains covered.
- Live real-checkout proof passed for InformaTSS/commercial-ai-sales-project #283: actual branch CAI-442/detect-deleted-mailboxes at 7b5a902c570cc57f016d9eefb97d7f1cb38e5c54, 35 Git-derived review files, in 12.6 seconds. This used a private temporary queue, no model, no GitHub writes, no project scripts or live services. Log: /tmp/dispatch-real-checkout-live.log. Native animation perception still needs human verification.
- Honest limits: search cap 1,000 per scope; binary/non-blob/>1 MB-per-side previews explicitly unavailable; >24 MB captures rejected. File lists now come from Git rather than the comparison API cap. gh must be on the launch PATH with existing auth. Source results are memory-only; immutable selected reviews persist through the existing queue boundary.

### Parent's native acceptance checklist

- [ ] Build this branch (save-and-close fix already integrated), and enqueue this project's committed range with a tracked waiter.
- [ ] Launch via `mise exec -- target/debug/bundle/macos/Dispatch.app/Contents/MacOS/dispatch` with the parent's existing private queue/native Pi launch environment; do not replace old snapshots.
- [ ] Confirm live source count/details/status, initial arrival and the next 120-second update in the native app.
- [ ] Select a middle/last Remote card; verify same neutral DOM card moves to Local's end, preparation expands during travel, peers/divider move, and real files appear/contract/select immediately. No extra Open/Ready, fake stages or paid work. Check reduced motion and different file counts.
- [ ] Verify Local materialization/FIFO order survives updates, source arrivals append, and no live/downloaded duplicate row appears. Inspect real pinned diff/guide, unavailable previews and Archive history.
- [ ] Verify amber icon only for actual materialized-head changes; no timestamp/failure/Remote warning. Hover/focus/click Refresh on same card; preserve B if C appears, drafts during work and newer navigation/quiz ownership. Save or explicitly discard anchored old-head notes before changing that PR's code.
- [ ] Keep a local draft and selected snapshot while the source updates; check manual review/Archive navigation and explicit Quiz/reviewer behavior.
- [ ] Verify the Final summary target before saving. With other work, save once and remain in Inbox without automatic captures/reviewers; with confirmed no other work, save once and close after publication. Unknown/stale source must keep the UI safe; explicit Cmd-S with no active review still uses normal close guards.
- [ ] Close the real window after normal guards permit; verify gh polling stops, no new process/tray survives, and unrelated Pi sessions/history remain intact.

---

# Prior quiz mode self-host checkpoint

Review **`ae7e273 → HEAD`** in this repository/worktree. This branch implements the smallest native quiz loop on top of the shared Dispatch/Ferropi workspace. It does not implement PR discovery, a grading engine, terminal forks or remote publishing.

## What changed / why

- **Quiz me** starts context-only native initialization when needed, waits for settled source history, then uses Ferropi's ordinary Pi fork. Full Pi review is not a prerequisite.
- Quiz temporarily replaces the right bar. Original Chat DOM, drafts and scroll stay underneath; the diff stays interactive. Done restores the panel without rolling back source comment edits.
- The child exposes exactly the trusted model-only `present_question` and `report_assessment` tools. Answer carries a choice and/or explanation through a supported native RPC dialog to a real tool result; Pi then explains and continues/finishes. Final feedback stays until Done.
- Assistant feedback now genuinely streams from Pi 1.3 delta-only RPC records; authoritative block/message finals replace partial text without duplication. Emissions are coalesced, and partial tool arguments show only a preparation status until a full validated question/dialog exists.
- Successful native answers anchor cards in an ordered text/answer transcript before any subsequent streamed feedback. Assessments patch the same card in place; earlier introduction/turn text keeps its chronological position.
- Each answer gets an explicit agent-reported Pass/Fail reason card in Quiz only. The report must reference the actual answered question tool ID; unknown, pending, duplicate and stale IDs are rejected. Missing reports stay Not assessed. No prose-derived verdict, numeric/overall score or review-feedback inclusion.
- Done/End appends one compact **run summary** at the end of main conversation content (after existing review/agent/draft content, before the persistent Another pair of eyes offer). Only confirmed explicit Pass/Fail counts and nonzero Not assessed are shown, with Ended early when relevant. The authoritative Rust end response crosses a task-cancellation barrier so delayed UI events cannot lose or invent confirmed counts. Each run is deduped by ID and scoped to its review/head; multiple runs stay chronological. Summaries are memory-only UI, not parent-agent turns/history or human feedback. Off-bottom scroll remains in place; already-at-end Chat follows the new summary without focusing anything.
- Startup invalidates in-flight review navigation and captures saved context before awaits, so a delayed B load cannot replace A underneath A's quiz.
- The styled End control is quiet with a destructive hover; Done is the clear primary completion action. End confirms pending answer loss and cancels quiz work only. A fresh source initialization settles independently, releases its lease, and cannot start a late fork. Existing parent sessions/reviews remain unchanged.
- Unfinished source composers and unsubmitted summary text are excluded from quiz context. Saved comments, thread updates, opening context and pinned scoped source are included. Quiz answers never become review feedback automatically.
- Older daemons lacking explicit child-profile/UI-reply capabilities fail closed. Do not kill another worktree's daemon to work around this; detach/restart it through its owner or use isolated state for tests.

## Evidence and limits

Automated validation covers Rust/fake transport ownership/routing, actual Pi 1.3 with a deterministic loopback provider and shipped extension, browser IPC-mocked quiz lifecycle and the existing comment regression, full workspace gate and native build. The loopback fixture is **not live-model proof** and the browser harness is **not native GUI proof**. See the implementation report for any additional bounded live-model evidence.

The parent consumed native-GUI feedback for `293f9e9` (streaming/verdicts/End styling) and `b8a9458` (chronological feedback plus a compact main-Chat run summary, illustrated by the supplied screenshot). This latest amendment has **not** yet received human/native-webview validation. No native GUI has been opened by the implementation worker; the previous immutable review/window remain untouched. Tool restrictions are not an OS sandbox; the trusted extension runs with Pi's normal permissions. Drafts and quiz UI are not durable. Snapshot source retains the 96 KB reviewer budget and supported-type filter.

## Launch and acceptance

```sh
mise run build
FERROPI_BIN="$PWD/target/debug/ferropi" \
PI_BINARY=/absolute/path/to/pi \
  target/debug/bundle/macos/Dispatch.app/Contents/MacOS/dispatch
```

The parent orchestrator owns enqueue → registered tracked non-LLM waiter → GUI launch → consume submitted result. Do not open older windows or mutate previous reviews.

- [ ] Quiz me on the new own-source request without first requesting a full review.
- [ ] One question, model choices and optional explanation; empty Answer disabled.
- [ ] Answer cards appear before subsequent feedback at every streaming update; introduction and multiple turns retain chronological order, and assessment changes patch the same card.
- [ ] Assistant feedback grows progressively and reconciles finals without repeated text. Question preparation never exposes raw argument JSON or enables Answer early.
- [ ] Answer yields an explicit agent-reported Pass/Fail plus short reason, explanation and next question/final takeaways in the same fork. Missing verdicts stay Not assessed; cards exist only in Quiz.
- [ ] A delayed navigation to B cannot replace A while Quiz A starts; End then navigation to B works.
- [ ] Valid source links navigate the pinned snapshot; source remains editable and retains typing/caret during events.
- [ ] Edit/save a source comment during quiz; Done restores original Chat nodes, drafts, scroll and updated review data.
- [ ] Done/End appends exactly one compact run summary after all regular main Chat content and immediately before the bottom Another pair of eyes offer when available, with confirmed Pass/Fail/Not assessed counts and an honest ended-early marker. Check multiple runs/review isolation and appropriate off-bottom/at-bottom scroll. No source-agent turn is started.
- [ ] Final takeaways stay until Done. End confirms discarding choice/text; cancellation preserves the parent.
- [ ] End during fresh initialization returns immediately, initialization settles without a late question, and another quiz can then start.
- [ ] Submit explicit review feedback with **⌘S / Ctrl-S**. Only review feedback reaches the tracked waiter, never quiz answers, verdicts or run summaries.
