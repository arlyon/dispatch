import type { JSX } from "solid-js";
export default function WorkspaceShell(props: { topbar: JSX.Element; inbox: JSX.Element; chat: JSX.Element; footer: JSX.Element; children: JSX.Element; inboxVisible: boolean; chatVisible: boolean; onWorkspace: (element: HTMLElement) => void }) {
  return <div class="dispatch-shell" classList={{"inbox-hidden":!props.inboxVisible,"chat-hidden":!props.chatVisible}}>{props.topbar}<div class="app-grid"><aside class="inbox-wrap" aria-label="Review inbox">{props.inbox}</aside><main class="workspace" ref={props.onWorkspace}>{props.children}</main><aside class="chat-wrap" aria-label="Review conversation">{props.chat}</aside></div>{props.footer}</div>;
}
