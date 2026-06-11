import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export type ConstsIndex = Record<string, number>;

let cachedConfigFolder: string | undefined;

export function setConfigFolder(folder: string): void {
  cachedConfigFolder = folder;
}

export function repoConstsPaths(configFolder?: string): { jsonPath: string } {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const folder = configFolder || cachedConfigFolder || "gta3";
  return {
    jsonPath: path.join(repoRoot, folder, "consts.json"),
  };
}

export function loadConstsIndex(configFolder?: string): ConstsIndex {
  const { jsonPath } = repoConstsPaths(configFolder);
  if (fs.existsSync(jsonPath)) {
    const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as ConstsIndex;
    if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) return parsed;
  }
  // If the JSON is missing or invalid, return an empty index. XML parsing
  // is intentionally kept out of runtime converter logic; use the
  // `scripts/consts-convert.ts` utility to regenerate `consts.json` from XML.
  return {};
}
