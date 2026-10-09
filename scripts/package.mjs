import { spawnSync } from "node:child_process";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const p = JSON.parse(await readFile("package.json", "utf8"));
await mkdir("artifacts", { recursive: true });
const name = `Requant-Wallet-Extension_${p.version}_chromium-testnet.zip`;
await rm(resolve("artifacts", name), { force: true });
const zip = spawnSync("zip", ["-q", "-r", resolve("artifacts", name), "."], {
  cwd: "dist",
  stdio: "inherit",
});
if (zip.status !== 0) process.exit(zip.status ?? 1);
const digest = createHash("sha256")
  .update(await readFile(`artifacts/${name}`))
  .digest("hex");
await writeFile("artifacts/SHA256SUMS.txt", `${digest}  ${name}\n`);
const git = spawnSync(
  process.platform === "darwin"
    ? "/Library/Developer/CommandLineTools/usr/bin/git"
    : "git",
  ["rev-parse", "HEAD"],
  { encoding: "utf8" },
);
await writeFile(
  "artifacts/build-manifest.json",
  JSON.stringify(
    {
      product: "Requant Wallet Extension",
      version: p.version,
      network: "testnet",
      platforms: ["Chrome", "Edge", "Brave"],
      sourceCommit: git.status === 0 ? git.stdout.trim() : null,
      sha256: digest,
      manifestVersion: 3,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Created artifacts/${name}`);
