# Native desktop slice: validation and handoff

## Implemented

- One resident tray per private queue, at most one separate GUI process.
- Close hides; a monotonic 30-minute hidden lifetime requires a draft/navigation checkpoint acknowledgement before GUI retirement. Reopening cancels disposal. Checkpoint failures keep the GUI alive.
- The resident owns agent clients and memory-only checkpoints. These are not durable crash recovery.
- `dispatch --bg` and `dispatch-review ... --bg`; normal delivery opens the review. JSON stdout and `--wait` remain separate from best-effort desktop launch errors.
- Bird tray icon with a large pink-red bottom-right badge for unseen arrivals. Showing Dispatch acknowledges this badge, not the outstanding-review count. No flashing or pulsing.
- Latest macOS direction supersedes the earlier static-only handoff: the bird slides left to reveal the total unfinished review count, local or remote, already present in Dispatch's queue. A bounded 280ms transition runs only on count changes; no repeating idle animation. The number remains visible after acknowledgement and shrinks away when all requests have a completed result. This does not add GitHub/remote discovery.
- macOS uses a monochrome bird alpha template while idle (native light/dark tint), and a black/white outlined bird with the coloured badge for attention. Image and template mode switch atomically, avoiding flicker. Linux retains its original coloured artwork.
- App/Dock/installer icons now use the original bird instead of Tauri's default logo. Regenerate the desktop assets with `mise exec -- node scripts/icons.mjs` (developer-only Homebrew prerequisites: `librsvg` and `imagemagick`; neither is a runtime dependency).
- Locally bundled Plus Jakarta Sans, retaining compact 13px base UI / 12px code and existing component sizes.

## Passed locally on Fedora / Sway

- `mise run check`: frontend fingerprint/version checks, TypeScript, Node tests, Vite build, Rust formatting, workspace Clippy and workspace tests. The existing real-Pi test remains explicitly ignored unless its binary is supplied.
- `cargo build -p dispatch --bins --features tauri/custom-protocol` through mise.
- Isolated native tests using this repository's actual 19-file `ae7e273..b8057cd` snapshot: tray-only startup, background delivery without a GUI, stable red badge without frame updates, foreground acknowledgement removing the badge, background arrival not extending the short debug hidden timeout, GUI retirement with the resident alive, explicit quit removing the socket, and no implicit `result.json` publication.
- Earlier isolated native tests exercised unsent-summary restoration and the quit guard. Unit tests cover checkpoint timeouts, stale acknowledgements, reopen races, socket replacement safety, bounded frames and singleton locking.
- CLI integration tests cover foreground/background JSON output, background `--wait`, repeated flags, and retaining a queued request when GUI launch fails.

## Passed locally on macOS

- `mise run build`: native debug app and Ferropi sidecar packaged successfully. This is not Developer ID signing or notarization.
- `mise run check`: full repository gate passed. The pre-existing real-Pi integration test remains ignored unless explicitly configured.
- Native smoke test in a fresh private `/tmp/dispatch-tray-*` queue, using this project's actual Git snapshot: background startup exposed one status item and no windows; a duplicate launch reached the existing resident; background delivery did not launch a GUI; foreground socket activation launched one separate review window; clicking its native close button hid it; the debug four-second hidden grace retired that GUI while the resident survived; subsequent activation reopened a GUI. No feedback result was implicitly published. Existing user sessions and queues were untouched.
- Native Accessibility measurements confirmed a background arrival expanded the status item from 36×24 to 49×24 points; it stayed expanded after foreground acknowledgement. This verifies native geometry changes, not the subjective visual smoothness of the animation.
- Artwork unit test decodes both macOS bird PNGs: transparent margins, black idle alpha mask, monochrome attention bird, and a large coloured badge confined to the lower-right corner. Enlarged raster previews inspected on light/dark backgrounds.
- Count/animation unit tests cover the complete queue (including more than 50 entries), excluding completed requests, finite expansion/contraction, single/multiple digits, visible glyphs, count retention after acknowledgement and no idle frame updates.

## Not green / not verified

- The additional `tests/comments.browser.cjs` run is **not passing**. The packaging-only 19-file request does not contain its hard-coded UI anchors and is not a valid fixture for that suite. An own-UI repository-wide snapshot failed the final on-screen jump assertion; a focused own-source fixture passed that jump but timed out waiting for `Previous comment: src/App.tsx:2`. These navigation/peek failures are unresolved; do not claim browser regression coverage passed.
- Live macOS tray-menu clicks are not verified: Accessibility exposed the status item, but automated clicks did not expose its popup menu. Lifecycle checks above used the existing activation socket and native window close, not simulated tray commands. Screen capture was unavailable, so actual menu-bar appearance, light/dark transitions and live badge acknowledgement still need visual confirmation. The latest count-slide request supersedes the earlier static-only instruction; smoothness still needs user visual confirmation.
- Developer ID signing/notarization are not configured. No signed release was validated.
- Optimized final-app RAM and reopen latency have not been remeasured after this slice. Earlier prototypes are not final-app benchmarks.
- GTK4 / fractional-scaling experiments are separate and are not production dependency changes in this branch.

The user's existing resident/GUI was not forcibly restarted. Throwaway prototypes and private runtime/source-build experiments are intentionally excluded from the commit.
