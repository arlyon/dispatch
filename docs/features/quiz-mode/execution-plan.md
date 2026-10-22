# Execution and validation

1. Add the bounded Ferropi child-only fork capability and typed one-way native UI reply. Keep normal command IDs/event routing and source ownership unchanged.
2. Ship one embedded extension with model-only `present_question` and `report_assessment` tools using the supported RPC input dialog. Rust handles scoped source bootstrap, settled fork, validated question links, explicit answer routing, cancellation and visible failures. Source preparation has a separate application-owned lease until settled; ending its quiz prevents late fork creation.
3. Reconstruct Pi 1.3 delta-only text by content index in stable ordered text/answer segments, reconcile authoritative block/message finals, and coalesce UI emissions. Anchor each successful native answer before subsequent text and patch assessments in place. Tool argument fragments never become an answer form. Bind explicit per-answer verdicts to real successful question results; reject unknown/pending/duplicate/stale IDs. No numeric score or review-feedback inclusion.
4. Return confirmed per-run counts from the existing End command after its cancellation/join barrier. Append a single memory-only run summary at the end of main conversation content before the persistent reviewer offer, deduped by run ID and scoped by review/head. Never inject a parent model turn/history or include quiz data in human feedback.
5. Replace only the visible right bar. Preserve the original DOM/drafts/scroll; keep the diff live and never focus on stream/poll updates.
6. Validate in layers, then build the app and commit one coherent feature change. Native GUI/human self-host acceptance is a separate checkpoint, not inferred from mocks.

## Commands

- `mise run setup`; `mise run fix`; `mise run check`; `mise run build`.
- Focused Rust: `mise exec -- cargo test -p ferropi-pi-rpc --all-features -p ferropi -p dispatch --lib --tests`.
- Actual Pi with loopback deterministic provider (not a real external model): `PI_BINARY=/absolute/path/to/pi mise exec -- node tests/quiz.native.cjs`. It creates private temporary sessions/daemon state, uses the shipped extension, and proves question → supported dialog → matching UI reply → native toolResult → feedback, exact child tool exposure and byte-identical parent history. The fixture also verifies real text/tool-argument deltas, correlated pass/fail results and rejected unknown/pending/duplicate/stale reports. It saves actual native events privately and runs the production Rust ordered-transcript reducer against them (`quiz_stream::tests::actual_native_events_keep_answer_markers_before_feedback`, ordinarily ignored without that fixture). The test-only provider extension is never part of the shipped profile.
- Browser IPC mocks: `PLAYWRIGHT_MODULE=/path/to/playwright mise exec -- node tests/quiz.browser.cjs /absolute/path/to/own-source/request.json`.
- Existing comments browser regression: same environment and snapshot with `tests/comments.browser.cjs`.

The extension is shipped JavaScript, checked by `node --check` in the normal gate and exercised inside real Pi. No SDK development dependencies, fake SDK declarations or diagnostic suppressions are added.

## Manual native GUI checkpoint

Build and launch only this worktree's app with `FERROPI_BIN`/`PI_BINARY` configured. Queue its committed own-source range, register the non-LLM feedback waiter, then launch/open that request. Test Quiz me without first starting the Pi reviewer; observe answer cards before their progressively arriving feedback and explicit per-answer verdicts only in Quiz (missing reports must not be inferred); answer, inspect explanation/source anchors, edit a source comment during quiz, and Done/End back to the original panel. Verify pending-answer confirmation, source-session independence, and one chronological run summary at the end of main conversation content before the bottom reviewer offer on Done/End, with confirmed counts, ended-early status, review isolation and appropriate scroll. Submit review feedback explicitly; quiz answers/verdicts/run summaries must not appear in it.
