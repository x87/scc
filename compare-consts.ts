import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const constsPath = path.join(repoRoot, "gta3", "consts.json");

interface ConstsData {
  enums: Record<string, { global?: boolean; constants?: string[] }>;
  constants: Record<string, number>;
}

const consts = JSON.parse(fs.readFileSync(constsPath, "utf8")) as ConstsData;

const enumKeys = Object.keys(consts.enums);
const constantKeys = Object.keys(consts.constants);

console.log(`\n📊 CONSTS.JSON ANALYSIS\n`);
console.log(`Enums keys: ${enumKeys.length}`);
console.log(`Constants keys: ${constantKeys.length}\n`);

// Find overlapping keys
const enumKeySet = new Set(enumKeys);
const constantKeySet = new Set(constantKeys);

const overlappingKeys = enumKeys.filter(k => constantKeySet.has(k));
console.log(`⚠️  Keys present in BOTH sections: ${overlappingKeys.length}`);
if (overlappingKeys.length > 0) {
  overlappingKeys.slice(0, 20).forEach(k => {
    console.log(`   - ${k}: enum=${JSON.stringify(consts.enums[k])} | const=${consts.constants[k]}`);
  });
  if (overlappingKeys.length > 20) console.log(`   ... and ${overlappingKeys.length - 20} more`);
}

// Check enum structure
console.log(`\n🔍 Enums section analysis:`);
const emptyEnums = enumKeys.filter(k => Object.keys(consts.enums[k]).length === 0);
console.log(`   Empty objects: ${emptyEnums.length}/${enumKeys.length}`);

const withConstants = enumKeys.filter(k => consts.enums[k].constants?.length);
console.log(`   With 'constants' field: ${withConstants.length}/${enumKeys.length}`);
if (withConstants.length > 0) {
  withConstants.slice(0, 5).forEach(k => {
    console.log(`     - ${k}: ${consts.enums[k].constants?.length} members`);
  });
}

// Value type analysis
console.log(`\n💾 Constants values analysis:`);
const valueTypes = new Map<string, number>();
constantKeys.forEach(k => {
  const type = typeof consts.constants[k];
  valueTypes.set(type, (valueTypes.get(type) ?? 0) + 1);
});
console.log(`   Types: ${Array.from(valueTypes.entries()).map(([t, c]) => `${t}(${c})`).join(", ")}`);

const samples = constantKeys.slice(0, 10);
console.log(`   Sample values:`);
samples.forEach(k => {
  console.log(`     ${k}: ${consts.constants[k]}`);
});

// Find constants that might be enum members
console.log(`\n🔎 Correlation check:`);
console.log(`   Keys only in enums: ${enumKeys.filter(k => !constantKeySet.has(k)).length}`);
console.log(`   Keys only in constants: ${constantKeys.filter(k => !enumKeySet.has(k)).length}`);

// Size comparison
console.log(`\n📏 Data size:`);
console.log(`   Enums JSON size: ${JSON.stringify(consts.enums).length} bytes`);
console.log(`   Constants JSON size: ${JSON.stringify(consts.constants).length} bytes`);
console.log(`   Total: ${JSON.stringify(consts).length} bytes`);
console.log(`   Enums % of total: ${(JSON.stringify(consts.enums).length / JSON.stringify(consts).length * 100).toFixed(1)}%`);
