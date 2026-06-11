import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const constsPath = path.join(repoRoot, "gta3", "consts.json");

interface OldConstsData {
  enums: Record<string, unknown>;
  constants: Record<string, number>;
}

// Read old format
const oldData = JSON.parse(fs.readFileSync(constsPath, "utf8")) as OldConstsData;

// Extract just constants and flatten
const flattenedConstants = oldData.constants;

// Write back flattened
fs.writeFileSync(constsPath, JSON.stringify(flattenedConstants, null, 2));

console.log(`✓ Flattened consts.json`);
console.log(`  - Removed enums section: ${JSON.stringify(oldData.enums).length} bytes`);
console.log(`  - New file size: ${JSON.stringify(flattenedConstants).length} bytes`);
console.log(`  - Savings: ${(JSON.stringify(oldData.enums).length / JSON.stringify(oldData).length * 100).toFixed(1)}%`);
