import { build } from "esbuild";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import sharp from "sharp";
await build({
  entryPoints: {
    background: "src/background.mjs",
    provider: "src/provider.mjs",
    bridge: "src/bridge.mjs",
  },
  bundle: true,
  outdir: "dist",
  format: "esm",
  platform: "browser",
  target: "chrome120",
  minify: true,
  sourcemap: false,
});
await copyFile(
  "pkg/requant_extension_core_bg.wasm",
  "dist/requant_extension_core_bg.wasm",
);
await copyFile("vendor/LICENSE", "dist/THIRD-PARTY-LICENSE.txt");
await mkdir("dist/icons", { recursive: true });
const mark = await readFile("public/requant-mark.svg");
for (const size of [16, 32, 48, 128])
  await sharp(mark).resize(size, size).png().toFile(`dist/icons/${size}.png`);
const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
if (
  manifest.manifest_version !== 3 ||
  manifest.background.service_worker !== "background.js"
)
  throw new Error("Unexpected extension manifest.");
console.log("Manifest V3 extension built in dist/");
