import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export type ConstsIndex = {
  enums: Record<string, { global: boolean; constants: string[] }>;
  constants: Record<string, number>;
};


export function repoConstsPaths(): { jsonPath: string } {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  return {
    jsonPath: path.join(repoRoot, "consts.json"),
  };
}

export function loadConstsIndex(): ConstsIndex {
  const { jsonPath } = repoConstsPaths();
  if (fs.existsSync(jsonPath)) {
    const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as ConstsIndex;
    if (parsed && parsed.constants && parsed.enums) return parsed;
  }
  // If the JSON is missing or invalid, return an empty index. XML parsing
  // is intentionally kept out of runtime converter logic; use the
  // `scripts/consts-convert.ts` utility to regenerate `consts.json` from XML.
  return { enums: {}, constants: {} };
}
