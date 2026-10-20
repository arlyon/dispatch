// Non-LLM async runner adapter. The CLI, not this adapter, waits for feedback.
const { spawn } = require("node:child_process");
const path = require("node:path");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { input += chunk; });
process.stdin.on("end", () => {
  try {
    const match = input.match(/^DISPATCH_WAIT=(\{[^\n]+\})\s*$/m);
    if (!match) throw Error("Task requires one DISPATCH_WAIT={\"id\":\"review UUID\"} line");
    const task = JSON.parse(match[1]);
    if (typeof task.id !== "string" || !/^[a-f0-9-]{36}$/.test(task.id)) throw Error("Invalid review id");
    const env = { ...process.env };
    if (task.directory !== undefined) {
      if (typeof task.directory !== "string" || !path.isAbsolute(task.directory)) throw Error("Review directory must be absolute");
      env.DISPATCH_REVIEW_DIR = task.directory;
    }
    const binary = path.resolve(__dirname, "../src-tauri/target/debug", process.platform === "win32" ? "dispatch-review.exe" : "dispatch-review");
    const child = spawn(binary, ["wait", task.id], { env, stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", error => { console.error(error.message); process.exitCode = 1; });
    child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
    for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
});
