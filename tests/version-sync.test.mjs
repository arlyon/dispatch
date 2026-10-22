import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("release version sync detects drift, fixes it, and is idempotent", () => {
  const root = mkdtempSync(join(tmpdir(), "dispatch-version-"));
  try {
    mkdirSync(join(root, "scripts"));
    const script = join(root, "scripts/sync-version.mjs");
    copyFileSync(new URL("../scripts/sync-version.mjs", import.meta.url), script);
    writeFileSync(join(root, "Cargo.toml"), '[workspace.package]\nversion = "1.2.3"\n');
    writeFileSync(join(root, "package.json"), '{"name":"dispatch","version":"0.1.0","private":true}\n');
    assert.notEqual(spawnSync(process.execPath, [script, "--check"]).status, 0);
    execFileSync(process.execPath, [script]);
    const synced = readFileSync(join(root, "package.json"), "utf8");
    assert.deepEqual(JSON.parse(synced), { name: "dispatch", version: "1.2.3", private: true });
    execFileSync(process.execPath, [script, "--check"]);
    execFileSync(process.execPath, [script]);
    assert.equal(readFileSync(join(root, "package.json"), "utf8"), synced);
    writeFileSync(join(root, "Cargo.toml"), "[workspace]\n");
    assert.notEqual(spawnSync(process.execPath, [script]).status, 0);
    assert.equal(readFileSync(join(root, "package.json"), "utf8"), synced);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
