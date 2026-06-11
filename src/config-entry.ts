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

type RawCommandRoot = {
  extensions?: { commands?: Gta3Command[] }[];
};

export type ConverterConfigData = {
  configFolder: string;
  commands: Gta3Command[];
  vars: Record<string, number>;
  consts: Record<string, number>;
  objs: Record<string, string | number>;
  enums: Record<string, Record<string, string | number>>;
};

export type ConverterJsonReader = (relativePath: string) => Promise<unknown>;
export type ConverterJsonReaderSync = (relativePath: string) => unknown;

let activeConfig: ConverterConfigData | undefined;
let activeCommandIndex: Map<string, Gta3Command> | undefined;

function assertRecord(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${what}: expected JSON object`);
  }
  return value as Record<string, unknown>;
}

function normalizeNumericMap(
  value: unknown,
  what: string,
  normalizeKey: (name: string) => string,
): Record<string, number> {
  const record = assertRecord(value, what);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(record)) {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) continue;
    out[normalizeKey(k)] = n;
  }
  return out;
}

function normalizeModelMap(value: unknown, what: string): Record<string, string | number> {
  const record = assertRecord(value, what);
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(record)) {
    if (typeof v === "number" || typeof v === "string") out[k.toUpperCase()] = v;
  }
  return out;
}

function normalizeEnumMap(
  value: unknown,
  what: string,
): Record<string, Record<string, string | number>> {
  const root = assertRecord(value, what);
  const out: Record<string, Record<string, string | number>> = {};
  for (const [enumName, membersRaw] of Object.entries(root)) {
    if (!membersRaw || typeof membersRaw !== "object" || Array.isArray(membersRaw)) continue;
    const membersOut: Record<string, string | number> = {};
    for (const [memberName, memberValue] of Object.entries(membersRaw)) {
      if (typeof memberValue === "string" || typeof memberValue === "number") {
        membersOut[memberName] = memberValue;
      }
    }
    out[enumName] = membersOut;
  }
  return out;
}

function parseCommands(value: unknown): Gta3Command[] {
  const root = value as RawCommandRoot;
  const commands: Gta3Command[] = [];
  for (const ext of root?.extensions ?? []) {
    if (ext?.commands?.length) commands.push(...ext.commands);
  }
  return commands;
}

function configJsonFileName(configFolder: string): string {
  const normalized = configFolder.replace(/[\\/]+$/, "");
  const lastSlash = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  const folderName = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  if (!folderName) throw new Error("Config folder is required");
  return `${folderName}.json`;
}

function configPaths(configFolder: string): {
  commandJson: string;
  varsJson: string;
  constsJson: string;
  objsJson: string;
  enumsJson: string;
} {
  const base = configFolder.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!base) throw new Error("Config folder is required");
  return {
    commandJson: `${base}/${configJsonFileName(base)}`,
    varsJson: `${base}/vars.json`,
    constsJson: `${base}/consts.json`,
    objsJson: `${base}/objs.json`,
    enumsJson: `${base}/enums.json`,
  };
}

function parseConverterConfigData(configFolder: string, raw: {
  commandJson: unknown;
  varsJson: unknown;
  constsJson: unknown;
  objsJson: unknown;
  enumsJson: unknown;
}): ConverterConfigData {
  return {
    configFolder,
    commands: parseCommands(raw.commandJson),
    vars: normalizeNumericMap(raw.varsJson, "vars.json", (k) => k),
    consts: normalizeNumericMap(raw.constsJson, "consts.json", (k) => k.toUpperCase()),
    objs: normalizeModelMap(raw.objsJson, "objs.json"),
    enums: normalizeEnumMap(raw.enumsJson, "enums.json"),
  };
}

export function loadConverterConfigSync(
  configFolder: string,
  readJsonSync: ConverterJsonReaderSync,
): ConverterConfigData {
  const p = configPaths(configFolder);
  return parseConverterConfigData(configFolder, {
    commandJson: readJsonSync(p.commandJson),
    varsJson: readJsonSync(p.varsJson),
    constsJson: readJsonSync(p.constsJson),
    objsJson: readJsonSync(p.objsJson),
    enumsJson: readJsonSync(p.enumsJson),
  });
}

export async function loadConverterConfig(
  configFolder: string,
  readJson: ConverterJsonReader,
): Promise<ConverterConfigData> {
  const p = configPaths(configFolder);
  return parseConverterConfigData(configFolder, {
    commandJson: await readJson(p.commandJson),
    varsJson: await readJson(p.varsJson),
    constsJson: await readJson(p.constsJson),
    objsJson: await readJson(p.objsJson),
    enumsJson: await readJson(p.enumsJson),
  });
}

export function setActiveConverterConfig(config: ConverterConfigData): void {
  activeConfig = config;
  activeCommandIndex = undefined;
}

export function requireActiveConverterConfig(): ConverterConfigData {
  if (!activeConfig) {
    throw new Error("Converter config is not initialized. Provide --config and load config before conversion.");
  }
  return activeConfig;
}

export function getActiveConsts(): Record<string, number> {
  return requireActiveConverterConfig().consts;
}

export function getActiveVars(): Record<string, number> {
  return requireActiveConverterConfig().vars;
}

export function getActiveObjs(): Record<string, string | number> {
  return requireActiveConverterConfig().objs;
}

export function getActiveEnums(): Record<string, Record<string, string | number>> {
  return requireActiveConverterConfig().enums;
}

export function getActiveCommands(): Gta3Command[] {
  return requireActiveConverterConfig().commands;
}

export function getActiveCommandIndex(): Map<string, Gta3Command> {
  if (!activeCommandIndex) {
    const m = new Map<string, Gta3Command>();
    for (const c of getActiveCommands()) {
      if (!c.name) continue;
      const k = c.name.toUpperCase();
      if (!m.has(k)) m.set(k, c);
    }
    activeCommandIndex = m;
  }
  return activeCommandIndex;
}
