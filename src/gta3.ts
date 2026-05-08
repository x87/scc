import gta3 from "../gta3.json" with { type: "json" };

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

export function loadCommands(): Gta3Command[] {
  const root = gta3 as unknown as Gta3Root;
  const all: Gta3Command[] = [];
  for (const ext of root.extensions) {
    all.push(...ext.commands);
  }
  return all;
}

/** First matching command by case-insensitive name */
export function buildCommandIndex(): Map<string, Gta3Command> {
  const m = new Map<string, Gta3Command>();
  for (const c of loadCommands()) {
    if (!c.name) continue;
    const k = c.name.toUpperCase();
    if (!m.has(k)) m.set(k, c);
  }
  return m;
}

let _cmdIndex: Map<string, Gta3Command> | undefined;

function commandIndex(): Map<string, Gta3Command> {
  if (!_cmdIndex) _cmdIndex = buildCommandIndex();
  return _cmdIndex;
}

export function lookupCommand(name: string): Gta3Command | undefined {
  return commandIndex().get(name.toUpperCase());
}

export function getAllCommands(): Gta3Command[] {
  return loadCommands();
}
