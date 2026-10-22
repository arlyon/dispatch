// THROWAWAY: A/B/C historical capture flows; D is the single-PR branch candidate.
// All four are embedded in the existing / workspace shell.
// Compare ?prototype=pr-capture&variant=A|B|C|D. All source and draft state is synthetic, in memory.
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import WorkspaceShell from "./WorkspaceShell";
import PRSingleCardPrototype from "./PRSingleCardPrototype.tsx";
import Icon from "./Icon";
import "../App.css";
import "./refinement.css";
import "./iteration.css";
import "./PRCapturePrototype.css";

type Variant = "A" | "B" | "C" | "D";
const variants: Variant[] = ["A", "B", "C", "D"];
const names = { A: "Inline inbox capture", B: "Workspace reveal", C: "Side capture rail", D: "One PR · pull branch" };
const revisions = ["a17c902", "b28d013", "c39e124"];
const stages = ["Reading PR metadata", "Revision pinned", "Reading changed files", "Ready to open"];

function PrototypeSwitcher(props: { variant: Variant; onChange: (delta: number) => void }) {
  onMount(() => {
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        target instanceof HTMLElement && target.closest("input,textarea,select,[contenteditable]:not([contenteditable=false])")) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault(); props.onChange(event.key === "ArrowLeft" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", keyboard);
    onCleanup(() => window.removeEventListener("keydown", keyboard));
  });
  return <nav class="capture-switcher" aria-label="Throwaway prototype variants">
    <button aria-label="Previous variant" onClick={() => props.onChange(-1)}>←</button>
    <span><small>THROWAWAY · SIMULATION</small>{props.variant} — {names[props.variant]}</span>
    <button aria-label="Next variant" onClick={() => props.onChange(1)}>→</button>
  </nav>;
}

export default function PRCapturePrototype() {
  const initial = new URLSearchParams(location.search).get("variant");
  const [variant, setVariant] = createSignal<Variant>(variants.includes(initial as Variant) ? initial as Variant : "A");
  const [pinned, setPinned] = createSignal(0);
  const [remote, setRemote] = createSignal(1);
  const [arrived, setArrived] = createSignal(false);
  const [target, setTarget] = createSignal<number>();
  const [stage, setStage] = createSignal(-1);
  const [opened, setOpened] = createSignal([0]);
  const [drafts, setDrafts] = createSignal<Record<number, string>>({ 0: "Does the previous revision stay readable while this loads?" });
  const [file, setFile] = createSignal("src/review.ts");
  let timers: ReturnType<typeof setTimeout>[] = [];
  const active = () => stage() >= 0;
  const ready = () => stage() === 3;
  const sha = (index: number) => revisions[index];
  const draft = () => drafts()[pinned()] || "";
  const stop = () => { timers.forEach(clearTimeout); timers = []; };
  onCleanup(stop);
  function capture() {
    if (active()) return;
    setTarget(remote()); setStage(0);
    // Deliberately staged simulation, not a network percentage or measured progress.
    timers = [1000, 2300, 3900].map((delay, index) => setTimeout(() => setStage(index + 1), delay));
  }
  function openReady() {
    const next = target(); if (!ready() || next === undefined) return;
    setOpened(all => all.includes(next) ? all : [...all, next]);
    setPinned(next); setStage(-1); setTarget(undefined); stop();
  }
  function switchVariant(delta: number) {
    const next = variants[(variants.indexOf(variant()) + delta + variants.length) % variants.length];
    const url = new URL(location.href); url.searchParams.set("variant", next);
    history.replaceState(null, "", url); setVariant(next);
  }
  onMount(() => {
    const pop = () => { const key = new URLSearchParams(location.search).get("variant"); setVariant(variants.includes(key as Variant) ? key as Variant : "A"); };
    window.addEventListener("popstate", pop); onCleanup(() => window.removeEventListener("popstate", pop));
  });

  function CaptureStatus() {
    return <section class="capture-status" aria-label="Simulated capture" aria-live="polite">
      <div class="capture-status-title"><Icon name={ready() ? "check" : "branch"}/><strong>{ready() ? "Snapshot ready" : "Preparing a separate view"}</strong></div>
      <div class="capture-stages"><For each={stages}>{(label, index) => <div class="capture-stage" classList={{ done: index() < stage(), current: index() === stage() }}>
        <span class="capture-step">{index() < stage() ? "✓" : index() + 1}</span><span>{label}</span>
      </div>}</For></div>
      <p>{stage() === 0 ? "SIMULATION · no network request" : <>Pinned <code>{sha(target()!)}</code> · 2 files</>}</p>
      <Show when={ready()} fallback={<small>Your current diff and draft stay usable.</small>}>
        <button class="small-primary" onClick={openReady}>Open pinned {sha(target()!)} <span>→</span></button>
        <small>Switch views explicitly. The previous draft stays with its revision.</small>
      </Show>
    </section>;
  }
  // The disagreement is placement and hierarchy, not a different app or color theme.
  function VariantA() { return <div class="capture-inline capture-enter"><CaptureStatus/></div>; }
  function VariantB() { return <div class="capture-header capture-enter"><div class="capture-skeleton" aria-hidden="true"><i/><i/><i/></div><CaptureStatus/></div>; }
  function VariantC() { return <aside class="capture-rail capture-enter"><span class="capture-eyebrow">Incoming snapshot</span><CaptureStatus/></aside>; }

  const inbox = <section class="inbox floating-panel">
    <header class="inbox-head"><div class="heading">Inbox <span class="count">2</span><span class="spacer"/><Icon name="search"/></div><span class="muted capture-small">dispatch / review workspace</span></header>
    <div class="inbox-scroll">
      <div class="capture-divider">Local <span>{opened().length}</span></div>
      <For each={opened()}>{revision => <article class="pr-accordion-card" classList={{ "is-current": pinned() === revision }}>
        <button class="pr-summary capture-local" onClick={() => setPinned(revision)}><span class="repo">dispatch · pinned snapshot</span><strong class="title">Keep review drafts in place</strong><span class="meta"><code>{sha(revision)}</code><span>{drafts()[revision] ? "1 draft" : "2 files"}</span></span></button>
        <Show when={pinned() === revision}><div class="pr-file-accordion"><div class="files-heading">Files changed (2)<span class="stats"><span class="plus">+8</span><span class="minus">−2</span></span></div><For each={["src/review.ts", "src/Inbox.tsx"]}>{path => <button class="capture-tree" classList={{ selected: file() === path }} onClick={() => setFile(path)}><Icon name="file"/>{path}</button>}</For></div></Show>
      </article>}</For>
      <div class="capture-divider">Remote <span>1</span></div>
      <article class="pr-accordion-card capture-remote"><span class="repo">dispatch · synthetic PR #42</span><strong class="title">Keep review drafts in place</strong><span class="meta">prototype author · <code>{sha(remote())}</code></span>
        <button class="capture-pull" disabled={active()} onClick={capture}><Icon name="arrow"/>{active() ? ready() ? "Ready · not opened" : "Capturing separately…" : "Pull down PR"}</button>
        <Show when={active() && variant() === "A"}><VariantA/></Show>
      </article>
    </div><footer class="inbox-footer"><span class="muted capture-small">Memory only · no queue writes</span></footer>
  </section>;
  const chat = <section class="right floating-panel">
    <header class="right-head"><Icon name="comment"/><strong>Review notes</strong><span class="spacer"/><span class="chat-context">Unsubmitted</span></header>
    <div class="conversation"><div class="comment-byline"><span class="comment-avatar">Y</span><strong>You</strong><span class="muted capture-small">on {sha(pinned())}</span></div>
      <p class="capture-note">The diff stays pinned, even if the PR moves on.</p>
      <div class="capture-draft-card"><span class="capture-eyebrow">Draft · {sha(pinned())}</span><p>{draft() || "No draft on this revision yet."}</p></div>
      <Show when={opened().some(revision => revision !== pinned() && drafts()[revision])}><p class="muted capture-small">Previous draft retained. Select its Local snapshot to return.</p></Show>
    </div>
    <footer class="review-footer"><label class="summary-label" for="prototype-draft">Draft for <code>{sha(pinned())}</code></label><textarea id="prototype-draft" class="final-summary" value={draft()} onInput={event => setDrafts(all => ({ ...all, [pinned()]: event.currentTarget.value }))} placeholder="Try typing while capture runs…"/><p class="feedback-note">In-memory rehearsal only. Nothing can be submitted.</p></footer>
  </section>;

  return <div class="pr-capture-prototype" data-variant={variant()}>
    <Show when={variant() === "D"} fallback={<WorkspaceShell inboxVisible={true} chatVisible={true} onWorkspace={() => {}}
      topbar={<header class="topbar"><span class="iconbtn"><Icon name="panel"/></span><span class="brand"><Icon name="arrow"/>dispatch</span><span class="brand-divider"/><span class="capture-small muted">Review workspace</span><div class="topbar-actions"><span class="capture-simulation">SIMULATION / THROWAWAY</span><button class="capture-test" disabled={remote() === 2} onClick={() => { setRemote(2); setArrived(true); }}>Simulate newer head</button><span class="user-avatar">Y</span></div></header>}
      inbox={inbox} chat={chat}
      footer={<footer class="statusbar"><span class="status-dot"/>Memory only<span class="status-divider"/><span>Pinned {sha(pinned())} · remote {sha(remote())}</span><span class="spacer"/><span>No network · no publishing · no saved feedback</span></footer>}
    >
      <div class="capture-scene-heading"><span class="capture-eyebrow">PR capture / motion study</span><h1>Keep your place. Bring the change to you.</h1><p>Pull down the simulated PR in the inbox. Keep reading or editing your draft.</p></div>
      <Show when={arrived() && pinned() !== remote()}><div class="capture-notice capture-enter" role="status"><Icon name="branch"/><div><strong>New revision available · {sha(remote())}</strong><small>You're still on {sha(pinned())}. Your draft hasn't moved.</small></div><button disabled={active()} onClick={capture}>{active() ? ready() ? "Snapshot ready" : "Capture in progress" : "Open latest…"}</button></div></Show>
      <Show when={active() && variant() === "B"}><VariantB/></Show>
      <div class="capture-review-layout">
        <div class="capture-old-view"><div class="review-info-strip"><span class="state-pill"><Icon name="branch"/>Pinned view</span><code class="muted">{sha(pinned())}</code><span class="spacer"/><span class="capture-small muted">Your current review</span></div>
          <h2>Keep review drafts in place</h2><p class="capture-context">dispatch · synthetic PR #42 · main ← prototype/draft-safety</p>
          <div class="capture-diff" data-pinned={sha(pinned())}><header class="file-header"><Icon name="file"/><span class="file-name">{file()}</span><span class="spacer"/><span class="stats"><span class="plus">+4</span><span class="minus">−1</span></span></header>
            <div class="capture-hunk">@@ −12,5 +12,8 @@ · illustrative code, not repository content</div>
            <For each={file() === "src/review.ts" ? ["  function openReview(snapshot) {", "−   current = remote.head;", "+   current = snapshot.head;", "+   drafts.keep(current);", pinned() === 0 ? "+   render(snapshot.files);" : "+   render(snapshot.files, { pinned: true });", "    return current;", "  }"] : ["  function Inbox() {", "−   return liveChanges();", "+   return pinnedSnapshots();", "+   // New heads don't replace the open diff.", "  }"]}>{(line, index) => <div class="capture-code" classList={{ addition: line.startsWith("+"), deletion: line.startsWith("−") }}><span>{12 + index()}</span><code>{line}</code></div>}</For>
          </div><p class="capture-reading-note"><Icon name="comment"/>Read freely while capture runs. No overlay, no automatic switch.</p>
        </div>
        <Show when={active() && variant() === "C"}><VariantC/></Show>
      </div>
      <div class="capture-state"><span class="capture-eyebrow">Visible simulation state</span><code>view={sha(pinned())} · remote={sha(remote())} · capture={active() ? `${stage() === 0 ? "metadata" : sha(target()!)} / ${stages[stage()]}` : "idle"} · draft={sha(pinned())}</code></div>
    </WorkspaceShell>}><PRSingleCardPrototype/></Show>
    <PrototypeSwitcher variant={variant()} onChange={switchVariant}/>
  </div>;
}
