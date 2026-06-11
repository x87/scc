import {
  getActiveCommandIndex,
  getActiveCommands,
  type Gta3Command,
  type Gta3Input,
} from "./config-entry.ts";

export type { Gta3Command, Gta3Input };

/** First matching command by case-insensitive name */
export function buildCommandIndex(): Map<string, Gta3Command> {
  return new Map(getActiveCommandIndex());
}

export function lookupCommand(name: string): Gta3Command | undefined {
  return getActiveCommandIndex().get(name.toUpperCase());
}

export function getAllCommands(): Gta3Command[] {
  return getActiveCommands();
}
