import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export type EnumInfo = {
  members: Map<string, number>;
  valueToMember: Map<number, string>;
};

const ENUMS_JSON_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "enums.json");

// Cached enums data from JSON
let _enumsData: Record<string, Record<string, string | number>> | undefined;

function loadEnumsData(): Record<string, Record<string, string | number>> {
  if (!_enumsData) {
    const json = fs.readFileSync(ENUMS_JSON_PATH, "utf8");
    _enumsData = JSON.parse(json);
  }
  return _enumsData;
}

export function enumMemberStringValue(enumName: string, member: string): string | undefined {
  const enumsData = loadEnumsData();
  const enumData = enumsData[enumName];
  if (!enumData) return undefined;
  
  const value = enumData[member];
  if (value !== undefined && typeof value === "string") return value;
  
  // case-insensitive fallback
  const up = member.toUpperCase();
  for (const [k, v] of Object.entries(enumData)) {
    if (k.toUpperCase() === up && typeof v === "string") return v;
  }
  return undefined;
}
