import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export type Gta3Input = {
  name?: string;
  type?: string;
  source?: string;
};

export type Gta3Command = {
  id: string;
  name: string;
  num_params: number;
  short_desc?: string;
  input?: Gta3Input[];
  output?: { name: string; type: string; source?: string }[];
  operator?: string;
  attrs?: Record<string, boolean>;
  class?: string;
  member?: string;
};

type Gta3Root = {
  extensions: { name: string; commands: Gta3Command[] }[];
};

let cachedConfigFolder: string | undefined;

export function setCommandConfigFolder(folder: string): void {
  cachedConfigFolder = folder;
  // Invalidate cache when config changes
  _cmdIndex = undefined;
}

function getCommandJsonPath(configFolder?: string): string {
  const folder = configFolder || cachedConfigFolder || "gta3";
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const jsonName = folder === "vc" ? "vc.json" : "gta3.json";
  return path.join(repoRoot, folder, jsonName);
}

export function loadCommands(configFolder?: string): Gta3Command[] {
  const jsonPath = getCommandJsonPath(configFolder);
  if (!fs.existsSync(jsonPath)) {
    return [];
  }
  const root = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as Gta3Root;
  const all: Gta3Command[] = [];
  for (const ext of root.extensions) {
    all.push(...ext.commands);
  }
  return all;
}

/** First matching command by case-insensitive name */
export function buildCommandIndex(configFolder?: string): Map<string, Gta3Command> {
  const m = new Map<string, Gta3Command>();
  for (const c of loadCommands(configFolder)) {
    if (!c.name) continue;
    const k = c.name.toUpperCase();
    if (!m.has(k)) m.set(k, c);
  }
  return m;
}

let _cmdIndex: Map<string, Gta3Command> | undefined;

function commandIndex(): Map<string, Gta3Command> {
  if (!_cmdIndex) _cmdIndex = buildCommandIndex(cachedConfigFolder);
  return _cmdIndex;
}

export function lookupCommand(name: string): Gta3Command | undefined {
  return commandIndex().get(name.toUpperCase());
}

export function getAllCommands(): Gta3Command[] {
  return loadCommands(cachedConfigFolder);
}
