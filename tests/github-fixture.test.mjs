import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function fixture(plan) {
  const root = mkdtempSync(join(tmpdir(), "dispatch-gh-fixture-"));
  const script = join(root, "fake-gh.cjs");
  copyFileSync(new URL("./fixtures/fake-gh.cjs", import.meta.url), script);
  writeFileSync(join(root, "plan.json"), JSON.stringify(plan));
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, "api", "fixture"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { stderr += data; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(stdout) : reject(Error(`Fixture exited ${code}: ${stderr}`)));
  });
  return { root, run, close: () => rmSync(root, { recursive: true, force: true }) };
}

test("concurrent gh invocations consume distinct replies and preserve the call counter", async () => {
  const count = 16;
  const f = fixture(Array.from({ length: count }, (_, index) => ({ stdout: JSON.stringify({ index }) })));
  try {
    const replies = await Promise.all(Array.from({ length: count }, () => f.run()));
    assert.deepEqual(replies.map(text => JSON.parse(text).index).sort((a, b) => a - b), Array.from({ length: count }, (_, i) => i));
    assert.equal(Number(readFileSync(join(f.root, "count"), "utf8")), count);
    assert.equal(readFileSync(join(f.root, "calls.jsonl"), "utf8").trim().split("\n").length, count);
  } finally { f.close(); }
});

test("gh fixture drains a large JSON response before exiting", async () => {
  const value = { body: "x".repeat(1024 * 1024) };
  const f = fixture([{ stdout: JSON.stringify(value) }]);
  try { assert.deepEqual(JSON.parse(await f.run()), value); }
  finally { f.close(); }
});
