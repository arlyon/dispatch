import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = new URL("../scripts/macos-signing.sh", import.meta.url).pathname;
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "dispatch-signing-test-"));
  const tools = join(root, "tools"); mkdirSync(tools);
  const helper = (name, source) => {
    const path = join(tools, name);
    writeFileSync(path, `#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);\n${source}\n`);
    chmodSync(path, 0o755);
  };
  helper("uname", "console.log('Darwin');");
  helper("openssl", `
    if(args[0]==='version')console.log('OpenSSL 3.6 fixture');
    if(args[0]==='rand')console.log('fixture-keychain-password');
    if(args[0]==='pkcs12'&&process.env.FAIL_P12)process.exit(1);
    if(args.includes('-out'))fs.writeFileSync(args[args.indexOf('-out')+1],args.includes('-nokeys')?'-----BEGIN CERTIFICATE-----\\nfixture\\n-----END CERTIFICATE-----\\n':'fixture');
  `);
  helper("security", `
    fs.appendFileSync(process.env.TEST_SECURITY_LOG,JSON.stringify(args)+'\\n');
    if(args[0]==='list-keychains'&&!args.includes('-s'))console.log('  "/tmp/login with spaces.keychain-db"');
    if(args[0]==='list-keychains'&&args.includes('-s')&&process.env.FAIL_RESTORE)process.exit(1);
    if(args[0]==='create-keychain')fs.writeFileSync(args.at(-1),'fixture');
    if(args[0]==='find-identity')console.log('1) FAKEHASH "'+(process.env.IDENTITY||'Developer ID Application: Fixture (ABCDEFGHIJ)')+'"');
    if(args[0]==='delete-keychain')fs.unlinkSync(args.at(-1));
  `);
  helper("codesign", `
    if(process.env.FAIL_CODESIGN)process.exit(1);
    if(args.includes('--display')) {
      console.error('Authority='+(process.env.AUTHORITY||'Developer ID Application: Fixture (ABCDEFGHIJ)'));
      console.error('TeamIdentifier='+(process.env.TEAM||'ABCDEFGHIJ'));
      console.error('CodeDirectory flags='+(process.env.FLAGS||'0x10000(runtime)'));
      console.error('Timestamp='+(process.env.STAMP||'Oct 22 2026'));
    }
  `);
  helper("xcrun", "if(process.env.FAIL_STAPLE)process.exit(1);");
  helper("spctl", "if(process.env.FAIL_GATEKEEPER)process.exit(1);console.error(process.env.ASSESSMENT||'fixture: accepted\\nsource=Notarized Developer ID');");
  const env = {
    ...process.env, PATH: `${tools}:${process.env.PATH}`, GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch",
    RUNNER_TEMP: root, GITHUB_ENV: join(root, "environment"), TEST_SECURITY_LOG: join(root, "security.jsonl"), APPLE_TEAM_ID: "ABCDEFGHIJ",
    MACOS_CERTIFICATE_P12_BASE64: Buffer.from("fixture-p12").toString("base64"), MACOS_CERTIFICATE_PASSWORD: "fixture-password",
    APP_STORE_CONNECT_ISSUER_ID: "11111111-2222-3333-4444-555555555555", APP_STORE_CONNECT_KEY_ID: "1234567890", APP_STORE_CONNECT_PRIVATE_KEY: "fixture-p8",
  };
  const run = (args, extra = {}) => spawnSync("bash", [script, ...args], { env: { ...env, ...extra }, encoding: "utf8" });
  return { root, env, run, close: () => rmSync(root, { recursive: true, force: true }) };
}

test("signing install rejects untrusted events, missing credentials and malformed identifiers", () => {
  const f = fixture();
  try {
    for (const extra of [{ GITHUB_ACTIONS: "false" }, { GITHUB_EVENT_NAME: "pull_request" }, { GITHUB_EVENT_NAME: "pull_request_target" }, { APP_STORE_CONNECT_PRIVATE_KEY: "" }, { APPLE_TEAM_ID: "wrong" }, { APP_STORE_CONNECT_ISSUER_ID: "------------------------------------" }]) {
      const result = f.run(["install"], extra);
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(join(f.root, "dispatch-signing")), false);
      assert.ok(!result.stdout.includes("fixture-password"));
      assert.ok(!result.stderr.includes("fixture-p8"));
    }
  } finally { f.close(); }
});

test("install selects a valid Developer ID team identity and cleanup restores keychains", () => {
  const f = fixture();
  try {
    const result = f.run(["install"]); assert.equal(result.status, 0, result.stderr);
    const config = readFileSync(f.env.GITHUB_ENV, "utf8");
    assert.match(config, /APPLE_SIGNING_IDENTITY=Developer ID Application: Fixture \(ABCDEFGHIJ\)/);
    assert.match(config, /APPLE_API_KEY_PATH=.*AuthKey_1234567890\.p8/);
    assert.ok(!config.includes("fixture-p8") && !config.includes("fixture-password") && !config.includes("fixture-keychain-password"));
    assert.equal(statSync(join(f.root, "dispatch-signing")).mode & 0o077, 0);
    assert.equal(statSync(join(f.root, "dispatch-signing/AuthKey_1234567890.p8")).mode & 0o077, 0);
    assert.equal(existsSync(join(f.root, "dispatch-signing/private-key.pem")), false);
    assert.equal(existsSync(join(f.root, "dispatch-signing/import-key.pem")), false);
    assert.equal(f.run(["cleanup"]).status, 0);
    assert.equal(existsSync(join(f.root, "dispatch-signing")), false);
    const commands = readFileSync(f.env.TEST_SECURITY_LOG, "utf8").trim().split("\n").map(JSON.parse);
    const lists = commands.filter(args => args[0] === "list-keychains" && args.includes("-s"));
    assert.deepEqual(lists.at(-1), ["list-keychains", "-d", "user", "-s", "/tmp/login with spaces.keychain-db"]);
    assert.ok(!commands.some(args => args.includes("-A")), "certificate access is not granted to all applications");
  } finally { f.close(); }
});

test("an iOS certificate or wrong team never silently falls back to ad-hoc signing", () => {
  for (const identity of ["Apple Distribution: Fixture (ABCDEFGHIJ)", "Developer ID Application: Fixture (ZZZZZZZZZZ)"]) {
    const f = fixture();
    try {
      assert.notEqual(f.run(["install"], { IDENTITY: identity }).status, 0);
      assert.equal(existsSync(f.env.GITHUB_ENV), false);
      assert.equal(f.run(["cleanup"]).status, 0);
    } finally { f.close(); }
  }
});

test("invalid P12 credentials fail before key import and never export signing environment", () => {
  const f = fixture();
  try {
    assert.notEqual(f.run(["install"], { FAIL_P12: "1" }).status, 0);
    assert.equal(existsSync(f.env.GITHUB_ENV), false);
    const commands = readFileSync(f.env.TEST_SECURITY_LOG, "utf8").trim().split("\n").map(JSON.parse);
    assert.ok(!commands.some(args => args[0] === "import"));
    assert.equal(f.run(["cleanup"]).status, 0);
  } finally { f.close(); }
});

test("cleanup removes private files even when restoring keychain search fails", () => {
  const f = fixture();
  try {
    assert.equal(f.run(["install"]).status, 0);
    assert.notEqual(f.run(["cleanup"], { FAIL_RESTORE: "1" }).status, 0);
    assert.equal(existsSync(join(f.root, "dispatch-signing")), false);
  } finally { f.close(); }
});

test("verification fails on any nested signature, team, runtime, timestamp, ticket or Gatekeeper error", () => {
  const f = fixture();
  try {
    const app = join(f.root, "Dispatch with spaces.app"), dmg = join(f.root, "Dispatch with spaces.dmg");
    mkdirSync(join(app, "Contents/MacOS"), { recursive: true });
    for (const name of ["dispatch", "dispatch-review", "ferropi"]) writeFileSync(join(app, "Contents/MacOS", name), "fixture");
    writeFileSync(dmg, "fixture");
    assert.equal(f.run(["verify", app, dmg]).status, 0);
    for (const extra of [{ FAIL_CODESIGN: "1" }, { AUTHORITY: "adhoc" }, { TEAM: "ZZZZZZZZZZ" }, { FLAGS: "0x0(none)" }, { STAMP: "none" }, { FAIL_STAPLE: "1" }, { FAIL_GATEKEEPER: "1" }, { ASSESSMENT: "assessments disabled" }]) {
      assert.notEqual(f.run(["verify", app, dmg], extra).status, 0, JSON.stringify(extra));
    }
    rmSync(join(app, "Contents/MacOS/ferropi"));
    assert.notEqual(f.run(["verify", app, dmg]).status, 0);
  } finally { f.close(); }
});

test("only dedicated signing calls forward the required Apple secrets and publication needs the signed artifact", () => {
  const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const signing = readFileSync(new URL("../.github/workflows/sign-macos.yml", import.meta.url), "utf8");
  const release = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  assert.match(ci, /github\.event_name == 'workflow_dispatch' && inputs\.verify_macos_signing/);
  const ordinaryCI = ci.split("\n  verify-signing:")[0];
  assert.ok(!ordinaryCI.includes("secrets.MACOS_CERTIFICATE") && !ordinaryCI.includes("secrets.APP_STORE_CONNECT"));
  const manualCaller = ci.split("\n  verify-signing:")[1];
  const releaseCaller = release.split("\n  sign-macos:")[1].split("\n  publish:")[0];
  for (const name of ["MACOS_CERTIFICATE_P12_BASE64", "MACOS_CERTIFICATE_PASSWORD", "APP_STORE_CONNECT_ISSUER_ID", "APP_STORE_CONNECT_KEY_ID", "APP_STORE_CONNECT_PRIVATE_KEY"]) {
    assert.ok(signing.includes(`${name}:\n        required: true`), `${name} must be declared required`);
    for (const caller of [manualCaller, releaseCaller]) {
      assert.ok(caller.includes(name + ": ${{ secrets." + name + " }}"), `${name} must be explicitly forwarded`);
    }
  }
  assert.ok(!manualCaller.includes("secrets: inherit") && !releaseCaller.includes("secrets: inherit"));
  assert.ok(ci.includes('"$SOURCE_REF" =~ ^[a-f0-9]{40}$'), "manual signing sources are immutable");
  assert.match(signing, /github\.event_name != 'pull_request' && github\.event_name != 'pull_request_target'/);
  assert.match(signing, /environment:\n\s+name: production/);
  assert.match(signing, /ref: \$\{\{ needs\.source\.outputs\.sha \}\}/);
  assert.match(signing, /if: always\(\)\n\s+run: bash scripts\/macos-signing\.sh cleanup/);
  assert.match(release, /needs: \[ci, release, sign-macos\]/);
  assert.match(release, /name: dispatch-macos-aarch64-signed/);
  assert.ok(!release.includes("pattern: dispatch-*"));
});
