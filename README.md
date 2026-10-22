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

`mise run build` builds `target/debug/ferropi` and creates `target/debug/bundle/macos/Dispatch.app`. Open it and choose **Review Dispatch** to snapshot the build's source checkout from `main` to committed `HEAD`.

On macOS the native traffic lights overlay the 48px app bar instead of occupying a separate title strip. Space is reserved for them; the app-bar background/title can drag the window. Buttons remain interactive, native controls/close guards remain native, and other platforms retain their normal decorations.

Snapshots exclude uncommitted changes: commit first. Git resolves both revisions to immutable commit IDs. Renames currently appear as deletion/addition pairs. Binary, non-blob and oversized entries have an explicit unavailable preview. The viewer uses CodeMirror 6 merge, lazy language grammars and viewport rendering.

**Comment placement** defaults to Auto: beside the code when space permits, collapsible below-line threads when narrow. Override with Inline, or Beside where there is enough room. Below-line hints slide their thread open when clicked; clicking source opens and focuses an animated composer at that line. Sidebar links open the same thread. Switching placement keeps drafts. SVG chevrons avoid text-glyph baseline issues; rendered Markdown uses normal HTML whitespace so serializer newlines do not add empty lines below messages.

Click source text or a new-side line number to compose a comment; drag line numbers for a range. Optional `endLine` is validated against the immutable source and preserved in feedback. Old-side gestures are best tested in Split view. All messages on an exact file/side/line share one thread; replies appear underneath the original in Chat and source. Threads can be resolved, dismissed, reopened and inspected. Open threads use the original yellow line and trailing blame-style preview rather than a dot. The whole Reviewed control is clickable: marking the diff read collapses its file. Reopen it using the filename or a comment/source link without clearing Reviewed; marking unread expands it. Reviewed headers use a green tint and green filename/control; Reviewed remains a read marker, not approval. Navigation and expansion animate, respecting reduced-motion preferences. Normal floating cards shift within their attached line/range bounds without a scroll opacity fade. Offscreen neighbours use a deliberate exception: the real cards peek into the viewport edges and overlap as a stack, retaining the very same DOM/content as they arrive. There are no substitute preview cards. Click a peeking card to jump to it. **Peek stack** in the fixed topbar chooses 1–5 real neighbours per edge (default 1, session-only). Previous peeks reveal the actual card and body instead of translating a header inside a cropped rectangle. Their corners mirror the bottom peeks: square against the top viewport edge, rounded underneath; bottom peeks round above and meet their viewport edge squarely. Peeks use only space left by the entire current card, including its footer; they never cover it. Strips enter progressively as room opens, flush with viewport edges. Flowing cards keep stable document coordinates in the workspace; viewport-pinned cards use fixed positioning, so neither requires per-frame counter-scrolling. Source geometry is cached during scrolling and refreshed after it settles. There is no scroll tween or per-scroll awaited placement. Wheel scrolling over a portalled card consumes its inner scroll space first, then chains remaining movement to the source workspace. Click the same line again to deselect its editor without losing typed text. Save replies with ⌘Enter/Ctrl-Enter or Save reply. Pen/trash icons edit or remove your unsent comments; edits replace the original message and Cancel keeps the saved original. Agent comments and completed feedback remain read-only. **⌘S/Ctrl-S submits the whole review**, matching the topbar action; unfinished replies visibly block submission. Cancel confirms before discarding nonempty drafts. Save or discard unfinished replies/comments before submitting. Summary is optional; finishing without comments is explicit. Drafts remain in memory across file/review navigation; closing with unsubmitted feedback is blocked until it is submitted or explicitly discarded. Force quitting still loses drafts.

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

The desktop launches `ferropi mount`, not Pi directly. Set `FERROPI_BIN` to this workspace's `target/debug/ferropi` executable (absolute path) and `PI_BINARY` to the Pi executable when they are not on the desktop process's PATH. **Review Dispatch** creates an app-owned review and starts its reviewer automatically. CLI callers default to caller-owned: no reviewer is started until **Start Pi reviewer** is clicked. Opt-in persists for that review. An enabled reviewer uses `reviews/<UUID>/agent.jsonl`; reopening a successful report hydrates native Pi history rather than running it again. **Retry Pi review · same session** restarts failed attempts without deleting history. Session identity is still per request UUID; stable PR identity across separate enqueues/revisions is unfinished.

The first reviewer receives only supplied source snapshots, with a 96 KB source-text budget. Binary/unavailable entries, lockfiles and unsupported file types are omitted and the scope is visible in Chat. Pi tools, MCP, extensions, skills, prompt templates and context-file discovery are disabled; the model cannot read other files, run tests, edit code or publish anything. Its report is static analysis, not verified test results.

Reports stream into Chat. Structured findings are checked against the immutable file/line boundaries before becoming clickable source links. Human submission remains independent: agent findings are never silently included in the feedback result. The initial agent does not automatically apply human feedback or edit code.

The main window owns its Ferropi mounts. Destroying it cancels the desktop's client tasks and closes their pipes; Ferropi then releases the corresponding session leases. Pi's native session history remains on disk. Failed/interrupted model work can be retried in the same native session. This is a fresh model attempt using preserved history, not durable replay of interrupted execution. Transport/provider failures remain visible.

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

After the shared-repository consolidation, the agreed delivery order is:

1. Quiz mode.
2. PR sources and polling in Rust.
3. Interactive in-app agents (beyond the existing static review/retry).
4. Fork-to-terminal for native agent sessions.
5. Linear / Confluence context.

End-to-end acceptance closes this MVP; the wider prototype gaps below are not an additional automatic feature backlog. Source selection, daemon ownership and integration credentials still need to be confirmed before their respective implementations.

## Remaining from the recorded prototype requirements

The local immutable snapshot → native review → explicit result → tracked CLI wake loop works. Native Pi review/retry and Ferropi native fork interoperability work; smooth cards were verified in the native UI. Beyond the current title-bar/inline polish, the major gaps are:

- Live GitHub PR/watch/stack discovery, discussions and linked Jira/Linear content in the UI; the mockup's context was illustrative.
- Stable logical review identity across revision UUIDs, follow-up rounds, stack-range choice and true revision interdiffs.
- Draft persistence beyond process lifetime and automatic tool discovery/Finder-ready packaging without launch environment variables.
- Interactive agent conversation/apply-feedback workflow, quiz forks and terminal-fork UI; native fork primitives alone do not provide these experiences.
- Inbox filtering to live watches/actively waiting callers rather than all unfinished disk requests, and published JSON Schemas for the handoff.
- Ferropi Windows transport; the current daemon uses Unix sockets.

This is a comparison against the mockup behavior notes and recorded requirements, not a claim of a separate exhaustive formal PRD audit. These gaps are not silently included in the current UI task. Remote writes still require explicit authorization.
