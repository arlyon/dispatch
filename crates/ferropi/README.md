# Ferropi

Ferropi ("therapy") is a lazy local daemon for sharing native Pi sessions between CLI, desktop and background clients.

It owns Pi subprocesses, routes commands and responses, and streams session events to attached clients. Review workflows, comment collection, feedback submission, PR discovery and desktop UI belong to client applications, not Ferropi.

This first slice exercises **client RPC → lazy daemon → Ferropi session manager → native Pi RPC**.

## Implemented

- Rust `ferropi-pi-rpc` crate with typed initial commands, correlated responses and lossless JSON event payloads.
- Lazy local singleton using `kunobi-daemon = 0.10.1`: detached launch, OS locks, private socket acquisition, stale-socket recovery and guarded cleanup. No hand-written pidfile liveness checks.
- Weak session and client registries. Clients hold the strong session leases.
- Multiple mounts share one Pi subprocess for a canonical native session path and working directory.
- Caller request IDs are isolated; Pi wire IDs are unique. Responses return to their caller; session events fan out with per-process sequence numbers.
- Last session lease drops: close Pi stdin, drain stdout and reap the child; force termination after a bounded shutdown wait. The daemon exits 500 ms after its last connection disappears.
- Reattachment waits for an old session process to finish closing before starting another writer.
- Native Pi owns its JSONL history. No Durable store, history conversion or custom TS agent host.
- Fork-and-mount starts a separate Pi process using native `--fork`, leaving existing mounts on their original session.

The initial broker transport is **macOS/Linux Unix sockets**. Windows named pipes are not implemented. The Pi RPC crate itself is portable.

## Run

Run these commands from the Dispatch repository root. Dispatch, Ferropi and pi-rpc share the same Cargo workspace. Use mise for the pinned Rust toolchain. Install Pi separately; its executable must be available to the daemon, or pass an absolute `--pi` path.

```sh
mise trust
mise run check
mise exec -- cargo build --workspace
```

Choose an existing directory for native sessions; do not use a session currently being written by another normal Pi process.

```sh
mise exec -- target/debug/ferropi rpc --session /absolute/path/review.jsonl --request '{"type":"get_state"}'
mise exec -- target/debug/ferropi mount --session /absolute/path/review.jsonl
mise exec -- target/debug/ferropi fork --session /absolute/path/review.jsonl
```

`rpc` prints records until its matching response and detaches. A `prompt` response means **accepted**, not completed: if this was the last mount, Pi shuts down. Use a long-lived `mount` for streaming work, and wait for **`agent_settled`**, not `agent_end`, to detect completion.

`mount` prints its mount acknowledgement, accepts native command JSONL on stdin, and disconnects on stdin EOF. For example, type:

```json
{"id":"state","type":"get_state"}
{"id":"messages","type":"get_messages"}
{"id":"review","type":"prompt","message":"Review this change"}
```

`fork` prints a mount acknowledgement containing the new native `session` path, then behaves like `mount`. Other mounts keep their original session and subprocess. The fork is persisted next to its source by Pi itself, including native `parentSession` metadata and the source's full persisted tree (Pi CLI `--fork` semantics, not `/clone`'s active-branch-only semantics).

Forks require a settled, persisted source. Client commands are held at the snapshot boundary; running, retrying, compacting or queued work is rejected rather than implicitly aborted. Once the fork mount has detached, its printed path can be opened directly with ordinary `pi --session /path/to/fork.jsonl`. No terminal UI is launched by Ferropi. A fork file remains ordinary Pi history after its mounts detach.

Global options include `--state-dir /private/path`, `--pi /absolute/path/to/pi` and repeated `--pi-arg=--offline`. The Pi executable belongs to the daemon, but Pi arguments belong to each session: a GUI tool-free review must not inherit another CLI session's tools. Explicit conflicting options on an already-mounted session are rejected; unspecified remounts inherit that session's existing options. Native forks preserve the source options. Defaults use the user's cache directory under `ferropi`. Startup failures are recorded in that private directory's `daemon.log`.

## Mount protocol

The current client negotiates before creating any Pi process:

```json
{"type":"hello"}
```

The daemon replies with `{"type":"hello","protocol":1,"capabilities":["sessionPiArgs"]}`. Clients reject incompatible daemons before mounting, rather than silently ignoring session restrictions. An old active daemon must be allowed to exit when its existing clients detach. Legacy direct mount records are still accepted by the new daemon.

Then mount a session:

```json
{"type":"mount","session":"/absolute/path/review.jsonl","cwd":"/absolute/path/repository"}
```

A mount may include optional `piArgs`, for example `["--no-tools", "--no-mcp", "--no-extensions"]`. In the Rust client this is `MountRequest.pi_args`; nonempty `Config.pi_args` supplies client defaults, not daemon-wide settings.

Successful attachment:

```json
{"type":"mounted","daemonPid":123,"piPid":456,"session":"/absolute/path/review.jsonl","cwd":"/absolute/path/repository"}
```

To create and mount a separate native fork, send `fork_mount` instead of `mount` after negotiation. Here `session` is the source, and the `mounted.session` response is the newly created file:

```json
{"type":"fork_mount","session":"/absolute/path/review.jsonl","cwd":"/absolute/path/repository"}
```

The Rust client exposes this as `Client::fork`. Busy/unpersisted sources return a `mount_error` record. Fork creation is not automatically retried: after an interrupted request, a native fork may already have been created even if the client did not receive its path.

Then send supported native Pi commands with caller-local string IDs. Replies retain their original IDs. Session events are wrapped:

```json
{"type":"event","sequence":1,"record":{"type":"agent_start"}}
```

Subscribe before hydrating with `get_state` / `get_messages`. Event sequences belong to the current Pi process, not persisted history. Slow clients that overrun the bounded event buffer disconnect rather than blocking Pi or silently losing deltas; remount and hydrate after a gap. Snapshot/delta reconciliation for GUI mounts is not implemented yet.

The initial command surface lives in `crates/pi-rpc/src/lib.rs`. It does not yet map every upstream command or the extension-dialog response protocol. Direct `fork`/`clone` exist in the RPC crate but are rejected by shared daemon mounts: silently changing the session underneath other mounts would break ownership. Use `fork_mount` to create a separate session instead.

The per-session `.ferropi.lock` excludes other Ferropi daemons, **not ordinary Pi clients**, which do not know about this lock. Open a separate native fork for terminal continuation, or fully detach the original before opening it in normal Pi.

## Validation

```sh
mise run fix
mise run check
```

The deterministic suite uses a Rust fake Pi subprocess, never a provider. It exercises concurrent lazy discovery, shared process identity, out-of-order responses with duplicate client IDs, event fan-out, Unicode separators, partial detach, last-detach shutdown, immediate remount, restart, cross-daemon writer exclusion, timeouts, malformed stdout and child exit. Fork tests cover isolated identity/events, shared fork mounts, independent leases and busy/unpersisted source rejection; framing covers LF, CRLF and Unicode separators. Session-options tests verify shared-daemon isolation, conflicting remount rejection, normal-session defaults and option inheritance on forks.

An opt-in smoke test starts real Pi offline with tools, extensions, MCP, context files and resource discovery disabled. It mounts two clients, forks while both remain attached, changes only the fork's name, and verifies the original session is intact. After detaching, ordinary Pi reopens the broker-created fork, clones it, and opens that further native clone. No model requests are made. Set `FERROPI_PI_BINARY` to the absolute Pi executable, then run:

```sh
mise exec -- cargo test -p ferropi --test mounts native_pi_round_trip_and_clone_remain_native_sessions -- --ignored
```

Verified locally against Pi 1.3.0. This proves native session/fork compatibility through RPC, not a rendered terminal or GUI workflow.

Protocol sources: [Pi RPC](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md), [commands](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc-commands.md), [native session format](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md).
