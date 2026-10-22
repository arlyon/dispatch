// THROWAWAY D: click any PR, hand off the same card, then show files and review automatically.
// Synthetic fixtures only: no Git, network, native IPC, storage, or feedback operations.
import { createSignal, For, onCleanup, Show } from "solid-js";
import WorkspaceShell from "./WorkspaceShell";
import Icon from "./Icon";

const heads = ["a17c902", "b28d013", "c39e124"];
const stages = ["Reading PR metadata", "Preparing branch", "Reading changed files"];
const reviews = [
  { id: 17, title: "Make keyboard shortcuts discoverable", branch: "prototype/keyboard-shortcuts", files: ["src/shortcuts.ts", "src/Inbox.tsx"], arrived: "08:30" },
  { id: 18, title: "Clarify file headings", branch: "prototype/file-headings", files: ["src/headings.ts", "src/FileHeader.tsx"], arrived: "08:45" },
  { id: 42, title: "Keep review drafts in place", branch: "prototype/draft-safety", files: ["src/review.ts", "src/ReviewNotes.tsx"], arrived: "09:10" },
  { id: 43, title: "Keep file filters", branch: "prototype/file-filters", files: ["src/filter.ts", "src/Inbox.tsx"], arrived: "09:20" },
  { id: 44, title: "Explain review shortcuts", branch: "prototype/review-hints", files: ["src/hints.ts", "src/ShortcutHint.tsx", "src/shortcuts.ts", "src/ReviewHelp.tsx"], arrived: "09:30" },
];
const waitingPRs = reviews.slice(2);
const review = (id: number) => reviews.find(item => item.id === id)!;
type Draft = { head: number; body: string };
export default function PRSingleCardPrototype() {
  const [localPRs, setLocalPRs] = createSignal<number[]>([]);
  const [loading, setLoading] = createSignal<number>();
  const [target, setTarget] = createSignal(1);
  const [stage, setStage] = createSignal(-1);
  const [latest, setLatest] = createSignal(1);
  const [check, setCheck] = createSignal<"verified" | "metadata-only" | "unknown">("verified");
  const [loadedHeads, setLoadedHeads] = createSignal<Record<number, number>>({ 17: 0, 18: 0 });
  const [displayHeads, setDisplayHeads] = createSignal<Record<number, number>>({ 17: 0, 18: 0 });
  const [view, setView] = createSignal(17);
  const [paths, setPaths] = createSignal<Record<number, string>>({});
  const [expanded, setExpanded] = createSignal(new Set([17]));
  const [drafts, setDrafts] = createSignal<Record<number, Draft>>({ 17: { head: 0, body: "Keep the keyboard shortcut discoverable in the inbox." } });
  const [blocked, setBlocked] = createSignal<number>();
  const [openDrift, setOpenDrift] = createSignal<number>();
  const [driftAbove, setDriftAbove] = createSignal(false);
  const [finishedNotes, setFinishedNotes] = createSignal<{ id: number; body: string }[]>([]);
  const cards = new Map<number, HTMLElement>();
  let localSlot!: HTMLDivElement, remoteDivider!: HTMLDivElement;
  let navigation = 0;
  let timers: ReturnType<typeof setTimeout>[] = [];
  onCleanup(() => timers.forEach(clearTimeout));
  const inLocal = (id: number) => id === 17 || id === 18 || localPRs().includes(id);
  const remotePRs = () => waitingPRs.filter(pr => !inLocal(pr.id));
  const file = () => paths()[view()] || review(view()).files[0];
  const draft = () => drafts()[view()]?.body || "";
  const viewBehind = () => view() === 42 && latest() !== displayHeads()[42];
  const cardBehind = (id: number) => id === 42 && inLocal(id) && (latest() !== (loading() === id ? target() : loadedHeads()[id]) || viewBehind());
  const hasDrift = (id: number) => check() === "verified" && inLocal(id) && cardBehind(id);
  function showDrift(id: number, element: HTMLElement) {
    if (openDrift() === id) return;
    const bounds = element.closest(".inbox-scroll")!.getBoundingClientRect();
    setDriftAbove(element.getBoundingClientRect().bottom + 88 > bounds.bottom);
    setOpenDrift(id);
  }
  function showReview(id: number, head: number) {
    const notes = drafts()[id];
    if (notes?.body.trim() && notes.head !== head) { setBlocked(id); return; }
    setView(id); setDisplayHeads(all => ({ ...all, [id]: head })); setExpanded(all => new Set([...all, id])); setBlocked(undefined);
  }
  function navigate(id: number, path?: string) {
    navigation++; // An explicit newer selection owns the workspace, not an older pending pull.
    const head = loadedHeads()[id]; if (head === undefined) return;
    resizeCard(id, () => { showReview(id, head); if (path && view() === id && blocked() === undefined) setPaths(all => ({ ...all, [id]: path })); });
  }
  function keepAnchoredNotesSeparate() {
    const id = blocked(); if (id === undefined) return;
    const notes = drafts()[id], head = loadedHeads()[id];
    setFinishedNotes(all => [...all, { id, body: notes.body }]);
    setDrafts(all => ({ ...all, [id]: { head, body: "" } }));
    navigation++; showReview(id, head);
  }
  function resizeCard(id: number, change: () => void) {
    const card = cards.get(id)!, height = card.getBoundingClientRect().height;
    change();
    requestAnimationFrame(() => {
      if (!card.isConnected) return;
      const nextHeight = card.getBoundingClientRect().height;
      if (height === nextHeight) return;
      const animation = card.animate([{ height: `${height}px`, overflow: "hidden" }, { height: `${nextHeight}px`, overflow: "hidden" }], { duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 300, easing: "cubic-bezier(.22,1,.36,1)" });
      animation.onfinish = () => animation.cancel(); // Return to natural height; never retain a spacer.
    });
  }
  function pull(id: number) {
    if (loading() !== undefined) return;
    const owner = ++navigation, frozenHead = id === 42 ? latest() : 1;
    const firstPull = !inLocal(id), card = cards.get(id)!;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const elements = [...cards.values(), remoteDivider];
    // Bounded FLIP batches: one before/after rect per card/divider, never per-frame geometry.
    const before = firstPull ? new Map(elements.map(element => [element, element.getBoundingClientRect()])) : undefined;
    const hadFocus = card.contains(document.activeElement);
    const begin = () => { setTarget(frozenHead); setStage(0); setLoading(id); };
    if (firstPull) begin(); else resizeCard(id, begin);
    if (firstPull) {
      setLocalPRs(all => [...all, id]); localSlot.append(card);
      if (hadFocus) card.focus({ preventScroll: true });
      requestAnimationFrame(() => {
        if (!card.isConnected || !before) return;
        const after = new Map(elements.map(element => [element, element.getBoundingClientRect()]));
        const fromCard = before.get(card)!, toCard = after.get(card)!, growth = toCard.height - fromCard.height;
        const timing = { duration: reduced ? 0 : 300, easing: "cubic-bezier(.22,1,.36,1)" };
        const height = card.animate([{ height: `${fromCard.height}px`, overflow: "hidden" }, { height: `${toCard.height}px`, overflow: "hidden" }], timing);
        height.onfinish = () => height.cancel();
        for (const element of elements) {
          const from = before.get(element)!, to = after.get(element)!;
          if (from.x === to.x && from.y === to.y && from.height === to.height) continue;
          // Height already moves downstream layout: compensate only its starting displacement.
          const downstreamGrowth = element !== card && to.y >= toCard.bottom ? growth : 0;
          const frames: Keyframe[] = [{ transform: `translate(${from.x - to.x}px, ${from.y - to.y + downstreamGrowth}px) scale(${from.width / to.width}, 1)`, opacity: 1 }];
          if (element === card) frames.push({ transform: "translate(0, -2px) scale(1, 1)", opacity: 1, offset: .86 });
          frames.push({ transform: "translate(0, 0) scale(1, 1)", opacity: 1 });
          const animation = element.animate(frames, timing);
          animation.onfinish = () => animation.cancel();
        }
      });
    } else if (hadFocus) card.focus({ preventScroll: true });
    timers = [1000, 2300, 3900].map((delay, index) => setTimeout(() => {
      if (index < 2) setStage(index + 1);
      else resizeCard(id, () => {
        setLoadedHeads(all => ({ ...all, [id]: frozenHead })); setExpanded(all => new Set([...all, id])); setLoading(undefined); setStage(-1);
        if (owner === navigation) showReview(id, frozenHead);
      });
    }, delay));
  }
  function Heading(props: { id: number }) {
    return <><span class="repo">dispatch · PR #{props.id} · arrived {review(props.id).arrived}</span><strong class="title">{review(props.id).title}</strong><span class="meta">{review(props.id).branch}</span></>;
  }
  function LoadingSteps() {
    return <section class="capture-status capture-inline capture-enter" aria-label="Preparing branch" aria-live="polite"><div class="capture-status-title"><Icon name="branch"/><strong>Preparing your review</strong></div><div class="capture-stages"><For each={stages}>{(label, index) => <div class="capture-stage" classList={{ done: index() < stage(), current: index() === stage() }}><span class="capture-step">{index() < stage() ? "✓" : index() + 1}</span><span>{label}</span></div>}</For></div><small>SIMULATION · files appear here as soon as they're ready.</small></section>;
  }
  function activate(id: number) { if (inLocal(id)) navigate(id); else pull(id); }
  function PRCard(props: { id: number }) {
    const pr = review(props.id);
    return <article ref={element => cards.set(pr.id, element)} data-pr-id={pr.id} role="group" tabindex="-1" aria-label={`PR #${pr.id}: ${pr.title}`} aria-disabled={!inLocal(pr.id) && loading() !== undefined} class="pr-accordion-card capture-single-pr" classList={{ "has-files": expanded().has(pr.id) && loadedHeads()[pr.id] !== undefined, "is-preparing": loading() === pr.id, "is-current": view() === pr.id }}
      onClick={event => { if (!(event.target as HTMLElement).closest("button")) activate(pr.id); }} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); activate(pr.id); } }}>
      <div class="capture-pr-header"><button class="capture-pr-heading" disabled={inLocal(pr.id) && loadedHeads()[pr.id] === undefined} onClick={() => activate(pr.id)} aria-label={inLocal(pr.id) ? `Review PR #${pr.id}` : `Pull PR #${pr.id}: ${pr.title}`}><Heading id={pr.id}/></button>
      <Show when={hasDrift(pr.id)}><div class="capture-drift-control" onClick={event => event.stopPropagation()} onMouseEnter={event => showDrift(pr.id, event.currentTarget)} onMouseLeave={event => { if (!event.currentTarget.contains(document.activeElement)) setOpenDrift(undefined); }} onFocusIn={event => showDrift(pr.id, event.currentTarget)} onFocusOut={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpenDrift(undefined); }} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setOpenDrift(undefined); } }}>
        <button class="capture-drift-icon" aria-label={`Branch has changed for PR #${pr.id}`} aria-expanded={openDrift() === pr.id} aria-controls={`branch-change-${pr.id}`} onClick={event => showDrift(pr.id, event.currentTarget)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 3 22 21H2ZM12 9v5"/><circle cx="12" cy="17" r=".6"/></svg></button>
        <Show when={openDrift() === pr.id}><div id={`branch-change-${pr.id}`} class="capture-drift-popover" classList={{ above: driftAbove() }} role="group" aria-label="Branch has changed"><div class="capture-drift-content"><p>Branch has changed</p><button class="small-primary" disabled={loading() !== undefined} onClick={() => { setOpenDrift(undefined); pull(pr.id); }}>Refresh</button></div></div></Show>
      </div></Show></div>
      <div class="capture-card-warning" role="status">{loading() === pr.id ? "Getting your files ready…" : ""}</div>
      <div class="capture-card-content"><Show when={loading() === pr.id} fallback={<Show when={expanded().has(pr.id) && loadedHeads()[pr.id] !== undefined}><div class="capture-file-tree" aria-label={`Files for PR #${pr.id}`}><div class="files-heading">Files changed <span class="count">{pr.files.length}</span></div><div class="capture-tree-folder"><Icon name="folder"/>src</div><For each={pr.files}>{path => <button class="capture-tree" classList={{ selected: view() === pr.id && file() === path }} onClick={() => navigate(pr.id, path)}><Icon name="file"/>{path.split("/").pop()}</button>}</For></div></Show>}><LoadingSteps/></Show></div>
    </article>;
  }
  const inbox = <section class="inbox floating-panel"><header class="inbox-head"><div class="heading">Inbox <span class="count">5</span><span class="spacer"/><Icon name="search"/></div><span class="capture-small muted">dispatch / review workspace</span></header><div class="inbox-scroll">
    <div class="capture-divider">Local <span>{localPRs().length + 2}</span></div><For each={reviews.slice(0, 2)}>{pr => <PRCard id={pr.id}/>}</For>
    <div ref={localSlot} class="capture-local-slot"/><div ref={remoteDivider} class="capture-divider" title="Arrival order is a default, not a processing restriction">Remote <span>{remotePRs().length}</span></div><div class="capture-remote-slot"><For each={waitingPRs}>{pr => <PRCard id={pr.id}/>}</For></div><Show when={!remotePRs().length}><p class="capture-small muted capture-remote-empty">All PRs are in Local. Branch changes stay on the same cards.</p></Show>
  </div><footer class="inbox-footer"><span class="capture-small muted">SIMULATION · nothing is written</span></footer></section>;
  const chat = <section class="right floating-panel"><header class="right-head"><Icon name="comment"/><strong>Review notes</strong><span class="spacer"/><span class="chat-context">Drafts kept per review</span></header><div class="conversation"><span class="capture-eyebrow">Current review · #{view()}</span><p class="capture-note">Switch freely between PRs. Each review keeps its own unfinished notes.</p><div class="capture-draft-card"><span class="capture-eyebrow">Unfinished notes</span><p>{draft() || "No unfinished notes on this review."}</p></div><For each={finishedNotes()}>{note => <div class="capture-finished-note"><span class="capture-eyebrow">Kept separate · PR #{note.id}</span><p>{note.body}</p><small>Not attached to refreshed code.</small></div>}</For></div>
    <footer class="review-footer"><label class="summary-label" for="prototype-draft">Notes on {review(view()).title}</label><textarea id="prototype-draft" class="final-summary" value={draft()} onInput={event => setDrafts(all => ({ ...all, [view()]: { head: displayHeads()[view()], body: event.currentTarget.value } }))} placeholder="Your notes stay with this review…"/><div class="capture-notes-guard" classList={{ blocked: blocked() !== undefined }} role="status">{blocked() === undefined ? "Drafts are restored when you return. No save step needed." : `PR #${blocked()} has notes on its earlier branch. They won't be attached to changed code.`}</div><Show when={blocked() !== undefined}><button class="capture-test" onClick={keepAnchoredNotesSeparate}>Keep notes separate &amp; show latest</button></Show><p class="feedback-note">Memory only · nothing submitted or persisted.</p></footer></section>;
  return <WorkspaceShell inboxVisible={true} chatVisible={true} onWorkspace={() => {}} inbox={inbox} chat={chat}
    topbar={<header class="topbar"><span class="iconbtn"><Icon name="panel"/></span><span class="brand"><Icon name="arrow"/>dispatch</span><span class="brand-divider"/><span class="capture-small muted">Review workspace</span><div class="topbar-actions"><span class="capture-simulation">SIMULATION / THROWAWAY</span><select class="capture-check" aria-label="Simulate check outcome" value="" onChange={event => { const value = event.currentTarget.value; if (value === "clean") { setLatest(loadedHeads()[42] ?? 1); setCheck("verified"); } else if (value === "metadata-only" || value === "unknown") setCheck(value); event.currentTarget.value = ""; }}><option value="">Simulate check…</option><option value="clean">Clean · branch unchanged</option><option value="metadata-only">Metadata timestamp only</option><option value="unknown">Branch check failed</option></select><button class="capture-test" disabled={latest() === 2 && check() === "verified"} onClick={() => { setLatest(value => Math.min(2, value + 1)); setCheck("verified"); }}>Simulate branch change</button><span class="user-avatar">Y</span></div></header>}
    footer={<footer class="statusbar"><span class="status-dot"/>Branch review simulation<span class="spacer"/><span>No Git operations · no network · no publishing</span></footer>}
  >
    <div class="capture-scene-heading"><span class="capture-eyebrow">PR branch / motion study</span><h1>Click a change. Keep your place.</h1><p>Pick any Remote PR. Its card moves into Local, then its files and review appear together.</p></div>
    <div class="review-info-strip"><span class="state-pill"><Icon name="branch"/>Reviewing branch</span></div>
    <div class="capture-old-view"><h2>{review(view()).title}</h2><p class="capture-context">dispatch · {review(view()).branch}</p><div class="capture-diff" data-review-id={view()} data-head={heads[displayHeads()[view()]]} data-file={file()}><header class="file-header"><Icon name="file"/><span class="file-name">{file()}</span><span class="spacer"/><span class="stats"><span class="plus">+4</span><span class="minus">−1</span></span></header><div class="capture-hunk">Illustrative code · not repository content</div><For each={[`  // ${review(view()).branch} · ${file()}`, "  function reviewChange(branch) {", "−   return liveFiles();", displayHeads()[view()] === 2 ? "+   return branch.files.filter(isReadable);" : "+   return branch.files;", "  }"]}>{(line, index) => <div class="capture-code" classList={{ addition: line.startsWith("+"), deletion: line.startsWith("−") }}><span>{12 + index()}</span><code>{line}</code></div>}</For></div><p class="capture-reading-note"><Icon name="comment"/>Keep reading while files load. Your most recent selection always wins.</p></div>
    <div class="capture-state"><span class="capture-eyebrow">SIMULATION STATE · internal identities only</span><code>Local=[17,18,{localPRs().join(",")}] · Remote=[{remotePRs().map(pr => pr.id).join(",")}] · loading={loading() ?? "none"} · target={heads[target()]} · knownHead={heads[latest()]} · view={view()}:{heads[displayHeads()[view()]]} · check={check()}</code></div>
  </WorkspaceShell>;
}
