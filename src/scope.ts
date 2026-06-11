import { parseSource } from "./parse.ts";
import type { SourceFile, Statement } from "./cst.ts";
import * as fs from "node:fs";
import * as path from "node:path";

const RESERVED = new Set([
  "break",
  "continue",
  "else",
  "for",
  "function",
  "if",
  "return",
  "var",
  "let",
  "const",
  "with",
  "class",
  "default",
  "switch",
  "case",
  "import",
  "export",
  "new",
]);

/** Reserved SCM slot offsets (documented convention). Globals start after these. */
export const SCM_GLOBAL_SLOT_BASE = 3;

export type ScopeReport = {
  renamed: { from: string; to: string; reason: string }[];
  gosubFileHints: { file: string; alias: string; path: string }[];
  scriptLabels: { label: string; file: string }[];
  unresolvedGotos: { file: string; label: string }[];
};

export function walkAllStatements(sf: SourceFile, fn: (s: Statement) => void): void {
  const rec = (st: Statement) => {
    fn(st);
    switch (st.kind) {
      case "If":
        for (const x of st.thenStmts) rec(x);
        if (st.elseStmts) for (const x of st.elseStmts) rec(x);
        break;
      case "While":
        for (const x of st.body) rec(x);
        break;
      case "Repeat":
        for (const x of st.body) rec(x);
        break;
      default:
        break;
    }
  };
  for (const t of sf.body) {
    if (t.kind !== "Gap") rec(t);
  }
}

export function sanitizeJsIdent(name: string, report: ScopeReport): string {
  let out = name.replace(/[^A-Za-z0-9_$]/g, "_");
  if (/^[0-9]/.test(out)) {
    const to = "_" + out;
    report.renamed.push({ from: name, to, reason: "leading digit" });
    out = to;
  }
  if (RESERVED.has(out)) {
    const to = out + "_";
    report.renamed.push({ from: name, to, reason: "reserved word" });
    out = to;
  }
  return out;
}

export class ProjectScope {
  /** global name → SCM slot index */
  globalSlots = new Map<string, number>();
  /** lowercase global name → canonical global name */
  private globalNameIndex = new Map<string, string>();
  /** lowercase names declared via DECLARE_MISSION_FLAG */
  private missionFlagAliases = new Set<string>();
  /** label → defining file (relative posix) */
  labelFiles = new Map<string, string>();
  report: ScopeReport = {
    renamed: [],
    gosubFileHints: [],
    scriptLabels: [],
    unresolvedGotos: [],
  };

  addMainGlobals(mainPath: string, sf: SourceFile): void {
    let slot = SCM_GLOBAL_SLOT_BASE;
    const addDecl = (names: string[]) => {
      for (const n of names) {
        const currentSlot = slot;
        slot++;
        if (!this.globalSlots.has(n)) {
          this.globalSlots.set(n, currentSlot);
          const low = n.toLowerCase();
          if (!this.globalNameIndex.has(low)) this.globalNameIndex.set(low, n);
        }
      }
    };
    walkAllStatements(sf, (s) => {
      if (s.kind === "VarDecl" && (s.varKind === "VAR_INT" || s.varKind === "VAR_FLOAT")) {
        addDecl(s.names);
      }
    });
    void mainPath;
  }

  addGlobalSlot(name: string, slot: number): void {
    if (!this.globalSlots.has(name)) {
      this.globalSlots.set(name, slot);
    }
    const low = name.toLowerCase();
    if (!this.globalNameIndex.has(low)) this.globalNameIndex.set(low, name);
  }

  resolveGlobalName(name: string): string | undefined {
    if (this.globalSlots.has(name)) return name;
    return this.globalNameIndex.get(name.toLowerCase());
  }

  addMissionFlagAlias(name: string): void {
    this.missionFlagAliases.add(name.toLowerCase());
  }

  isMissionFlagAlias(name: string): boolean {
    return this.missionFlagAliases.has(name.toLowerCase());
  }

  scanFile(relPath: string, sf: SourceFile): void {
    const relPosix = relPath.replace(/\\/g, "/");
    const rec = (s: Statement) => {
      if (s.kind === "Command" && s.name.toUpperCase() === "DECLARE_MISSION_FLAG") {
        const first = s.args[0];
        if (first?.kind === "ident") this.addMissionFlagAlias(first.name);
      }
      if (s.kind === "Label") {
        this.labelFiles.set(s.name, relPosix);
      }
      if (s.kind === "StartNewScript") {
        this.labelFiles.set(s.label, relPosix);
        this.report.scriptLabels.push({ label: s.label, file: relPosix });
      }
      if (s.kind === "GosubFile") {
        this.report.gosubFileHints.push({
          file: relPosix,
          alias: s.alias,
          path: s.path,
        });
      }
    };
    walkAllStatements(sf, rec);
  }

  jsName(scName: string): string {
    const forcedUpper = new Set(["timera", "timerb", "onmission"]);
    if (forcedUpper.has(scName.toLowerCase())) return scName.toUpperCase();
    return sanitizeJsIdent(scName, this.report);
  }
}

export function collectGlobalsFromMain(mainText: string): Map<string, number> {
  const scope = new ProjectScope();
  scope.addMainGlobals("main.sc", parseSource(mainText));
  return scope.globalSlots;
}

export function buildProjectScope(repoRoot: string, inputDir: string): ProjectScope {
  const scope = new ProjectScope();
  const varsP = path.join(repoRoot, "gta3", "vars.mts");
  if (fs.existsSync(varsP)) {
    const varsText = fs.readFileSync(varsP, "utf8");
    // Parse `name: 123,` and `name: new Class(123),` entries from `export const $ = SCM.bind({ ... })`.
    const entryRe = /^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*(?:new\s+[A-Za-z_$][A-Za-z0-9_$]*\s*\(\s*(-?\d+)\s*\)|(-?\d+))\s*,?\s*$/gm;
    for (const m of varsText.matchAll(entryRe)) {
      const name = m[1]!;
      const slotRaw = m[2] ?? m[3];
      if (!slotRaw) continue;
      scope.addGlobalSlot(name, Number(slotRaw));
    }
  }
  const mainP = path.join(inputDir, "main.sc");
  if (fs.existsSync(mainP)) {
    scope.addMainGlobals("main.sc", parseSource(fs.readFileSync(mainP, "utf8")));
  }
  function walk(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".sc")) {
        const rel = path.relative(inputDir, p).replace(/\\/g, "/");
        scope.scanFile(rel, parseSource(fs.readFileSync(p, "utf8")));
      }
    }
  }
  
  if (fs.existsSync(inputDir)) walk(inputDir);
  return scope;
}
