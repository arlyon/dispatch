# THROWAWAY — click-to-pull PR motion

Question: can any PR be brought into Local with a physical handoff, full vertical preparation, then immediate files/review—without losing your place or drafts?

Run: `mise run prototype:pr-capture` (do not restart an existing preview).

- **D — current candidate:** http://127.0.0.1:14690/?prototype=pr-capture&variant=D
- Historical A/B/C: replace the variant key with A (inline capture), B (workspace header) or C (side rail). Their older revision-card model is historical, not D's semantics.

## D: click any card, then files take over

Two different Local reviews (#17/#18) and three Remote PRs (#42/#43/#44) are visible immediately. **Click the whole Remote card**, or focus it and press Enter/Space. There is no Pull branch button or Open review acknowledgement. Any PR is pullable, including middle/last; arrival order is only a display default. One pull runs at a time.

All five items use the **same private PRCard renderer and neutral base/header styles**. Local/Remote are placement only: no category outline, background, hover, padding or instructional adornment. Selected, loading, expanded-files and verified-drift states may differ. Empty warning/content regions occupy no space.

The same actual card node moves into Local's **end** in 300ms with a gentle settle. A bounded source/destination rectangle batch animates affected peer cards and the divider too—middle-item pulls don't teleport earlier rows. No per-frame geometry/scroll correction. Full-size **vertical** preparation expands **during that same 300ms movement**, starting on the same animation frame—not in a delayed second phase. Card travel uses no vertical scaling; peer transforms compensate for the simultaneous natural-height growth so the motions do not fight. When simulated files are ready, the loading region immediately becomes a vertical file tree and the diff auto-selects that PR. Clicking a file changes the diff. Try #43 first, then #44: Local becomes [17,18,43,44], Remote remains [42]. Refresh never reorders or duplicates a card. Preparation expands at natural height; readiness immediately swaps in the file tree while the card contracts/grows smoothly to that tree's actual height. No fixed 300px card, reserved content spacer or retained height animation: two-file and four-file trees have different final sizes. Peer positions follow the browser's transient height animation; no per-frame JavaScript measurements. Reduced motion is immediate.

Normal navigation/auto-selection caches drafts **per review**, with no finish/save gate. The seeded #17 draft survives the first automatic switch; clicking #17 restores it. PR42/43/44 do not share an editor value. A newer explicit selection while another PR loads cancels only that pull's late auto-switch; its files still finish.

**Simulate branch change** gives materialized Local PR42 a small amber warning icon in its existing header, only for a verified changed branch. Hover/focus/click opens **Branch has changed** with **Refresh**; the popover stays reachable and chooses above/below once when opened. Remote cards never get this indicator. Refresh freezes its target even if a newer head arrives mid-pull. Only changed-head unfinished notes on that *same PR* trigger the small safety guard: files still appear, but the old diff/anchored draft remain until **Keep notes separate & show latest** explicitly preserves them separately. Ordinary different-PR navigation never needs this acknowledgement. No revision picker/history UI.

The existing simulation dropdown still exercises clean, metadata-only and failed checks internally. Metadata/failure/unchanged results add no card icon, status prose or global freshness message; failure is not recorded as a clean result. Internal heads/check state appear only in the SIMULATION STATE line, not main controls. No new global card-navigation shortcuts were added.

Bottom arrows/keyboard arrows cycle A/B/C/D with reload-stable URL keys; inputs/selects/editables retain arrows. D resets when left/reloaded; historical A/B/C state is unchanged. All data/code is synthetic. No Git, API/network, IPC, storage, queue writes, dependencies or feedback submission. Existing WorkspaceShell/chrome/palette are reused; the main workspace never autoscrolls or vertically jumps while pulling.

`src/index.tsx` still requires Vite DEV plus `prototype=pr-capture`; production mounts App unchanged and excludes the prototype. Parent owns visual comparison/review and any later production integration. No integration is implied or performed.
