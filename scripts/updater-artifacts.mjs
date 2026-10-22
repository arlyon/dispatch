import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, lstatSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function installerFiles(root) {
  return readdirSync(root).flatMap(name => {
    const path = join(root, name), stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw Error("Installer artifacts must not contain symlinks");
    return stat.isDirectory() ? installerFiles(path) : [path];
  });
}
export function createManifest(root, version, publicKey) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error("Expected a stable release version");
  const files = installerFiles(root);
  const keyId = box => Buffer.from(Buffer.from(box.trim(), "base64").toString("utf8").split("\n")[1] || "", "base64").subarray(2, 10).toString("hex");
  const expectedKey = keyId(publicKey);
  if (expectedKey.length !== 16) throw Error("Invalid embedded updater public key");
  const formats = [
    ["linux-x86_64-rpm", path => path.endsWith(".rpm")],
    ["linux-x86_64-appimage", path => path.endsWith(".AppImage")],
    ["darwin-aarch64", path => path.endsWith(".app.tar.gz")],
  ];
  const platforms = {};
  for (const [target, matches] of formats) {
    const candidates = files.filter(matches);
    if (candidates.length !== 1) throw Error(`Expected exactly one ${target} update artifact`);
    const path = candidates[0];
    if (!lstatSync(path).size) throw Error(`Empty ${target} artifact`);
    const signature = readFileSync(path + ".sig", "utf8").trim();
    // Tauri performs cryptographic verification in the client. These checks also
    // catch accidental publisher key/version mismatches before release.
    if (keyId(signature) !== expectedKey) throw Error("Updater signing key does not match the embedded public key");
    const comment = Buffer.from(signature, "base64").toString("utf8");
    if (!comment.split("\n").some(line => line.startsWith("trusted comment:") && line.endsWith(`\tversion:${version}`))) throw Error("Updater signature is not bound to the release version");
    platforms[target] = { signature, url: `https://github.com/arlyon/dispatch/releases/download/v${version}/${encodeURIComponent(basename(path))}` };
  }
  return { version, notes: `Dispatch ${version}`, pub_date: new Date().toISOString(), platforms };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [root, tag] = process.argv.slice(2);
  if (!root || !/^v\d+\.\d+\.\d+$/.test(tag || "")) throw Error("Usage: node scripts/updater-artifacts.mjs INSTALLERS vX.Y.Z");
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY || !process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD) throw Error("Missing updater signing credentials");
  const version = tag.slice(1);
  for (const path of installerFiles(root).filter(path => path.endsWith(".rpm") || path.endsWith(".AppImage"))) {
    // Keep private key/password exclusively in the subprocess environment.
    execFileSync("sh", ["-c", 'exec pnpm tauri signer sign --app-version "$1" "$2"', "updater-sign", version, path], { stdio: "inherit" });
  }
  const config = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  writeFileSync(join(root, "latest.json"), JSON.stringify(createManifest(root, version, config.plugins.updater.pubkey), null, 2) + "\n");
}
