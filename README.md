# Dispatch

One Git repository and Cargo workspace:

- `src-tauri/` — **Dispatch**, the Tauri desktop review client and review CLI.
- `crates/ferropi/` — **Ferropi**, the native Pi daemon/library.
- `crates/pi-rpc/` — **ferropi-pi-rpc**, the native Pi RPC transport crate.

The desktop and daemon retain separate responsibilities and processes, not separate repositories. See [Ferropi's guide](crates/ferropi/README.md) for its CLI, native sessions and protocol.

The first self-hosting milestone is deliberately local: snapshot this branch, inspect highlighted diffs, collect line comments and explicitly submit feedback to the requesting agent. App-owned reviews start a tool-free native Pi reviewer through Ferropi. Caller-owned reviews are difit-style by default, with one-click opt-in to an independent reviewer. Automatic PR stack discovery is not wired yet.

For the current in-app self-review, see [REVIEW-GUIDE.md](REVIEW-GUIDE.md): the pinned review to open, verified behavior, known blockers, and the manual acceptance checklist.

## Run

```sh
mise trust
mise run setup
mise run dev
```

`mise run build` builds a debug desktop and its `ferropi` / `dispatch-review` companions. On macOS it creates `target/debug/bundle/macos/Dispatch.app`; on Linux it creates an RPM under `target/debug/bundle/rpm/`. The unpackaged Linux executable is `target/debug/dispatch`. Choose **Review Dispatch** to snapshot the build's source checkout from `main` to committed `HEAD` (this source-checkout shortcut is for local development, not installed release builds).

### Linux and native Wayland

Linux needs a C/C++ build toolchain, GTK 3 and WebKitGTK 4.1 development libraries. Packaging AppImages also needs `patchelf`; running AppImages may require FUSE 2. The CI workflow lists the Ubuntu 24.04 packages. On Fedora the corresponding development packages include `gtk3-devel`, `webkit2gtk4.1-devel`, `openssl-devel`, and `librsvg2-devel`.

GTK selects the display backend normally. To require native Wayland with no XWayland fallback after building:

```sh
env -u DISPLAY GDK_BACKEND=wayland target/debug/dispatch
```

Use `mise run package` for optimized release installers: **DEB, RPM and AppImage** on Linux x86-64, or **APP and DMG** on macOS (CI builds Apple Silicon). Artifacts are under `target/release/bundle/`. The build stages a target-suffixed Ferropi executable in ignored `src-tauri/binaries/`; Tauri includes the review CLI from its own crate. No cross-compilation is implied. Bundled companions remain separate processes. Dispatch prefers `FERROPI_BIN`, then `ferropi` beside its own executable, then `ferropi` on `PATH`. Pi itself is not bundled: install it separately and keep `pi` on the desktop's `PATH`, or set `PI_BINARY`.

### Resident tray and background delivery

Dispatch keeps one resident tray per private review queue and at most one separate review-window process. Closing the window hides it. It stays warm for 30 continuously hidden minutes, then checkpoints draft text and navigation into the resident Rust process before exiting the GUI and WebKit helpers. Reopening cancels the timeout. Missing, invalid or timed-out checkpoint acknowledgements keep the GUI alive and expose an error. These checkpoints are memory-only, not crash-safe draft persistence.

`dispatch --bg` starts only the tray. `dispatch-review REPOSITORY BASE HEAD --bg` publishes an immutable request without showing or focusing the window or extending its hidden timer. It can be combined with `--wait`; attaching with `dispatch-review wait REVIEW_ID` still creates nothing. Normal delivery opens the review. Desktop launch failures go to stderr without losing the queued request or changing JSON stdout.

New background reviews can produce a native notification. An unseen arrival adds a large pink-red badge to the bird's bottom-right; showing Dispatch acknowledges that badge. On macOS the monochrome bird slides aside to reveal the total unfinished review count already in the inbox, regardless of local/remote source. The count remains after acknowledgement and disappears when all reviews complete. The slide is a bounded transition on count changes, not a repeating animation. Remote PR discovery remains separate work. Tray clicks use the Open/Hide/Quit menu; the exact tray-host presentation varies.

Explicit **Quit Dispatch** requires submitting or explicitly discarding unsubmitted feedback. Do not force-quit the resident process to reclaim the GUI: that loses its memory-only checkpoints and stops its agent clients.

### CI and releases

GitHub Actions checks and packages Linux x86-64 and macOS ARM64 for pull requests, manual CI runs, and every `main` push through the release workflow. CI installers are retained for 14 days. Ordinary macOS CI builds are ad-hoc signed and may be blocked by Gatekeeper. Releases require a separate Developer ID signed/notarized macOS artifact before publication; missing credentials fail closed. Provisioning, the `production` signing environment and a non-publishing manual verification run are described in [macOS signing](docs/macos-signing.md). Existing releases are not retroactively re-signed. Windows packaging is not supported yet because Ferropi uses Unix sockets.

`release-plz.toml` uses git-only versioning: nothing is published to crates.io. Release-plz maintains a release PR and changelog; merging that PR permits release creation. Cargo's workspace version is authoritative; `scripts/sync-version.mjs` copies it to `package.json`, and Tauri reads that file. The three Rust packages share a release version group, with companion tags and one Dispatch GitHub release (`vX.Y.Z`). Because release-plz compares Cargo package files, `mise run fix` also refreshes the tracked `src-tauri/frontend.sha256` fingerprint of frontend/build inputs. Include that file with UI changes; `mise run check` rejects a stale fingerprint so frontend-only changes cannot silently miss a release. Version-only bumps are excluded from the fingerprint.

Repository administrators must allow **GitHub Actions to create and approve pull requests** in Actions settings (the workflow only creates/updates PRs; it does not approve or merge them). No PAT or crates.io token is required. Release jobs receive narrowly scoped write permissions; ordinary CI is read-only. The generated release PR is explicitly sent through CI using `workflow_dispatch`, because PR/push events made with `GITHUB_TOKEN` do not trigger workflows.

A release starts as a draft, receives all four installer formats and `SHA256SUMS`, then becomes public. Packaging runs in the same workflow before release-plz, rather than depending on a bot-created tag starting another workflow. To recover an interrupted upload/publication, manually run **Release** with the existing draft's `tag`: it rebuilds that tag, replaces draft assets and publishes only after every format is present. It refuses to overwrite an already public release. To roll back a broken release, an administrator can mark it as a draft; fixes should ship in a new version. No workflow auto-merges release PRs.

On macOS the native traffic lights overlay the 48px app bar instead of occupying a separate title strip. Space is reserved for them; the app-bar background/title can drag the window. Buttons remain interactive, native controls/close guards remain native, and other platforms retain their normal decorations.

Snapshots exclude uncommitted changes: commit first. Git resolves both revisions to immutable commit IDs. Renames currently appear as deletion/addition pairs. Binary, non-blob and oversized entries have an explicit unavailable preview. The viewer uses CodeMirror 6 merge, lazy language grammars and viewport rendering.

**Comment placement** defaults to Auto: beside the code when space permits, collapsible below-line threads when narrow. Override with Inline, or Beside where there is enough room. Below-line hints slide their thread open when clicked; clicking source opens and focuses an animated composer at that line. Sidebar links open the same thread. Switching placement keeps drafts. SVG chevrons avoid text-glyph baseline issues; rendered Markdown uses normal HTML whitespace so serializer newlines do not add empty lines below messages.

Click source text or a new-side line number to compose a comment; drag line numbers for a range. Optional `endLine` is validated against the immutable source and preserved in feedback. Old-side gestures are best tested in Split view. All messages on an exact file/side/line share one thread; replies appear underneath the original in Chat and source. Threads can be resolved, dismissed, reopened and inspected. Open threads use the original yellow line and trailing blame-style preview rather than a dot. The whole Reviewed control is clickable: marking the diff read collapses its file. Reopen it using the filename or a comment/source link without clearing Reviewed; marking unread expands it. Reviewed headers use a green tint and green filename/control; Reviewed remains a read marker, not approval. Navigation and expansion animate, respecting reduced-motion preferences. Normal floating cards shift within their attached line/range bounds without a scroll opacity fade. Offscreen neighbours use a deliberate exception: the real cards peek into the viewport edges and overlap as a stack, retaining the very same DOM/content as they arrive. There are no substitute preview cards. Click a peeking card to jump to it. **Peek stack** in the fixed topbar chooses 1–5 real neighbours per edge (default 1, session-only). Previous peeks reveal the actual card and body instead of translating a header inside a cropped rectangle. Their corners mirror the bottom peeks: square against the top viewport edge, rounded underneath; bottom peeks round above and meet their viewport edge squarely. Peeks use only space left by the entire current card, including its footer; they never cover it. Strips enter progressively as room opens, flush with viewport edges. Flowing cards keep stable document coordinates in the workspace; viewport-pinned cards use fixed positioning, so neither requires per-frame counter-scrolling. Source geometry is cached during scrolling and refreshed after it settles. There is no scroll tween or per-scroll awaited placement. Wheel scrolling over a portalled card consumes its inner scroll space first, then chains remaining movement to the source workspace. Click the same line again to deselect its editor without losing typed text. Save replies with ⌘Enter/Ctrl-Enter or Save reply. Pen/trash icons edit or remove your unsent comments; edits replace the original message and Cancel keeps the saved original. Agent comments and completed feedback remain read-only. **⌘S/Ctrl-S submits the active review and requests normal window close after publication succeeds**, matching the topbar action. The resident then hides the GUI while preserving other drafts; unfinished replies or failed submission never close it. A post-publication close failure does not resend feedback on retry. With no review or a completed read-only view, the shortcut requests close without publishing. Active quiz/startup blocks hiding and retirement until the quiz ends; it is never silently ended by the shortcut. Cancel confirms before discarding nonempty drafts. Save or discard unfinished replies/comments before submitting. Summary is optional; finishing without comments is explicit. Drafts remain in memory across file/review navigation and are checkpointed into the resident process before GUI retirement. Closing hides the window; explicit application quit is blocked until unsubmitted feedback is submitted or explicitly discarded. Force quitting the resident still loses drafts.


## Agent handoff

Build the enqueue/wait CLI:

```sh
mise exec -- cargo build -p dispatch --bin dispatch-review
```

Queue any local committed range and optionally wait for human feedback:

```sh
mise exec -- target/debug/dispatch-review /absolute/path/to/repository main HEAD --wait
```

The CLI prints its review ID to stderr, and the completed result JSON (including the final summary) to stdout. Without `--wait`, it prints the immutable request JSON and exits.

### Actually wait for human feedback

Waiting must be a tracked async command, not an untracked shell process or an assertion that the GUI is open. Attach to an existing request without creating another review/session:

```sh
mise exec -- target/debug/dispatch-review wait REVIEW_ID
```

The command stays running until the result is published, then returns it as JSON and exits successfully. Attaching after completion returns the existing result immediately. `--wait` on the enqueue command combines snapshot creation and waiting when an async process runner can launch it directly.

For Pi's non-LLM external-command runner, this project includes `.pi/agents/dispatch-feedback.md`. Launch `dispatch-feedback` with this worktree as `cwd`, `async: true`, and a task containing one line `DISPATCH_WAIT={"id":"REVIEW_ID"}`. Optional `directory` selects a custom private queue. This runs `scripts/wait-feedback.cjs` → the CLI, not another Pi/model session. The harness registers the job and wakes the calling agent on exit with stdout and result artifacts.

Required caller flow: **enqueue → register async wait → open the review → yield → consume the completed feedback**. Do not tell the human you are waiting unless a waiter is actually registered. Read the canonical result after notification if the harness truncates a large stdout payload. Closing the GUI is not a substitute for submitting feedback. The GUI polls the queue and does not need a GitHub URL.

Requests live in the user's local data directory under `dispatch/reviews/<UUID>/request.json`; explicit submission atomically publishes a separate `result.json` with `status: "complete"`. `DISPATCH_REVIEW_DIR` can select the shared queue directory for both processes; on Unix it must be private (0700). Rust validates the v1 shape, review identity, snapshot head and comment file/line boundaries. Completion cannot overwrite an earlier result. This initial slice does not yet publish JSON Schemas or support subsequent feedback rounds on the same request.

Feedback is a local flush, not a GitHub review or approval. Optional `feedback.threadStates` records explicit `{path, side, line, state}` updates (`open`, `resolved`, `dismissed`); Rust validates their snapshot anchors and older results without the field remain readable. Pi quiz/terminal forks and agent findings are not included in the human-feedback payload.

## Review agents

### Caller-provided guide and comments

Pass `--context /absolute/path/context.json` when enqueuing. Context is validated against the immutable snapshot and published before the request becomes visible:

```json
{
  "owner": "caller",
  "guide": "What changed, what works, known limitations, and what to test.",
  "comments": [
    { "path": "src/App.tsx", "side": "new", "line": 1, "body": "An opening-agent note for the reviewer." }
  ]
}
```

The guide appears at the top of Chat and has a **Review guide & context** shortcut above the diff. Anchored comments appear as **Agent** notes in Chat and the source gutter. They are never pre-filled into the human summary or feedback payload. The 256 KiB optional `context.json` lives beside the immutable request/result, not inside a Pi session. Untrusted guide text is rendered as sanitized Markdown, never executed as script.

### Reviewer ownership and recovery

The desktop launches `ferropi mount`, not Pi directly. Builds made through mise include Ferropi beside the desktop executable. Set `FERROPI_BIN` to an absolute executable path to override that companion, and `PI_BINARY` to the Pi executable when it is not on the desktop process's PATH. **Review Dispatch** creates an app-owned review and starts its reviewer automatically. CLI callers default to caller-owned: no reviewer is started until **Start Pi reviewer** is clicked. Opt-in persists for that review. An enabled reviewer uses `reviews/<UUID>/agent.jsonl`; reopening a successful report hydrates native Pi history rather than running it again. **Retry Pi review · same session** restarts failed attempts without deleting history. Session identity is still per request UUID; stable PR identity across separate enqueues/revisions is unfinished.

The first reviewer receives only supplied source snapshots, with a 96 KB source-text budget. Binary/unavailable entries, lockfiles and unsupported file types are omitted and the scope is visible in Chat. Pi tools, MCP, extensions, skills, prompt templates and context-file discovery are disabled; the model cannot read other files, run tests, edit code or publish anything. Its report is static analysis, not verified test results.

Reports stream into Chat. Structured findings are checked against the immutable file/line boundaries before becoming clickable source links. Human submission remains independent: agent findings are never silently included in the feedback result. The initial agent does not automatically apply human feedback or edit code.

The resident tray process owns its Ferropi mounts. Hiding or retiring the separate GUI does not cancel those agent clients. Quitting the resident cancels its client tasks and closes their pipes; Ferropi then releases the corresponding session leases. Pi's native session history remains on disk. Failed/interrupted model work can be retried in the same native session. This is a fresh model attempt using preserved history, not durable replay of interrupted execution. Transport/provider failures remain visible.

## Quiz mode

Click **Quiz me** in Chat. It initializes source context if needed (no full-review prerequisite), waits for settled native history, and forks through Ferropi. The quiz temporarily replaces only the right bar; the diff remains interactive and original Chat DOM/drafts/scroll stay underneath. Choose an option and/or enter an explanation, then **Answer**. Pi receives a real native tool result, explains, and asks another question or finishes. Final takeaways remain until **Done**. **End quiz** confirms discarding pending choice/text; returning never rewinds review edits.

The fork receives pinned scoped source, native history, opening context and explicitly saved review comments/thread updates—not unfinished line composers or the unsubmitted final-summary textbox. Answers do not become review feedback. Only the shipped `present_question` and `report_assessment` extension tools are enabled for the child; the parent remains tool-free. This is not an OS sandbox. Older Ferropi daemons must support child-only options and one-way UI replies or quiz startup fails closed. A fresh source initialization settles independently even if its quiz ends; no late fork is created.

Assistant feedback streams from Pi's real delta-only RPC events, with authoritative final-message reconciliation rather than simulated typing. Question preparation is read-only until a complete validated question and native dialog arrive. Each answer can receive an explicit agent-reported **Pass / Fail** card and short reason in the quiz conversation only. Missing verdicts remain **Not assessed**; Dispatch never infers them from prose or choices, and there is no numeric/overall score. End quiz is a quiet control with destructive hover; Done is the primary completion action. Answer cards are anchored at successful native answers in an ordered text/answer transcript, so later streamed explanations follow the right card rather than appearing above it. Returning with Done or End appends one compact run summary at the end of main conversation content, before the persistent Another pair of eyes offer: confirmed Pass/Fail counts, nonzero Not assessed, and Ended early when applicable. Summaries are memory-only, scoped to the owning review/snapshot, and never injected into the source-agent history or human review feedback.

See [the feature contract](docs/features/quiz-mode/prd.md), [test commands](docs/features/quiz-mode/execution-plan.md) and [native GUI checklist](REVIEW-GUIDE.md). Quiz UI/drafts are memory-only; native Pi still owns session persistence. Run `PI_BINARY=/absolute/path/to/pi mise exec -- node tests/quiz.native.cjs` for the actual Pi/extension loop with a deterministic loopback provider, not an external live model. `tests/quiz.browser.cjs` takes an own-source request JSON and mocks IPC.

## Markdown and pasted images

The guide and Change details use animated disclosure panels; the guide is rendered with Marked and DOMPurify. Raw active HTML, form controls, script handlers and unsafe image protocols are blocked. HTTPS Markdown images render inline with lazy loading and no referrer; image links can render as thumbnail chips. Remote image loading makes network requests, as explicitly approved. Non-attachment links copy their address rather than navigating the desktop app away.

Paste a PNG/JPEG/GIF/WebP (at most 8 MiB) into a reply or Final summary to save it in the private review's `attachments/` directory and append a local Markdown link and advance the focused textbox's caret beyond it, without stealing focus if you moved elsewhere. Chat and source expose thumbnail chips with a larger click-to-preview image. Rust generates filenames, validates signatures and confines reads to real review attachment files; SVG/HTML and arbitrary file reads are rejected. Completed reviews permit image reads, not new writes. Image files persist; unsent draft text remains memory-only. Feedback carries the image link, never binary data or an external upload.

## Checks

```sh
mise run fix
mise run check
```

An optional browser regression is in `tests/comments.browser.cjs`. It requires an existing Playwright module, Chrome, and the built `dispatch-review` CLI. Run it with `mise exec -- node tests/comments.browser.cjs`; `PLAYWRIGHT_MODULE` can point to an existing module directory. It snapshots this repository into a temporary private queue and mocks native IPC; it never submits to the live queue or starts a real Pi session. It checks real typing/caret retention across polling, wide/inline layouts, same-line draft-preserving deselection, attached-card geometry/no scroll fade, same-node real-card peeks and adjustable stack depth without duplicate DOM, nested wheel chaining, comment editing/cancellation/removal, Reviewed label/collapse/reopen, sanitized HTTPS images without referrers, local image thumbnails, global ⌘S submission and unfinished-draft guards, ranges, payload isolation, safe failure/retry, caching and Archive. The ordinary gate also runs pure geometry tests matching the drawing, anchor bounds and continuous movement.

Read-only GitHub context loading exists behind a native command, but is not a prerequisite for local self-review. No PRs are created, updated, approved or commented on by this app.

## Next milestones

Quiz mode is implemented as a working slice, pending native GUI/human acceptance. The remaining agreed delivery order is:

1. PR sources and polling in Rust.
2. Interactive in-app agents (beyond the existing static review/retry).
3. Fork-to-terminal for native agent sessions.
4. Linear / Confluence context.

End-to-end acceptance closes this MVP; the wider prototype gaps below are not an additional automatic feature backlog. Source selection, daemon ownership and integration credentials still need to be confirmed before their respective implementations.

## Remaining from the recorded prototype requirements

The local immutable snapshot → native review → explicit result → tracked CLI wake loop works. Native Pi review/retry and Ferropi native fork interoperability work; smooth cards were verified in the native UI. Beyond the current title-bar/inline polish, the major gaps are:

- Live GitHub PR/watch/stack discovery, discussions and linked Jira/Linear content in the UI; the mockup's context was illustrative.
- Stable logical review identity across revision UUIDs, follow-up rounds, stack-range choice and true revision interdiffs.
- Draft persistence beyond process lifetime and automatic tool discovery/Finder-ready packaging without launch environment variables.
- Interactive agent conversation/apply-feedback workflow and terminal-fork UI; the quiz fork is a separate narrow interaction, not a general agent chat.
- Inbox filtering to live watches/actively waiting callers rather than all unfinished disk requests, and published JSON Schemas for the handoff.
- Ferropi Windows transport; the current daemon uses Unix sockets.

This is a comparison against the mockup behavior notes and recorded requirements, not a claim of a separate exhaustive formal PRD audit. These gaps are not silently included in the current UI task. Remote writes still require explicit authorization.
