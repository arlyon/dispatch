import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import "./updates.css";

type Status = { format: string | null; phase: "idle" | "checking" | "available" | "downloading" | "installing" | "error"; version: string | null; error: string | null };
export default function Updates(props: { blocked: boolean }) {
  const [status, setStatus] = createSignal<Status>();
  const [error, setError] = createSignal("");
  let menu: HTMLDetailsElement | undefined, sequence = 0;
  const working = () => ["checking", "downloading", "installing"].includes(status()?.phase || "");
  async function read(command = "update_status") {
    const current = ++sequence;
    try { const value = await invoke<Status>(command); if (current === sequence) { setStatus(value); setError(""); } }
    catch { if (current === sequence && status()?.format) setError("Could not reach the update service. Your installation is unchanged."); }
  }
  async function install() {
    if (props.blocked || status()?.phase !== "available") return;
    try { await invoke("install_update"); await read(); }
    catch (error) { setError(String(error)); }
  }
  onMount(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    void read();
    const timer = setInterval(() => void read(), 3000);
    const outside = (event: PointerEvent) => { if (menu && !menu.contains(event.target as Node)) menu.open = false; };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented && menu?.open) { event.preventDefault(); menu.open = false; menu.querySelector("summary")?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    onCleanup(() => { sequence++; clearInterval(timer); document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); });
  });
  return <Show when={status()?.format}><details class="update-control" ref={menu}>
    <summary classList={{ "update-available": status()?.phase === "available" }}> {status()?.phase === "available" ? "Update available" : "Updates"}</summary>
    <section class="update-options" aria-label="Application updates">
      <strong>Dispatch updates</strong>
      <p role="status">{error() || status()?.error || (status()?.phase === "checking" ? "Checking for updates…" : status()?.phase === "downloading" ? "Downloading and verifying the update…" : status()?.phase === "installing" ? "Installing update…" : status()?.version ? `Version ${status()!.version} is available.` : "You’re up to date.")}</p>
      <p>{status()?.format === "rpm" ? "RPM installation may ask for administrator approval." : "Updates are verified before installation."}</p>
      <button disabled={working()} onClick={() => void read("check_updates")}>Check now</button>
      <Show when={status()?.phase === "available"}><button class="primary-action" disabled={props.blocked} onClick={() => void install()}>Install & restart</button><Show when={props.blocked}><p>Finish active work and submit or explicitly discard feedback before updating.</p></Show></Show>
    </section>
  </details></Show>;
}
