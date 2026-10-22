# Quiz mode — working slice

## Outcome

**Quiz me** teaches the reviewer about the pinned immutable change, without requiring a full Pi review first. It uses an ordinary native Pi fork through Ferropi. No GitHub publication, numeric/overall score, computed grading engine or review-feedback mutation. Per-answer pass/fail is an explicit agent report, not Dispatch-computed grading.

## Interaction

- Quiz temporarily replaces the right bar, never overlays the diff. The original panel stays mounted, inert and hidden at its original geometry; conversation, summary draft and scroll remain intact.
- A missing source session receives one context-only initialization turn. Existing work must settle and persist before the native fork; it is never aborted to make a fork.
- Fork context includes native source history, the bounded pinned source snapshot, opening context, explicitly saved comments and thread updates. Unfinished line composers and unsubmitted final-summary text are excluded. An archived review's published summary may be included.
- One question at a time: 2–6 model-supplied choices, optional explanation. A choice and/or nonblank explanation suffices. Answer explicitly returns JSON through the matching native extension UI dialog, producing a real `present_question` tool result in the same fork. Dispatch confirms Answer from that matching tool execution result, not from a fabricated RPC acknowledgement.
- Each successful native answer immediately anchors a stable answer segment in the Quiz transcript. Subsequent assistant text streams after it, while earlier introduction/turn text stays before it. Text finals reconcile their own stable segment; assessments patch the existing answer card without moving it.
- Pi progressively explains an answer and explicitly reports pass/fail plus a short reason through `report_assessment`, bound to the actual answered question tool ID. Cards appear only in the quiz conversation. Unknown, pending, duplicate and stale question IDs are rejected; missing verdicts stay **Not assessed**, never inferred from prose or choice correctness. There is no numeric/overall score.
- Assistant text uses real Pi 1.3 delta-only `message_start`/`message_update` events. Content-index buffers reconcile `text_end` and authoritative `message_end` finals without duplicate text; updates are coalesced at roughly 50 ms. Tool argument fragments show only a preparation status, never raw JSON or an enabled Answer form. Final feedback remains until **Done**, a clear primary action.
- **Done/End** appends one compact run-summary card at the end of the original main conversation content, after existing review/agent content and before the persistent Another pair of eyes offer. The offer is always the last conversation item when a request exists, is unfinished, and has no agent; agent reports/retry/archive semantics are unchanged. It counts only confirmed explicit Pass/Fail and optionally nonzero answered-but-Not assessed; no overall verdict or percentage. Ended early is marked honestly. The Rust end response joins cancellation before returning the final confirmed counts, so frontend event lag cannot invent/lose results. Dedupe by run ID and scope by review ID plus immutable head; multiple runs append chronologically. This memory-only UI summary is not a source-agent model turn/history injection, fork-transcript merge, or human review feedback. Off-bottom scroll is preserved; already-at-end Chat follows the new card without focusing it.
- **End quiz** is an app-styled quiet control with accessible labeling and destructive hover; it confirms discarding a pending choice/text. It ends only quiz work. A fresh context initialization independently keeps its source lease until settled, then releases it if the quiz ended; it cannot create a late fork. Application shutdown still cancels owned tasks. A second quiz waits for an outstanding initialization to finish.
- Diff navigation, reading and comment editing remain available. Returning does not rewind review data. Switching reviews requires ending the quiz first. Startup invalidates any navigation already awaiting IPC and captures the same review's saved context before asynchronous work.
- Streaming/events/polling never focus a textbox or replace its input node. Validated snapshot anchors may jump to source.

## Runtime boundary

Only the trusted embedded extension is explicitly loaded for a quiz. Child-only options declare exactly `present_question,report_assessment`, disable built-ins/MCP/discovered extensions/skills/context discovery, and ignore project configuration. The parent stays tool-free. This is tool permission restriction, **not an OS sandbox**: the trusted extension has Pi's process permissions.

Native `extension_ui_response` preserves the dialog ID, is written once, and does not wait for a correlated command response. Ferropi negotiates child-option/UI-reply capabilities before mounting; older daemons fail closed and must be restarted by their owner, not forcibly killed by Dispatch.

## Limits

Quiz/drafts are memory-only. No resume UI, durable draft subsystem, generic agent framework, shell/file tools, terminal fork UI, automatic answers, or automatic feedback inclusion. Source text retains the existing reviewer budget (96 KB and supported source types); omitted source is not available to the model. Provider and transport failures remain visible; ending and restarting is explicit, not silent replay.
