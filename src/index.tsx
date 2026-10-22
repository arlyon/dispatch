/* @refresh reload */
import { lazy } from "solid-js";
import { render } from "solid-js/web";
import App from "./App";

// Never mount native IPC, polling, or storage-backed App state in this read-only simulation.
const Root = import.meta.env.DEV && new URLSearchParams(location.search).get("prototype") === "pr-capture"
  ? lazy(() => import("./components/PRCapturePrototype"))
  : App;
render(() => <Root />, document.getElementById("root") as HTMLElement);
