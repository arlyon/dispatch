import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
process.chdir(root);
// Installers must be usable by normal users even from a private (0077) shell.
process.umask(0o022);
const args = process.argv.slice(2);
if (args.some((arg) => !["--debug", "--dev"].includes(arg))) {
  throw new Error("Usage: node scripts/build.mjs [--debug | --dev]");
}
if (!["linux", "darwin"].includes(process.platform)) {
  throw new Error("Dispatch packaging currently supports Linux and macOS only");
}
const dev = args.includes("--dev");
const debug = dev || args.includes("--debug");
const run = (command, args) => execFileSync(command, args, { stdio: "inherit" });
const profile = debug ? [] : ["--release"];

if (!dev) run("pnpm", ["build"]);
run("cargo", ["build", "--locked", ...profile, "-p", "ferropi", "--bin", "ferropi"]);
const metadata = JSON.parse(execFileSync("cargo", ["metadata", "--no-deps", "--format-version", "1"], { encoding: "utf8" }));
const host = execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(/^host: (.+)$/m)?.[1];
if (!host) throw new Error("Cannot determine the native Rust target");
// Keep profiles separate: a concurrent debug build must never replace a
// release sidecar while Tauri is packaging it.
const staging = join("binaries", debug ? "debug" : "release");
const binaries = join(root, "src-tauri", staging);
mkdirSync(binaries, { recursive: true });
const output = join(metadata.target_directory, debug ? "debug" : "release");
const sidecar = join(binaries, `ferropi-${host}`);
copyFileSync(join(output, "ferropi"), sidecar);
chmodSync(sidecar, 0o755);
const icons = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8")).bundle.icon.map((icon) => {
  const staged = join(staging, icon);
  const destination = join(root, "src-tauri", staged);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(root, "src-tauri", icon), destination);
  chmodSync(destination, 0o644);
  return staged;
});
// Inject sidecars only for this build. Plain cargo checks do not require
// generated binaries to exist in a fresh checkout.
// Tauri already bundles dispatch-review as another binary in its own crate.
const config = { bundle: { externalBin: [`${staging}/ferropi`], icon: icons } };
if (!dev) config.build = { beforeBuildCommand: "" };
const bundles = process.platform === "darwin" ? (debug ? "app" : "app,dmg") : (debug ? "rpm" : "deb,rpm,appimage");
const configArgs = ["--config", JSON.stringify(config)];
const debugArgs = debug ? ["--debug"] : [];
run("pnpm", ["tauri", dev ? "dev" : "build", ...(!dev ? ["--no-bundle", ...debugArgs] : []), ...configArgs]);
if (!dev) {
  // Cargo may reuse binaries produced earlier under a restrictive umask.
  for (const binary of ["dispatch", "dispatch-review", "ferropi"]) {
    const path = join(output, binary);
    if (!existsSync(path)) throw new Error(`Missing packaged executable: ${path}`);
    chmodSync(path, 0o755);
  }
  run("pnpm", ["tauri", "bundle", "--bundles", bundles, ...debugArgs, ...configArgs]);
}
