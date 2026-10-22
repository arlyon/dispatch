# Native desktop slice: validation and handoff

## Implemented

- One resident tray per private queue, at most one separate GUI process.
- Close hides; a monotonic 30-minute hidden lifetime requires a draft/navigation checkpoint acknowledgement before GUI retirement. Reopening cancels disposal. Checkpoint failures keep the GUI alive.
- The resident owns agent clients and memory-only checkpoints. These are not durable crash recovery.
- `dispatch --bg` and `dispatch-review ... --bg`; normal delivery opens the review. JSON stdout and `--wait` remain separate from best-effort desktop launch errors.
- Linux static bird tray icon, with a large pink-red bottom-right badge for unseen arrivals. Showing Dispatch acknowledges it. No flashing, pulsing, animation option or animation timer.
- Locally bundled Plus Jakarta Sans, retaining compact 13px base UI / 12px code and existing component sizes.

## Passed locally on Fedora / Sway

- `mise run check`: frontend fingerprint/version checks, TypeScript, Node tests, Vite build, Rust formatting, workspace Clippy and workspace tests. The existing real-Pi test remains explicitly ignored unless its binary is supplied.
- `cargo build -p dispatch --bins --features tauri/custom-protocol` through mise.
- Isolated native tests using this repository's actual 19-file `ae7e273..b8057cd` snapshot: tray-only startup, background delivery without a GUI, stable red badge without frame updates, foreground acknowledgement removing the badge, background arrival not extending the short debug hidden timeout, GUI retirement with the resident alive, explicit quit removing the socket, and no implicit `result.json` publication.
- Earlier isolated native tests exercised unsent-summary restoration and the quit guard. Unit tests cover checkpoint timeouts, stale acknowledgements, reopen races, socket replacement safety, bounded frames and singleton locking.
- CLI integration tests cover foreground/background JSON output, background `--wait`, repeated flags, and retaining a queued request when GUI launch fails.

## Not green / not verified

- The additional `tests/comments.browser.cjs` run is **not passing**. The packaging-only 19-file request does not contain its hard-coded UI anchors and is not a valid fixture for that suite. An own-UI repository-wide snapshot failed the final on-screen jump assertion; a focused own-source fixture passed that jump but timed out waiting for `Previous comment: src/App.tsx:2`. These navigation/peek failures are unresolved; do not claim browser regression coverage passed.
- The macOS bird/badge adaptation and live macOS lifecycle checks are pending. Final user direction is **static only**, superseding the earlier animation handoff.
- Developer ID signing/notarization are not configured. No signed release was validated.
- Optimized final-app RAM and reopen latency have not been remeasured after this slice. Earlier prototypes are not final-app benchmarks.
- GTK4 / fractional-scaling experiments are separate and are not production dependency changes in this branch.

The user's existing resident/GUI was not forcibly restarted. Throwaway prototypes and private runtime/source-build experiments are intentionally excluded from the commit.
