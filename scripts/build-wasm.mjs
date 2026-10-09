import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
const sibling = resolve("../requant-wallet/.build-tools");
const env = { ...process.env };
if (!env.CARGO_HOME && existsSync(`${sibling}/cargo/bin/cargo`)) {
  env.CARGO_HOME = `${sibling}/cargo`;
  env.RUSTUP_HOME = `${sibling}/rustup`;
  env.PATH = `${sibling}/cargo/bin:${env.PATH}`;
}
if (process.platform === "darwin")
  env.DEVELOPER_DIR = "/Library/Developer/CommandLineTools";
function run(command, args) {
  const p = spawnSync(command, args, { env, stdio: "inherit" });
  if (p.error) throw p.error;
  if (p.status !== 0) process.exit(p.status ?? 1);
}
run("cargo", [
  "build",
  "--locked",
  "-p",
  "requant-extension-core",
  "--release",
  "--target",
  "wasm32-unknown-unknown",
]);
mkdirSync("pkg", { recursive: true });
run("wasm-bindgen", [
  "target/wasm32-unknown-unknown/release/requant_extension_core.wasm",
  "--target",
  "web",
  "--out-dir",
  "pkg",
]);
