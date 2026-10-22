import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cargo = readFileSync(join(root, "Cargo.toml"), "utf8");
const version = cargo.match(/\[workspace\.package\]\s*\nversion\s*=\s*"([^"]+)"/)?.[1];
if (!version) throw new Error("Cannot read workspace package version");
const path = join(root, "package.json");
const original = readFileSync(path, "utf8");
const pkg = JSON.parse(original);
if (pkg.version !== version) {
  if (process.argv.includes("--check")) {
    throw new Error(`package.json version ${pkg.version} differs from Cargo workspace ${version}; run node scripts/sync-version.mjs`);
  }
  pkg.version = version;
  writeFileSync(path, `${JSON.stringify(pkg, null, "\t")}\n`);
}
