// Regenerate the app icons and macOS menu-bar artwork from the original bird.
// Developer-only tools: brew install librsvg imagemagick
// AppKit renders these 48px assets at 18pt, including on Retina displays.
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const icon = name => new URL(`../src-tauri/icons/${name}`, import.meta.url);
const source = readFileSync(icon("tray.svg"), "utf8");
// An alpha mask preserves native light/dark tinting. Eye and wing are cutouts,
// rather than greys that disappear at menu-bar size.
const shapes = source.slice(source.indexOf('<g id="legs"'), source.lastIndexOf("</svg>"))
  .replaceAll("#0E1B2A", "#FFFFFF")
  .replaceAll("#FF6B26", "#FFFFFF")
  .replace('id="wing" fill="#FFFFFF"', 'id="wing" fill="#000000"')
  .replace('id="eye-white" fill="#FFFFFF"', 'id="eye-white" fill="#000000"');
const defs = `<defs><mask id="bird" maskUnits="userSpaceOnUse" x="150" y="160" width="990" height="990">${shapes}</mask></defs>`;
const bird = '<rect x="150" y="160" width="990" height="990" fill="black" mask="url(#bird)"/>';
const svg = content => `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="150 160 990 990">${defs}${content}</svg>`;
const render = content => execFileSync("rsvg-convert", ["--width", "144", "--height", "144"], { input: svg(content) });
const template = execFileSync("magick", ["png:-", "-resize", "48x48", "PNG32:-"], { input: render(bird) });
writeFileSync(icon("tray-template.png"), template);
// The coloured badge cannot use AppKit template tinting. A thin white keyline
// keeps its monochrome bird legible on dark menu bars as well as light ones.
const outlined = execFileSync("magick", ["png:-", "(", "+clone", "-channel", "A", "-morphology", "Dilate", "Disk:4", "+channel", "-fill", "white", "-colorize", "100", ")", "+swap", "-compose", "Over", "-composite", "png:-"], { input: render(bird) });
const attention = execFileSync("magick", ["png:-", "-fill", "#F43F69", "-stroke", "white", "-strokewidth", "5", "-draw", "circle 114,114 137,114", "-resize", "48x48", "PNG32:-"], { input: outlined });
writeFileSync(icon("tray-macos-attention.png"), attention);

// Native-size count glyphs; rasterized once, never via a runtime font dependency.
const digitsSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="48">${Array.from({ length: 10 }, (_, i) => `<text x="${i * 28 + 14}" y="36" text-anchor="middle" font-family="Helvetica Neue, sans-serif" font-size="34" font-weight="500">${i}</text>`).join("")}</svg>`;
const digits = execFileSync("rsvg-convert", [], { input: digitsSvg });
writeFileSync(icon("tray-digits.png"), execFileSync("magick", ["png:-", "PNG32:-"], { input: digits }));
writeFileSync(icon("tray-digits-attention.png"), execFileSync("magick", ["png:-", "(", "+clone", "-channel", "A", "-morphology", "Dilate", "Disk:1", "+channel", "-fill", "white", "-colorize", "100", ")", "+swap", "-compose", "Over", "-composite", "PNG32:-"], { input: digits }));

// The app/Dock icon retains the original coloured artwork on a macOS-style
// rounded tile. Only the menu-bar bird is a monochrome template.
const appSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect x="64" y="64" width="896" height="896" rx="200" fill="#FCFCFC"/><svg x="110" y="100" width="804" height="804" viewBox="150 160 990 990">${source.slice(source.indexOf('<g id="legs"'), source.lastIndexOf("</svg>"))}</svg></svg>`;
const temporary = mkdtempSync(join(tmpdir(), "dispatch-icons-"));
try {
  const input = join(temporary, "bird.png");
  writeFileSync(input, execFileSync("rsvg-convert", [], { input: appSvg }));
  const output = join(temporary, "generated");
  execFileSync("sh", ["-c", 'exec pnpm "$@"', "pnpm", "exec", "tauri", "icon", input, "--output", output], { stdio: "inherit" });
  // Update existing desktop assets only; do not add mobile platforms.
  const existing = new Set(readdirSync(new URL("../src-tauri/icons/", import.meta.url)));
  for (const name of readdirSync(output)) {
    if (existing.has(name) && /\.(png|ico|icns)$/.test(name)) copyFileSync(join(output, name), icon(name));
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
