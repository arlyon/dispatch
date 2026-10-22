# Quiz mode self-host checkpoint

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
