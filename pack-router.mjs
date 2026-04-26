#!/usr/bin/env node
/**
 * Rebuild ClawRouter and update the install tarball served by the backend.
 *
 * Run from the repo root:
 *   node pack-router.mjs
 *
 * What it does:
 *   1. npm run build  (in ClawRouter/)
 *   2. npm pack       (creates tokenboss-router-x.x.x.tgz)
 *   3. Moves it to    backend/public/install/tokenboss-router.tgz
 */

import { execSync } from "node:child_process";
import { renameSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..");
const ROUTER_DIR = join(ROOT, "ClawRouter");
const OUT_PATH = join(ROOT, "backend", "public", "install", "tokenboss-router.tgz");

function run(cmd, cwd) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit" });
}

// 1. Build
run("npm run build", ROUTER_DIR);

// 2. Pack
run("npm pack", ROUTER_DIR);

// 3. Find the generated .tgz and move it
const tgz = readdirSync(ROUTER_DIR).find(
  (f) => f.startsWith("tokenboss-router-") && f.endsWith(".tgz"),
);
if (!tgz) {
  console.error("npm pack did not produce a .tgz file");
  process.exit(1);
}

renameSync(join(ROUTER_DIR, tgz), OUT_PATH);
console.log(`\n✓ ${tgz}  →  backend/public/install/tokenboss-router.tgz`);
console.log("\nNext: git add -A && git commit -m 'Update router tarball' && git push");
