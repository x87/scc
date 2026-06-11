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

console.log(`\n🔗 ENUM → CONSTANTS MAPPING\n`);

// For each enum, show its members and their values
const enumKeys = Object.keys(consts.enums).sort();

enumKeys.forEach(enumName => {
  const enumDef = consts.enums[enumName];
  const members = enumDef.constants || [];
  
  if (members.length === 0) {
    console.log(`${enumName}: (no members defined)`);
    return;
  }
  
  console.log(`${enumName}:`);
  members.forEach(member => {
    const value = consts.constants[member];
    const status = value !== undefined ? `✓ ${value}` : `✗ NOT FOUND`;
    console.log(`  - ${member}: ${status}`);
  });
  console.log();
});

// Summary stats
const allEnumMembers = Object.values(consts.enums).flatMap(e => e.constants || []);
const foundMembers = allEnumMembers.filter(m => consts.constants[m] !== undefined).length;

console.log(`\n📊 SUMMARY`);
console.log(`Total enum members defined: ${allEnumMembers.length}`);
console.log(`Enum members found in constants: ${foundMembers}/${allEnumMembers.length}`);
console.log(`Constants not referenced by any enum: ${Object.keys(consts.constants).length - foundMembers}`);

// Missing enum members
const missingMembers = allEnumMembers.filter(m => consts.constants[m] === undefined);
if (missingMembers.length > 0) {
  console.log(`\n⚠️  Missing constants for enum members:`);
  missingMembers.slice(0, 10).forEach(m => {
    console.log(`  - ${m}`);
  });
  if (missingMembers.length > 10) {
    console.log(`  ... and ${missingMembers.length - 10} more`);
  }
}

// Orphan constants (not in any enum)
const enumMemberSet = new Set(allEnumMembers);
const orphans = Object.keys(consts.constants).filter(k => !enumMemberSet.has(k));
console.log(`\n🏚️  Constants NOT in any enum: ${orphans.length}`);
orphans.slice(0, 15).forEach(k => {
  console.log(`  - ${k}: ${consts.constants[k]}`);
});
if (orphans.length > 15) {
  console.log(`  ... and ${orphans.length - 15} more`);
}
