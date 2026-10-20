import { Show } from "solid-js";
const paths = {
  edit: "m15 4 5 5M4 20l5-1L21 7l-5-5L4 14z", trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  panel: "M9 4v16", right: "M15 4v16", search: "m15 15 5 5", refresh: "M20 7v5h-5M19 12a7 7 0 1 1-2-6", file: "M14 3H5v18h14V8zM14 3v5h5", folder: "M3 7h7l2-3h9v15H3z", chevron: "m9 6 6 6-6 6", branch: "M6 7v10M18 7c0 6-12 3-12 8", arrow: "M6 18 18 6M7 6h11v11", close: "m6 6 12 12M18 6 6 18", comment: "M4 4h16v12H9l-5 4z", archive: "M4 8h16v12H4zM3 3h18v5H3zM9 12h6", check: "m5 12 4 4L19 6", plus: "M12 5v14M5 12h14",
};
export type IconName = keyof typeof paths;
export default function Icon(props: { name: IconName; class?: string }) {
  return <svg class={props.class} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><Show when={props.name === "panel" || props.name === "right"}><rect x="3" y="4" width="18" height="16" rx="3" /></Show><Show when={props.name === "search"}><circle cx="10" cy="10" r="6" /></Show><Show when={props.name === "branch"}><circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="6" cy="19" r="2"/></Show><path d={paths[props.name]} /></svg>;
}
