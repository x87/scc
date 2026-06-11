#!/usr/bin/env bun
import * as fs from "node:fs";
import * as path from "node:path";
import { buildProjectScope } from "./scope.ts";
import { setConfigFolder } from "./consts.ts";
import { setCommandConfigFolder } from "./gta3.ts";
import { emitFileJs } from "./emit.ts";
import { parseSource } from "./parse.ts";
import type { Statement } from "./cst.ts";

type Opts = { out: string; report?: string; input: string; config: string };

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

function generateUtilsFolder(outRoot: string, repoRoot: string, configFolder: string, floatVars?: Set<string>) {
  const utilsDir = path.join(outRoot, "utils");
  fs.mkdirSync(utilsDir, { recursive: true });
  
  // Generate vars.mts from vars.json
  const varsJsonPath = path.join(repoRoot, configFolder, "vars.json");
  if (fs.existsSync(varsJsonPath)) {
    const varsJson = JSON.parse(fs.readFileSync(varsJsonPath, "utf8")) as Record<string, number>;
    const varsLines: string[] = ['import { SCM } from "./scm.mts";\n', "export const $ = SCM.bind({"];
    for (const [name, slot] of Object.entries(varsJson)) {
      if (floatVars?.has(name)) {
        varsLines.push(`  ${name}: SCM.Float(${slot}),`);
      } else {
        varsLines.push(`  ${name}: ${slot},`);
      }
    }
    varsLines.push("});\n");
    fs.writeFileSync(path.join(utilsDir, "vars.mts"), varsLines.join("\n"));
  }
  
  // Copy scm.mts from addons folder
  const scmSource = path.join(repoRoot, "addons", "scm.mts");
  if (fs.existsSync(scmSource)) {
    fs.copyFileSync(scmSource, path.join(utilsDir, "scm.mts"));
  }
  
  // Copy ide.mts from addons folder
  const ideSource = path.join(repoRoot, "addons", "ide.mts");
  if (fs.existsSync(ideSource)) {
    fs.copyFileSync(ideSource, path.join(utilsDir, "ide.mts"));
  }
  
  // Generate barrel index.ts
  const indexContent = `// Re-exports from shared utilities
export * from "./vars.mts";
export * from "./scm.mts";
export * from "./ide.mts";
`;
  fs.writeFileSync(path.join(utilsDir, "index.ts"), indexContent);
}

function writeFloatVars(outRoot: string, names: Set<string>): void {
  const outPath = path.join(outRoot, "floatvars.txt");
  const body = [...names].join("\n");
  fs.writeFileSync(outPath, body ? `${body}\n` : "");
}

function parseArgs(argv: string[]): Opts {
  let out = "out";
  let report: string | undefined;
  let config = "gta3";
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-o" || a === "--out") out = argv[++i]!;
    else if (a === "--report") report = argv[++i]!;
    else if (a === "--config") config = argv[++i]!;
    else if (!a.startsWith("-")) pos.push(a);
  }
  if (!pos[0])
    throw new Error(
      "Usage: bun run cli <dir-or-file.sc> [-o out] [--config config] [--report r.json]",
    );
  return { input: pos[0]!, out, report, config };
}

export function convertTree(
  repoRoot: string,
  inputDir: string,
  outRoot: string,
  strict: boolean,
  configFolder: string,
  emitOpts?: EmitOpts,
) {
  const scope = buildProjectScope(repoRoot, inputDir, configFolder);
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
  generateUtilsFolder(outRoot, repoRoot, configFolder, floatVars);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(import.meta.dir, "..");
  const inPath = path.resolve(opts.input);
  const outRoot = path.resolve(opts.out);
  const configFolder = opts.config;
  setConfigFolder(configFolder);
  setCommandConfigFolder(configFolder);
  
  if (fs.statSync(inPath).isDirectory()) {
    convertTree(repoRoot, inPath, outRoot, true, configFolder);
  } else {
    const scope = buildProjectScope(repoRoot, path.dirname(inPath), configFolder);
    const floatVars = new Set<string>();
    const text = fs.readFileSync(inPath, "utf8");
    collectVarFloatsFromSource(text, floatVars);
    const base = path.basename(inPath);
    const { jsPath, text: js } = emitFileJs(base, text, scope, outRoot, repoRoot, true);
    const outPath = path.join(outRoot, jsPath);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, js);
    generateUtilsFolder(outRoot, repoRoot, configFolder, floatVars);
  }
  if (opts.report) {
    const scope = buildProjectScope(repoRoot, path.dirname(inPath), configFolder);
    fs.writeFileSync(opts.report, JSON.stringify(scope.report, null, 2));
  }
}

if (import.meta.main) main();
