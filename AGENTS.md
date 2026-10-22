# Dispatch

One Git repository and Cargo workspace: Dispatch (`src-tauri`) is the desktop review client; Ferropi (`crates/ferropi`) is the lazy Pi daemon/library; native RPC remains its own crate (`crates/pi-rpc`). Keep their responsibilities and processes separate, not their repositories.

## Current milestone

Self-hosting means reviewing **this project's own changes** through Dispatch. Bootstrap a small working local review loop before adding PR discovery or more infrastructure. Do not substitute unrelated sales-project PRs or synthetic fixtures for this milestone.

- Rust owns Git snapshots, the filesystem request/result boundary and native integration.
- Tauri + Solid/TypeScript + CodeMirror provide the desktop review surface.
- Native Pi sessions go through Ferropi; never introduce Pi Durable or a replacement session store.
- External agents enqueue immutable review snapshots. Explicit submission publishes a separate completed feedback result. Nothing implicitly publishes to GitHub.
- Preserve unfinished comments across file/review navigation; never silently submit them or silently replace snapshots when the working tree changes.
- First self-hosted slice can be minimal. Do not block the observable review loop on generalized architecture or production hardening.

## Work

- Isolated worktrees under `.wt/<branch>`.
- Use mise for tooling. `mise run fix` formats Rust; `mise run check` is the repository gate; `mise run build` creates the macOS debug app.
- Keep one coherent local commit per branch when practical, amending as it evolves. No push, PR creation/update or other remote mutations without explicit authorisation.
- For every real PR, present what/why, base/dependencies and review status before opening its code or diff.
- Clearly distinguish implemented, tested and verified live. The local review loop is not automatic PR discovery or agent review.
