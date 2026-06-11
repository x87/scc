import { sliceText, type SourceFile, type Statement, type TopLevel, type TokRef } from "./cst.ts";
import { parseSource } from "./parse.ts";
import { buildCommandIndex } from "./gta3.ts";
import type { ProjectScope } from "./scope.ts";
import { createHudWrapState, translateStatement, type TxCtx } from "./translate.ts";
import { lowerSourceFile } from "./lower.ts";
import { collectTypeEnv, type TypeEnv } from "./types.ts";
import type { Token } from "./lex.ts";
import * as path from "node:path";
import * as fs from "node:fs";

const cmdIndex = buildCommandIndex();

export type EmitOpts = {
  /** When set and input is `main.sc`, also emit one `.js` per top-level label section (duplicate SCM.bind per file). */
  splitMainLabels?: boolean;
};

function emitRecursive(ctx: TxCtx, st: Statement, indent: string): string[] {
  return translateStatement(
    ctx,
    st,
    (n) => cmdIndex.get(n.toUpperCase()),
    indent,
    (s, ind) => emitRecursive(ctx, s, ind),
  );
}

function makeTxCtx(
  sf: SourceFile,
  scope: ProjectScope,
  strict: boolean,
  typeEnv?: TypeEnv,
  labelFnNames?: Map<string, string>,
): { ctx: TxCtx; unknowns: string[] } {
  const unknowns: string[] = [];
  const missionFlagAliases = new Set<string>();
  const ref = (sc: string) => {
    const low = sc.toLowerCase();
    if (low === "onmission" || missionFlagAliases.has(low) || scope.isMissionFlagAlias(low)) {
      return "ONMISSION";
    }
    const canon = sc;
    const globalName = scope.resolveGlobalName(canon);
    if (globalName) return `$.${scope.jsName(globalName)}`;
    const js = scope.jsName(canon);
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
  };
  return { ctx, unknowns };
}

function extractCommentLines(raw: string, indent = ""): string[] {
  if (!raw) return [];
  const out: string[] = [];
  const lines = raw.replace(/\r/g, "").split("\n");
  const hasLineBreak = raw.includes("\n");
  let blockDepth = 0;

  const normalizeBlockLine = (trimmed: string, depth: number): { text: string; depth: number; touched: boolean } => {
    let d = depth;
    let text = "";
    let touched = false;
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i]!;
      const nx = trimmed[i + 1];
      if (ch === "/" && nx === "*") {
        touched = true;
        if (d === 0) text += "/*";
        d++;
        i++;
        continue;
      }
      if (ch === "*" && nx === "/" && d > 0) {
        touched = true;
        d--;
        if (d === 0) text += "*/";
        i++;
        continue;
      }
      if (d > 0 || text.length > 0) text += ch;
    }
    return { text: text.trim(), depth: d, touched };
  };

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
    const inBlock = blockDepth > 0;
    const normalized = normalizeBlockLine(trimmed, blockDepth);
    blockDepth = normalized.depth;
    const isCommentLine =
      inBlock ||
      normalized.touched ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("*/");
    if (!isCommentLine) continue;
    if (normalized.text) out.push(`${indent}${normalized.text}`);
    else if (hasLineBreak) out.push("");
  }
  return out;
}

function splitRawLines(raw: string): Array<{ line: string; isCode: boolean }> {
  const srcLines = raw.replace(/\r/g, "").split("\n");
  const infos: Array<{ line: string; isCode: boolean }> = [];
  let blockDepth = 0;

  const nextBlockDepth = (line: string, depth: number): number => {
    if (line.startsWith("//")) return depth;
    let d = depth;
    for (let i = 0; i < line.length - 1; i++) {
      if (line[i] === "/" && line[i + 1] === "*") {
        d++;
        i++;
        continue;
      }
      if (line[i] === "*" && line[i + 1] === "/" && d > 0) {
        d--;
        i++;
      }
    }
    return d;
  };

  for (const line of srcLines) {
    const trimmed = line.trim();
    let isComment = false;
    if (trimmed.length > 0) {
      isComment =
        blockDepth > 0 ||
        trimmed.startsWith("//") ||
        trimmed.startsWith("/*") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("*/");
    }
    infos.push({ line, isCode: trimmed.length > 0 && !isComment });
    blockDepth = nextBlockDepth(trimmed, blockDepth);
  }
  return infos;
}

function extractLeadingCommentLines(tokens: Token[], tok: TokRef, indent = ""): string[] {
  const raw = sliceText(tokens, tok).replace(/\r/g, "");
  const linesInfo = splitRawLines(raw);
  const codeIdx = linesInfo.findIndex((ln) => ln.isCode);
  if (codeIdx <= 0) return codeIdx < 0 ? extractCommentLines(raw, indent) : [];
  const preRaw = linesInfo
    .slice(0, codeIdx)
    .map((ln) => ln.line)
    .join("\n");
  return extractCommentLines(preRaw, indent);
}

function emitGapLines(ctx: TxCtx, tok: TokRef, indent: string): string[] {
  return extractCommentLines(sliceText(ctx.tokens, tok), indent);
}

function emitTopLevels(ctx: TxCtx, tops: TopLevel[], indent: string): string {
  const lines: string[] = [];
  for (const t of tops) {
    if (t.kind === "Gap") {
      lines.push(...emitGapLines(ctx, t.tok, indent));
      continue;
    }
    lines.push(...emitRecursive(ctx, t, indent));
  }
  return lines.join("\n");
}

function topLevelTrailingSelfGotoIndex(tops: TopLevel[], label: string): number {
  for (let i = tops.length - 1; i >= 0; i--) {
    const t = tops[i]!;
    if (t.kind === "Gap") continue;
    if (t.kind === "Block" && t.kindBrace === "CLOSE") continue;
    return t.kind === "Goto" && t.label === label ? i : -1;
  }
  return -1;
}

function trimTerminalBareReturn(body: string): string {
  if (!body) return body;
  const lines = body.split("\n");
  let last = lines.length - 1;
  while (last >= 0 && lines[last]!.trim() === "") last--;
  if (last >= 0 && lines[last]!.trim() === "return;") {
    lines.splice(last, 1);
    while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
  }
  return lines.join("\n");
}

function usesIdeHelpers(chunks: string[]): boolean {
  const text = chunks.join("\n");
  return /(?:^|[^A-Za-z0-9_$])(car|ped|hier)`/.test(text);
}

function usesTimedHelper(chunks: string[]): boolean {
  const text = chunks.join("\n");
  return /(?:^|[^A-Za-z0-9_$])timed\(/.test(text);
}

function emitFunctionBody(
  ctx: TxCtx,
  tops: TopLevel[],
  indent: string,
  selfLoopLabel?: string,
): string {
  if (!selfLoopLabel) return trimTerminalBareReturn(emitTopLevels(ctx, tops, indent));
  const tailGotoIdx = topLevelTrailingSelfGotoIndex(tops, selfLoopLabel);
  if (tailGotoIdx < 0) return trimTerminalBareReturn(emitTopLevels(ctx, tops, indent));
  const loopBodyTops = tops.filter((_, i) => i !== tailGotoIdx);
  const loopInner = emitTopLevels(ctx, loopBodyTops, indent + "  ");
  const out: string[] = [];
  out.push(`${indent}// SCM GOTO → ${selfLoopLabel} lowered to endless loop`);
  out.push(`${indent}while (true) {`);
  if (loopInner) out.push(loopInner);
  out.push(`${indent}}`);
  return trimTerminalBareReturn(out.join("\n"));
}

function emitScriptBody(sf: SourceFile, scope: ProjectScope, strict: boolean, typeEnv?: TypeEnv): string {
  const { ctx, unknowns } = makeTxCtx(sf, scope, strict, typeEnv);
  const out = emitTopLevels(ctx, sf.body, "  ");
  void unknowns;
  return out;
}

function isMainScRel(rel: string): boolean {
  const base = path.basename(rel.replace(/\\/g, "/")).toLowerCase();
  return base === "main.sc";
}

function slugLabel(label: string): string {
  return label.replace(/[^A-Za-z0-9_$]/g, "_");
}

type LabeledSection = {
  label: string;
  body: TopLevel[];
  leadingGap: TopLevel[];
};

function splitLabeledSections(
  body: TopLevel[],
): { preamble: TopLevel[]; sections: LabeledSection[] } {
  const preamble: TopLevel[] = [];
  const sections: LabeledSection[] = [];
  let pendingLeadingGap: TopLevel[] = [];
  let i = 0;
  while (i < body.length) {
    const t = body[i]!;
    if (t.kind === "Label") {
      const leadingGap = pendingLeadingGap;
      pendingLeadingGap = [];
      const labelName = t.name;
      i++;
      const seg: TopLevel[] = [];
      while (i < body.length && body[i]!.kind !== "Label") {
        seg.push(body[i]!);
        i++;
      }
      if (i < body.length) {
        while (seg.length > 0 && seg[seg.length - 1]!.kind === "Gap") {
          pendingLeadingGap.unshift(seg.pop()!);
        }
      }
      sections.push({ label: labelName, body: seg, leadingGap });
      continue;
    }
    preamble.push(t);
    i++;
  }
  return { preamble, sections };
}

function buildHudWrapPrelude(_ctx: TxCtx): { importLine?: string; declLines: string[] } {
  return { declLines: [] };
}

function buildFileHeaderLines(opts: {
  relScPath: string;
}): string[] {
  const lines: string[] = [
    `// Generated from ${opts.relScPath}`,
  ];
  return lines;
}

type MissionPreludeAnalysis = {
  labelFnNames: Map<string, string>;
  mainBodyTops: TopLevel[];
  liftedCommentLines: string[];
  stripBodyCommentLines: string[];
};

function findNextNonGapIndex(tops: TopLevel[], startIdx: number): number {
  for (let i = startIdx; i < tops.length; i++) {
    if (tops[i]!.kind !== "Gap") return i;
  }
  return -1;
}

function extractMissionWallLinesFromGap(tokens: Token[], tok: TokRef): string[] {
  const raw = sliceText(tokens, tok).replace(/\r/g, "");
  const out: string[] = [];
  let started = false;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!started) {
      if (trimmed.startsWith("//") && trimmed.includes("***")) {
        started = true;
        out.push(trimmed);
      }
      continue;
    }
    if (trimmed.startsWith("//") && trimmed.includes("***")) {
      out.push(trimmed);
      continue;
    }
    if (!trimmed) continue;
    break;
  }
  return out;
}

function stripLeadingCommentLines(body: string, commentLines: string[]): string {
  if (!body || commentLines.length === 0) return body;
  const lines = body.split("\n");
  let first = 0;
  while (first < lines.length && lines[first]!.trim() === "") first++;

  let cursor = first;
  let matched = 0;
  while (cursor < lines.length && matched < commentLines.length) {
    const trimmed = lines[cursor]!.trim();
    if (!trimmed) {
      cursor++;
      continue;
    }
    if (trimmed === commentLines[matched]!.trim()) {
      matched++;
      cursor++;
      continue;
    }
    break;
  }
  if (matched !== commentLines.length) return body;

  lines.splice(first, cursor - first);
  while (lines.length > 0 && lines[0]!.trim() === "") lines.shift();
  return lines.join("\n");
}

function analyzeMissionPrelude(sf: SourceFile, preamble: TopLevel[]): MissionPreludeAnalysis | undefined {
  const missionStartIdx = findNextNonGapIndex(preamble, 0);
  if (missionStartIdx < 0) return undefined;
  const missionStart = preamble[missionStartIdx];
  if (!missionStart || missionStart.kind !== "MissionBoundary" || missionStart.which !== "START") {
    return undefined;
  }

  let idx = findNextNonGapIndex(preamble, missionStartIdx + 1);
  if (idx < 0) return undefined;
  const bodyCall = preamble[idx];
  if (!bodyCall || bodyCall.kind !== "Gosub") return undefined;
  const bodyLabel = bodyCall.label;

  idx = findNextNonGapIndex(preamble, idx + 1);
  let failedLabel: string | undefined;
  if (idx >= 0) {
    const maybeIf = preamble[idx];
    if (
      maybeIf &&
      maybeIf.kind === "If" &&
      !maybeIf.elseStmts?.length &&
      maybeIf.thenStmts.length === 1 &&
      maybeIf.thenStmts[0]!.kind === "Gosub"
    ) {
      failedLabel = maybeIf.thenStmts[0]!.label;
      idx = findNextNonGapIndex(preamble, idx + 1);
    }
  }

  if (idx < 0) return undefined;
  const cleanupCall = preamble[idx];
  if (!cleanupCall || cleanupCall.kind !== "Gosub") return undefined;
  const cleanupLabel = cleanupCall.label;

  const stripIndexes = new Set<number>([missionStartIdx]);
  const missionEndIdx = findNextNonGapIndex(preamble, idx + 1);
  if (missionEndIdx >= 0) {
    const missionEnd = preamble[missionEndIdx];
    if (missionEnd?.kind === "MissionBoundary" && missionEnd.which === "END") {
      stripIndexes.add(missionEndIdx);
    }
  }

  const labelFnNames = new Map<string, string>([
    [bodyLabel, "body"],
    [cleanupLabel, "cleanup"],
  ]);
  if (failedLabel) labelFnNames.set(failedLabel, "onFailed");

  const gapAfterMissionStart = preamble
    .slice(missionStartIdx + 1, idx)
    .find((t): t is { kind: "Gap"; tok: TokRef } => t.kind === "Gap");
  const wallFromGap = gapAfterMissionStart
    ? extractMissionWallLinesFromGap(sf.tokens, gapAfterMissionStart.tok)
    : [];
  const liftedCommentLines =
    wallFromGap.length > 0 ? wallFromGap : extractLeadingCommentLines(sf.tokens, missionStart.tok);

  return {
    labelFnNames,
    mainBodyTops: preamble.filter((_, i) => !stripIndexes.has(i)),
    liftedCommentLines,
    stripBodyCommentLines: wallFromGap,
  };
}

function emitOneJsModule(params: {
  relScPath: string;
  scope: ProjectScope;
  strict: boolean;
  typeEnv: TypeEnv;
  outRoot: string;
  repoRoot: string;
  sf: SourceFile;
  fnName: string;
  headerExtra?: string[];
  /** When set, each section is emitted as `async function <jsLabel>() { ... }` before the export. */
  hoistedLabelSections?: LabeledSection[];
  /** Statements inside `export async function fnName` — defaults to full `sf.body`. */
  mainBodyTops?: TopLevel[];
  /** If set, a trailing top-level `GOTO <label>` is lowered to `while(true)` in function body. */
  selfLoopLabel?: string;
  /** Optional label -> emitted async function name overrides. */
  labelFnNames?: Map<string, string>;
  /** Optional comments to place right after imports. */
  liftedTopComments?: string[];
  /** Optional leading comment lines to strip from emitted main body. */
  stripLeadingBodyComments?: string[];
}): { jsPath: string; text: string } {
  const {
    relScPath,
    scope,
    strict,
    typeEnv,
    outRoot,
    repoRoot,
    sf,
    fnName,
    headerExtra,
    hoistedLabelSections,
    mainBodyTops,
    selfLoopLabel,
    labelFnNames,
    liftedTopComments,
    stripLeadingBodyComments,
  } = params;
  const relJs = relScPath.replace(/\.sc$/i, ".ts");
  const outFile = path.join(outRoot, relJs);

  const rel = (toAbs: string) => {
    let r = path.relative(path.dirname(outFile), toAbs).replace(/\\/g, "/");
    if (!r.startsWith(".")) r = "./" + r;
    return r;
  };

  const varsImp = rel(path.join(outRoot, "gta3", "vars.mts"));
  const ideImp = rel(path.join(outRoot, "ide.mts"));
  const scmImp = rel(path.join(outRoot, "scm.mts"));
  const { ctx } = makeTxCtx(sf, scope, strict, typeEnv, labelFnNames);
  const mainTops = mainBodyTops ?? sf.body;
  let body = emitFunctionBody(ctx, mainTops, "  ", selfLoopLabel);
  if (stripLeadingBodyComments?.length) {
    body = stripLeadingCommentLines(body, stripLeadingBodyComments);
  }
  const hoistedBlocks =
    hoistedLabelSections?.map((sec) => {
      const jsFn = labelFnNames?.get(sec.label) ?? scope.jsName(sec.label);
      const inner = emitFunctionBody(ctx, sec.body, "  ", sec.label);
      const lead = sec.leadingGap.length > 0 ? emitTopLevels(ctx, sec.leadingGap, "") : "";
      const parts: string[] = [];
      if (lead) parts.push(lead);
      parts.push(`async function ${jsFn}() {\n${inner}\n}`);
      return parts.join("\n");
    }).join("\n\n") ?? "";
  const hudPrelude = buildHudWrapPrelude(ctx);
  const headerLines = buildFileHeaderLines({ relScPath });
  if (headerExtra?.length) headerLines.push(...headerExtra);
  const importLines = [`import { $ } from ${JSON.stringify(varsImp)};`];
  if (usesIdeHelpers([hoistedBlocks, body])) {
    importLines.push(`import { car, ped, hier } from ${JSON.stringify(ideImp)};`);
  }
  if (usesTimedHelper([hoistedBlocks, body])) {
    importLines.push(`import { timed } from ${JSON.stringify(scmImp)};`);
  }
  if (hudPrelude.importLine) importLines.push(hudPrelude.importLine);

  const chunks: string[] = [headerLines.join("\n"), importLines.join("\n")];
  if (liftedTopComments?.length) chunks.push(liftedTopComments.join("\n"));
  if (hudPrelude.declLines.length > 0) chunks.push(hudPrelude.declLines.join("\n"));
  if (hoistedBlocks) chunks.push(hoistedBlocks);
  chunks.push(`export async function ${fnName}() {\n${body}\n}`);
  const text = `${chunks.join("\n\n")}\n`;
  return { jsPath: relJs, text };
}

export function emitFileJs(
  relScPath: string,
  source: string,
  scope: ProjectScope,
  outRoot: string,
  repoRoot: string,
  strict: boolean,
  opts?: EmitOpts,
): { jsPath: string; text: string } {
  let sf = parseSource(source);
  sf = lowerSourceFile(sf);
  const typeEnv = collectTypeEnv(sf);
  const relJs = relScPath.replace(/\.sc$/i, ".ts");
  const baseName = path.basename(relJs, ".ts");
  const fnName = scope.jsName(baseName);
  const { preamble, sections } = splitLabeledSections(sf.body);

  if (opts?.splitMainLabels && isMainScRel(relScPath)) {
    if (sections.length > 0) {
      fs.mkdirSync(path.join(outRoot, path.dirname(relJs)), { recursive: true });

      const dir = path.dirname(relJs);
      const mainOutAbs = path.join(outRoot, relJs);
      const relFromMain = (toAbs: string) => {
        let r = path.relative(path.dirname(mainOutAbs), toAbs).replace(/\\/g, "/");
        if (!r.startsWith(".")) r = "./" + r;
        return r;
      };
      const importLines: string[] = [];
      for (const sec of sections) {
        const slug = slugLabel(sec.label);
        const childRelSc = path.posix.join(dir === "." ? "" : dir, `${baseName}.${slug}.sc`);
        const childSf: SourceFile = { ...sf, body: sec.body };
        const childFn = `${fnName}_${slug}`;
        const { jsPath: childPath, text: childText } = emitOneJsModule({
          relScPath: childRelSc,
          scope,
          strict,
          typeEnv,
          outRoot,
          repoRoot,
          sf: childSf,
          fnName: childFn,
          selfLoopLabel: sec.label,
          headerExtra: [
            `// Extracted label block ${sec.label} from ${relScPath} (--split-main-labels).`,
            `// Uses shared vars.mts bindings; all copies address the same script variables.`,
          ],
        });
        const outChild = path.join(outRoot, childPath);
        fs.mkdirSync(path.dirname(outChild), { recursive: true });
        fs.writeFileSync(outChild, childText);
        const importFrom = relFromMain(outChild);
        importLines.push(`import { ${childFn} } from ${JSON.stringify(importFrom)};`);
      }

      const mainSf: SourceFile = { ...sf, body: preamble };
      const varsImp = relFromMain(path.join(outRoot, "gta3", "vars.mts"));
      const ideImp = relFromMain(path.join(outRoot, "ide.mts"));
      const scmImp = relFromMain(path.join(outRoot, "scm.mts"));
      const { ctx } = makeTxCtx(mainSf, scope, strict, typeEnv);
      const body = emitFunctionBody(ctx, mainSf.body, "  ");
      const hudPrelude = buildHudWrapPrelude(ctx);
      const headerLines = buildFileHeaderLines({ relScPath });
      headerLines.push(
        "// Split label modules (--split-main-labels): sibling files export per-label async functions.",
      );
      const moduleImports = [...importLines, `import { $ } from ${JSON.stringify(varsImp)};`];
      if (usesIdeHelpers([body])) {
        moduleImports.push(`import { car, ped, hier } from ${JSON.stringify(ideImp)};`);
      }
      if (usesTimedHelper([body])) {
        moduleImports.push(`import { timed } from ${JSON.stringify(scmImp)};`);
      }
      if (hudPrelude.importLine) moduleImports.push(hudPrelude.importLine);
      const chunks: string[] = [headerLines.join("\n"), moduleImports.join("\n")];
      if (hudPrelude.declLines.length > 0) chunks.push(hudPrelude.declLines.join("\n"));
      chunks.push(`export async function ${fnName}() {\n${body}\n}`);
      const text = `${chunks.join("\n\n")}\n`;
      return { jsPath: relJs, text };
    }
  }

  const useHoist = sections.length > 0 && !(opts?.splitMainLabels && isMainScRel(relScPath));

  const missionPrelude = useHoist ? analyzeMissionPrelude(sf, preamble) : undefined;

  return emitOneJsModule({
    relScPath,
    scope,
    strict,
    typeEnv,
    outRoot,
    repoRoot,
    sf,
    fnName,
    hoistedLabelSections: useHoist ? sections : undefined,
    mainBodyTops: useHoist ? (missionPrelude?.mainBodyTops ?? preamble) : undefined,
    labelFnNames: missionPrelude?.labelFnNames,
    liftedTopComments: missionPrelude?.liftedCommentLines,
    stripLeadingBodyComments: missionPrelude?.stripBodyCommentLines,
  });
}
