import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// release-plz compares Cargo package contents. The UI is outside src-tauri,
// so this tracked fingerprint makes frontend-only changes visible to it.
const paths = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--deduplicate", "-z", "--", "src", "public", "index.html", "package.json", "pnpm-lock.yaml", "tsconfig.json", "tsconfig.node.json", "vite.config.ts", "scripts/build.mjs"], { cwd: root, encoding: "utf8" })
  .split("\0").filter(Boolean).sort();
const hash = createHash("sha256");
for (const path of paths) {
  if (!existsSync(join(root, path))) continue; // Tracked deletion, not staged yet.
  let content = readFileSync(join(root, path));
  if (path === "package.json") {
    const pkg = JSON.parse(content.toString());
    delete pkg.version; // Version-only release PRs must not invalidate the UI digest.
    content = Buffer.from(JSON.stringify(pkg));
  }
  hash.update(`${path}\0${createHash("sha256").update(content).digest("hex")}\n`);
}
const expected = `${hash.digest("hex")}\n`;
const output = join(root, "src-tauri/frontend.sha256");
const actual = existsSync(output) ? readFileSync(output, "utf8") : "";
if (actual !== expected) {
  if (process.argv.includes("--check")) {
    throw new Error("Frontend fingerprint is stale; run mise run fix and include src-tauri/frontend.sha256");
  }
  writeFileSync(output, expected);
}
