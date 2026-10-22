import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createManifest } from "../scripts/updater-artifacts.mjs";
const config = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const signature = readFileSync(new URL("./fixtures/updater-validation.sig", import.meta.url), "utf8");
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "dispatch-updater-"));
  for (const name of ["Dispatch-0.1.2.x86_64.rpm", "Dispatch_0.1.2_amd64.AppImage", "Dispatch.app.tar.gz"]) {
    writeFileSync(join(root, name), "fixture");
    writeFileSync(join(root, name + ".sig"), signature);
  }
  return root;
}
test("updater feed keeps RPM and AppImage targets distinct and requires every signature", () => {
  const root = fixture();
  try {
    const manifest = createManifest(root, "0.1.2", config.plugins.updater.pubkey);
    assert.deepEqual(Object.keys(manifest.platforms), ["linux-x86_64-rpm", "linux-x86_64-appimage", "darwin-aarch64"]);
    assert.ok(manifest.platforms["linux-x86_64-rpm"].url.endsWith(".rpm"));
    assert.ok(manifest.platforms["linux-x86_64-appimage"].url.endsWith(".AppImage"));
    assert.ok(!("linux-x86_64" in manifest.platforms), "no cross-format fallback");
    assert.throws(() => createManifest(root, "0.1.3", config.plugins.updater.pubkey), /release version/);
    rmSync(join(root, "Dispatch.app.tar.gz.sig"));
    assert.throws(() => createManifest(root, "0.1.2", config.plugins.updater.pubkey));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("updater publication fails closed for wrong keys and duplicate artifacts", () => {
  const root = fixture();
  try {
    const wrongKey = Buffer.from("untrusted comment: wrong key\n" + Buffer.alloc(42, 1).toString("base64") + "\n").toString("base64");
    assert.throws(() => createManifest(root, "0.1.2", wrongKey), /signing key/);
    writeFileSync(join(root, "duplicate.rpm"), "fixture");
    assert.throws(() => createManifest(root, "0.1.2", config.plugins.updater.pubkey), /exactly one/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("trusted updater signing is absent from ordinary CI and publication includes the feed", () => {
  const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.ok(!ci.split("\n  verify-signing:")[0].includes("secrets.TAURI_SIGNING"));
  const release = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  assert.ok(release.includes("scripts/updater-artifacts.mjs installers"));
  assert.ok(release.includes("-name 'latest.json'"));
  assert.ok(release.includes("-name '*.sig'"));
  assert.ok(!release.includes("deploy-pages"));
  assert.equal(config.plugins.updater.requireSignedVersion, true);
  assert.ok(ci.includes("timeout-minutes: 8"));
  assert.ok(ci.includes("Acquire::Retries=2"));
  assert.ok(!release.includes("\nconcurrency:"), "CI must not hold a workflow-wide release lock");
  for (const group of ["dispatch-release-tags", "dispatch-release-publication", "dispatch-release-pr"]) assert.ok(release.includes(`group: ${group}`));
  assert.ok(release.includes('--latest="$make_latest"'), "older recoveries must not replace a newer updater feed");
});
