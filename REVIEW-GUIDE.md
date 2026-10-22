# Shared Dispatch repository

Open **`bd808ae → HEAD`**. This corrects the unnecessary Git-repository split: Dispatch, Ferropi and pi-rpc now live together in `arlyon/dispatch`, retaining their existing crate boundaries.

- `src-tauri/`: Dispatch desktop and review CLI.
- `crates/ferropi/`: native Pi daemon/library.
- `crates/pi-rpc/`: native Pi RPC transport, still its own crate.
- Root Cargo workspace, shared `Cargo.lock` and `target/`. `mise run check` gates all three members; `mise run build` builds Ferropi and the desktop app.
- The tracked CLI waiter, browser harness and docs use the workspace target paths.

The imported daemon/RPC sources are unchanged from the previously tested Ferropi commit. No Pi protocol, session ownership, fork/history behavior or review UI is redesigned. Separate responsibilities and processes do not require separate repositories. The old standalone directory and research scratch remain untouched.

Validation before handoff: workspace membership, full combined gate, real Pi offline fork/clone interoperability, existing browser regression and native build. This GUI uses the shared workspace's Ferropi executable. Automatic Finder/tool discovery remains a documented gap.

After this push, the agreed feature order is **quiz mode → PR polling in Rust → interactive in-app agents → fork-to-terminal → Linear/Confluence context**, followed by end-to-end acceptance. These are not implemented by this consolidation.

Submit explicit feedback with **⌘S / Ctrl-S**. The tracked CLI waiter is registered before GUI launch.
