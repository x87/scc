import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(repoRoot, "src", "browser-entry.ts");
const outfile = path.join(repoRoot, "web", "converter.js");
const webConfigsRoot = path.join(repoRoot, "web", "configs");

function copyBrowserConfigs(configFolders: string[]): void {
  fs.mkdirSync(webConfigsRoot, { recursive: true });
  for (const folder of configFolders) {
    const srcDir = path.join(repoRoot, folder);
    const dstDir = path.join(webConfigsRoot, folder);
    fs.mkdirSync(dstDir, { recursive: true });
    const commandJson = `${path.basename(folder)}.json`;
    for (const file of [commandJson, "vars.json", "consts.json", "objs.json", "enums.json"]) {
      const src = path.join(srcDir, file);
      if (!fs.existsSync(src)) {
        throw new Error(`Missing required browser config file: ${path.join(folder, file)}`);
      }
      fs.copyFileSync(src, path.join(dstDir, file));
    }
  }
}

const result = await Bun.build({
  entrypoints: [entry],
  target: "browser",
  format: "iife",
  minify: false,
  sourcemap: "none",
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

if (!result.outputs || result.outputs.length === 0) {
  throw new Error("Bun.build produced no output artifacts for browser bundle.");
}

await Bun.write(outfile, result.outputs[0]!);

copyBrowserConfigs(["gta3", "vc"]);

const size = fs.statSync(outfile).size;
console.log(`✓ Bundled converter to ${outfile}`);
console.log(`  - Entry: ${entry}`);
console.log(`  - File size: ${size} bytes`);
console.log(`  - Config assets: ${webConfigsRoot}`);
