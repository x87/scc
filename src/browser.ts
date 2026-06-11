/**
 * Browser-compatible converter entry point
 * Accepts pre-loaded configuration data instead of reading from file system
 */

import { parseSource } from "./parse.ts";
import { createHudWrapState, translateStatement, type TxCtx } from "./translate.ts";
import { lowerSourceFile } from "./lower.ts";
import { collectTypeEnv, type TypeEnv } from "./types.ts";
import { sliceText, type SourceFile, type Statement, type TopLevel, type TokRef } from "./cst.ts";
import type { Gta3Command } from "./config-entry.ts";

export interface BrowserConverterConfig {
  commands: Gta3Command[];
  vars: Record<string, number>;
  consts: Record<string, number>;
}

type BrowserScope = {
  resolveGlobalName: (name: string) => string | null;
  jsName: (name: string) => string;
  hasGlobal: (name: string) => boolean;
  hasLocal: (name: string) => boolean;
  isMissionFlagAlias: (name: string) => boolean;
};

function buildCommandIndex(commands: Gta3Command[]): Map<string, Gta3Command> {
  const m = new Map<string, Gta3Command>();
  for (const c of commands) {
    if (!c.name) continue;
    const k = c.name.toUpperCase();
    if (!m.has(k)) m.set(k, c);
  }
  return m;
}

function extractCommentLines(raw: string, indent = ""): string[] {
  if (!raw) return [];
  const out: string[] = [];
  const lines = raw.replace(/\r/g, "").split("\n");
  const hasLineBreak = raw.includes("\n");

  for (const ln of lines) {
    const trimmed = ln.trim();
    if (!trimmed) {
      if (hasLineBreak) out.push("");
      continue;
    }
    if (trimmed.startsWith("//")) {
      out.push(`${indent}${trimmed}`);
      continue;
    }
    if (trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("*/")) {
      out.push(`${indent}${trimmed}`);
    }
  }
  return out;
}

function emitGapLines(ctx: TxCtx, tok: TokRef, indent: string): string[] {
  return extractCommentLines(sliceText(ctx.tokens, tok), indent);
}

function emitTopLevels(
  ctx: TxCtx,
  tops: TopLevel[],
  indent: string,
  cmdIndex: Map<string, Gta3Command>,
): string {
  const lines: string[] = [];
  for (const t of tops) {
    if (t.kind === "Gap") {
      lines.push(...emitGapLines(ctx, t.tok, indent));
      continue;
    }
    lines.push(...emitRecursive(ctx, t, indent, cmdIndex));
  }
  return lines.join("\n");
}

function emitRecursive(
  ctx: TxCtx,
  st: Statement,
  indent: string,
  cmdIndex: Map<string, Gta3Command>,
): string[] {
  return translateStatement(
    ctx,
    st,
    (n) => cmdIndex.get(n.toUpperCase()),
    indent,
    (s, ind) => emitRecursive(ctx, s, ind, cmdIndex),
  );
}

function makeTxCtx(
  sf: SourceFile,
  scope: BrowserScope,
  strict: boolean,
  consts: Record<string, number>,
  typeEnv?: TypeEnv,
  labelFnNames?: Map<string, string>,
): { ctx: TxCtx; unknowns: string[] } {
  const unknowns: string[] = [];
  const missionFlagAliases = new Set<string>();
  const constValues = new Map<string, number>();
  for (const [name, value] of Object.entries(consts)) {
    constValues.set(name.toUpperCase(), Number(value));
  }
  const ref = (sc: string) => {
    const low = sc.toLowerCase();
    if (low === "onmission" || missionFlagAliases.has(low) || scope.isMissionFlagAlias(low)) {
      return "ONMISSION";
    }
    const canon = sc;
    const globalName = scope.resolveGlobalName(canon);
    if (globalName) return `$.${scope.jsName(globalName)}`;
    const js = scope.jsName(canon);
    if (!scope.hasGlobal(js) && !scope.hasLocal(js)) {
      unknowns.push(js);
    }
    return js;
  };

  const ctx: TxCtx = {
    tokens: sf.tokens,
    ref,
    labelFnNames,
    strict,
    unknowns,
    typeEnv,
    hudWrap: createHudWrapState(),
    missionFlagAliases,
    constValues,
  };
  return { ctx, unknowns };
}

function emitSourceFile(
  sf: SourceFile,
  scope: BrowserScope,
  cmdIndex: Map<string, Gta3Command>,
  config: BrowserConverterConfig,
): { code: string; unknowns: string[] } {
  const lower = lowerSourceFile(sf);
  const typeEnv = collectTypeEnv(lower, (name) => cmdIndex.get(name.toUpperCase()));

  const lines: string[] = [];
  lines.push("import { $ } from './utils/vars.mts';");
  lines.push("import { cmd } from './utils/commands.mts';");
  lines.push("");

  const { ctx, unknowns } = makeTxCtx(lower, scope, false, config.consts, typeEnv);

  const body = emitTopLevels(ctx, lower.body, "  ", cmdIndex);
  if (body) lines.push(body);

  return { code: lines.join("\n"), unknowns };
}

export function convertScToTs(code: string, config: BrowserConverterConfig): string {
  try {
    const sf = parseSource(code);
    if (!sf) {
      throw new Error("Failed to parse SC code");
    }

    // Build command index from provided commands
    const cmdIndex = buildCommandIndex(config.commands);

    // Build minimal project scope with provided vars
    // Create a mock scope object with required methods
    const globalSlots = new Map<string, number>();
    const globalNameIndex = new Map<string, string>();
    for (const [name, slot] of Object.entries(config.vars)) {
      globalSlots.set(name, Number(slot));
      const low = name.toLowerCase();
      if (!globalNameIndex.has(low)) {
        globalNameIndex.set(low, name);
      }
    }

    const scope: any = {
      globalSlots,
      resolveGlobalName: (name: string) => {
        if (globalSlots.has(name)) return name;
        return globalNameIndex.get(name.toLowerCase()) || null;
      },
      jsName: (name: string) => {
        const forcedUpper = new Set(["timera", "timerb", "onmission"]);
        if (forcedUpper.has(name.toLowerCase())) return name.toUpperCase();
        return name.toLowerCase().replace(/[^a-z0-9_]/gi, "_");
      },
      hasGlobal: (name: string) => {
        return globalSlots.has(name) || globalNameIndex.has(name.toLowerCase());
      },
      hasLocal: () => false,
      isMissionFlagAlias: () => false,
    };

    const { code: tsCode } = emitSourceFile(sf, scope, cmdIndex, config);
    return tsCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Conversion failed: ${message}`);
  }
}
