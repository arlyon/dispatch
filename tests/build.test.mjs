import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("native packaging stages Ferropi once, normalizes permissions, and propagates failure", () => {
  const root = mkdtempSync(join(tmpdir(), "dispatch-build-"));
  try {
    for (const directory of ["scripts", "tools", "src-tauri/icons", "target/debug", "target/release"]) {
      mkdirSync(join(root, directory), { recursive: true });
    }
    copyFileSync(new URL("../scripts/build.mjs", import.meta.url), join(root, "scripts/build.mjs"));
    writeFileSync(join(root, "src-tauri/tauri.conf.json"), JSON.stringify({ bundle: { icon: ["icons/test.png"] } }));
    writeFileSync(join(root, "src-tauri/icons/test.png"), "fixture");
    const helper = (name, content) => {
      const path = join(root, "tools", name);
      writeFileSync(path, `#!${process.execPath}\n${content}\n`);
      chmodSync(path, 0o755);
    };
    helper("cargo", `
      const fs = require('node:fs');
      if (process.argv[2] === 'metadata') console.log(JSON.stringify({ target_directory: process.cwd() + '/target' }));
      else {
        const profile = process.argv.includes('--release') ? 'release' : 'debug';
        fs.writeFileSync('target/' + profile + '/ferropi', profile, {mode: 0o700});
      }
    `);
    helper("rustc", "console.log('host: x86_64-unknown-linux-gnu');");
    helper("pnpm", `
      const fs = require('node:fs');
      const assert = require('node:assert/strict');
      const args = process.argv.slice(2);
      fs.appendFileSync('commands.jsonl', JSON.stringify(args) + '\\n');
      if (args[0] !== 'tauri') process.exit(0);
      const config = JSON.parse(args[args.indexOf('--config') + 1]);
      const profile = args.includes('--debug') ? 'debug' : 'release';
      assert.deepEqual(config.bundle.externalBin, ['binaries/' + profile + '/ferropi']);
      if (args[1] === 'build') {
        assert(args.includes('--no-bundle'));
        for (const name of ['dispatch', 'dispatch-review']) fs.writeFileSync('target/' + profile + '/' + name, 'fixture', {mode: 0o700});
      } else if (args[1] === 'bundle') {
        for (const name of ['dispatch', 'dispatch-review', 'ferropi']) assert.equal(fs.statSync('target/' + profile + '/' + name).mode & 0o777, 0o755);
        assert.equal(fs.statSync('src-tauri/binaries/' + profile + '/ferropi-x86_64-unknown-linux-gnu').mode & 0o777, 0o755);
        for (const icon of config.bundle.icon) assert.equal(fs.statSync('src-tauri/' + icon).mode & 0o777, 0o644);
        if (process.env.FAIL_BUNDLE) process.exit(7);
      }
    `);
    const env = { ...process.env, PATH: `${join(root, "tools")}:${process.env.PATH}` };
    const run = (extraEnv = {}, args = ["--debug"]) => spawnSync(process.execPath, [join(root, "scripts/build.mjs"), ...args], { cwd: root, env: { ...env, ...extraEnv }, encoding: "utf8" });
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    const commands = readFileSync(join(root, "commands.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    assert.deepEqual(commands.map((args) => args.slice(0, 2)), [["build"], ["tauri", "build"], ["tauri", "bundle"]]);
    const release = run({}, []);
    assert.equal(release.status, 0, release.stderr);
    for (const profile of ["debug", "release"]) {
      assert.equal(readFileSync(join(root, `src-tauri/binaries/${profile}/ferropi-x86_64-unknown-linux-gnu`), "utf8"), profile);
    }
    assert.notEqual(run({ FAIL_BUNDLE: "1" }).status, 0);
    assert.notEqual(run({}, ["--unknown"]).status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
