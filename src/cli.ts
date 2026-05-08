#!/usr/bin/env bun
import * as fs from "node:fs";
import * as path from "node:path";
import { buildProjectScope } from "./scope.ts";
import { emitFileJs, type EmitOpts } from "./emit.ts";
import { parseSource } from "./parse.ts";
import type { Statement } from "./cst.ts";

type Opts = { out: string; strict: boolean; report?: string; input: string; splitMainLabels: boolean };

function collectVarFloatsFromStatement(st: Statement, out: Set<string>): void {
  if (st.kind === "VarDecl" && st.varKind === "VAR_FLOAT") {
    for (const n of st.names) out.add(n);
  }
  if (st.kind === "If") {
    for (const x of st.thenStmts) collectVarFloatsFromStatement(x, out);
    if (st.elseStmts) {
      for (const x of st.elseStmts) collectVarFloatsFromStatement(x, out);
    }
  } else if (st.kind === "While" || st.kind === "Repeat") {
    for (const x of st.body) collectVarFloatsFromStatement(x, out);
  }
}

function collectVarFloatsFromSource(source: string, out: Set<string>): void {
  const sf = parseSource(source);
  for (const t of sf.body) {
    if (t.kind === "Gap") continue;
    collectVarFloatsFromStatement(t, out);
  }
}

function writeFloatVars(outRoot: string, names: Set<string>): void {
  const outPath = path.join(outRoot, "floatvars.txt");
  const body = [...names].join("\n");
  fs.writeFileSync(outPath, body ? `${body}\n` : "");
}

function parseArgs(argv: string[]): Opts {
  let out = "out";
  let strict = false;
  let splitMainLabels = false;
  let report: string | undefined;
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-o" || a === "--out") out = argv[++i]!;
    else if (a === "--strict") strict = true;
    else if (a === "--split-main-labels") splitMainLabels = true;
    else if (a === "--report") report = argv[++i]!;
    else if (!a.startsWith("-")) pos.push(a);
  }
  if (!pos[0])
    throw new Error(
      "Usage: bun run cli <dir-or-file.sc> [-o out] [--strict] [--split-main-labels] [--report r.json]",
    );
  return { input: pos[0]!, out, strict, report, splitMainLabels };
}

export function convertTree(
  repoRoot: string,
  inputDir: string,
  outRoot: string,
  strict: boolean,
  emitOpts?: EmitOpts,
) {
  const scope = buildProjectScope(repoRoot, inputDir);
  const floatVars = new Set<string>();
  fs.mkdirSync(outRoot, { recursive: true });
  function walk(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".sc")) {
        const relFromInput = path.relative(inputDir, p).replace(/\\/g, "/");
        const text = fs.readFileSync(p, "utf8");
        collectVarFloatsFromSource(text, floatVars);
        const { jsPath, text: js } = emitFileJs(
          relFromInput,
          text,
          scope,
          outRoot,
          repoRoot,
          strict,
          emitOpts,
        );
        const outPath = path.join(outRoot, jsPath);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, js);
      }
    }
  }
  walk(inputDir);
  writeFloatVars(outRoot, floatVars);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(import.meta.dir, "..");
  const inPath = path.resolve(opts.input);
  const outRoot = path.resolve(opts.out);
  const emitOpts: EmitOpts | undefined = opts.splitMainLabels
    ? { splitMainLabels: true }
    : undefined;
  if (fs.statSync(inPath).isDirectory()) {
    convertTree(repoRoot, inPath, outRoot, opts.strict, emitOpts);
  } else {
    const scope = buildProjectScope(repoRoot, path.dirname(inPath));
    const floatVars = new Set<string>();
    const text = fs.readFileSync(inPath, "utf8");
    collectVarFloatsFromSource(text, floatVars);
    const base = path.basename(inPath);
    const { jsPath, text: js } = emitFileJs(base, text, scope, outRoot, repoRoot, opts.strict, emitOpts);
    const outPath = path.join(outRoot, jsPath);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, js);
    writeFloatVars(outRoot, floatVars);
  }
  if (opts.report) {
    const scope = buildProjectScope(repoRoot, path.dirname(inPath));
    fs.writeFileSync(opts.report, JSON.stringify(scope.report, null, 2));
  }
}

if (import.meta.main) main();
