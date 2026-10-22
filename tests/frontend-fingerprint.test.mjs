import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("frontend-only changes require a Cargo-visible fingerprint; version bumps do not", () => {
  const root = mkdtempSync(join(tmpdir(), "dispatch-frontend-"));
  try {
    for (const directory of ["scripts", "src", "src-tauri"]) mkdirSync(join(root, directory));
    execFileSync("git", ["init", "--quiet", root]);
    const script = join(root, "scripts/frontend-fingerprint.mjs");
    copyFileSync(new URL("../scripts/frontend-fingerprint.mjs", import.meta.url), script);
    writeFileSync(join(root, "package.json"), '{"version":"0.1.0","name":"dispatch"}');
    const source = join(root, "src/App.tsx");
    writeFileSync(source, "first version");
    const check = () => spawnSync(process.execPath, [script, "--check"]).status;
    const sync = () => execFileSync(process.execPath, [script]);
    assert.notEqual(check(), 0);
    sync();
    assert.equal(check(), 0);
    const fingerprint = readFileSync(join(root, "src-tauri/frontend.sha256"), "utf8");
    writeFileSync(join(root, "package.json"), '{"version":"0.2.0","name":"dispatch"}');
    assert.equal(check(), 0);
    writeFileSync(source, "frontend-only change");
    assert.notEqual(check(), 0);
    sync();
    assert.notEqual(readFileSync(join(root, "src-tauri/frontend.sha256"), "utf8"), fingerprint);
    execFileSync("git", ["add", "src/App.tsx"], { cwd: root });
    rmSync(source);
    assert.notEqual(check(), 0);
    sync();
    assert.equal(check(), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
