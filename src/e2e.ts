#!/usr/bin/env bun
/**
 * Mirror-convert GTA_III_SCRIPT-master → output tree; assert .js count matches .sc count.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { convertTree } from "./cli.ts";

function countByExt(dir: string, ext: string): number {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) n += countByExt(p, ext);
    else if (e.name.endsWith(ext)) n += 1;
  }
  return n;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputDir = path.join(repoRoot, "GTA_III_SCRIPT-master");
const outRoot = path.join(repoRoot, ".e2e-mirror-out");

if (!fs.existsSync(inputDir)) {
  console.error("Missing", inputDir);
  process.exit(1);
}

fs.rmSync(outRoot, { recursive: true, force: true });
convertTree(repoRoot, inputDir, outRoot, false, "gta3");

const scn = countByExt(inputDir, ".sc");
const jsCount = countByExt(outRoot, ".js");

if (jsCount !== scn) {
  console.error(`Expected ${scn} .js files (one per .sc), found ${jsCount} under ${outRoot}`);
  process.exit(1);
}

console.log(`e2e ok: ${scn} scripts mirrored → ${outRoot}`);
