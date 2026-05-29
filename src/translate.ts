import type { Token } from "./lex.ts";
import type { CmpOp, CondClause, Expr, Predicate, RawArg, Statement, AtomExpr } from "./cst.ts";
import { sliceText } from "./cst.ts";
import type { Gta3Command, Gta3Input } from "./gta3.ts";
import { lookupCommand } from "./gta3.ts";
import { loadConstsIndex } from "./consts.ts";
import { enumMemberStringValue } from "./enum-map.ts";
import { emitModelExpr, emitObjectModelLiteral, isModelConstant } from "./models.ts";
import type { TypeEnv } from "./types.ts";

type HudWrapKind = "timer" | "counter";

type HudWrapBinding = {
  kind: HudWrapKind;
  localVar: string;
  globalRef: string;
};

export type HudWrapState = {
  activeByGlobalRef: Map<string, HudWrapBinding>;
  timerVars: Set<string>;
  counterVars: Set<string>;
};

export function createHudWrapState(): HudWrapState {
  return {
    activeByGlobalRef: new Map(),
    timerVars: new Set(),
    counterVars: new Set(),
  };
}

export type TxCtx = {
  tokens: Token[];
  /** SC name → JS identifier for locals/globals */
  ref: (scName: string) => string;
  /** Optional label -> emitted async function name overrides. */
  labelFnNames?: Map<string, string>;
  strict: boolean;
  unknowns: string[];
  /** Inferred SCM types (globals/locals) for constructor slots in bind */
  typeEnv?: TypeEnv;
  /** Flow-sensitive rewrites for HUD timer/counter wrappers. */
  hudWrap: HudWrapState;
  /** Names declared via DECLARE_MISSION_FLAG that should resolve to ONMISSION. */
  missionFlagAliases: Set<string>;
};

const CONST_VALUES = (() => {
  const idx = loadConstsIndex();
  const m = new Map<string, number>();
  for (const [name, value] of Object.entries(idx.constants)) {
    m.set(name.toUpperCase(), Number(value));
  }
  return m;
})();

function constLiteralWithComment(name: string): string | undefined {
  const v = CONST_VALUES.get(name.toUpperCase());
  if (v === undefined) return undefined;
  return `${v} /* ${name} */`;
}

function isBoolType(type: string | undefined): boolean {
  if (!type) return false;
  const t = type.trim().toLowerCase();
  return t === "bool" || t === "boolean";
}

function boolLiteralFromIdent(name: string): string | undefined {
  const upper = name.toUpperCase();
  const v = CONST_VALUES.get(upper);
  if (v === 0 || v === 1) {
    return `${v === 1 ? "true" : "false"} /* ${name} */`;
  }
  if (upper === "FALSE" || upper === "OFF") return `false /* ${name} */`;
  if (upper === "TRUE" || upper === "ON") return `true /* ${name} */`;
  return undefined;
}

function boolLiteralFromNumber(raw: string): string | undefined {
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  if (n === 0) return "false";
  if (n === 1) return "true";
  return undefined;
}

function normalizeNumberRaw(raw: string): string {
  // Match numbers like [+|-]digits[.fraction][eE...]
  const m = raw.match(/^([+-]?)(\d+)(\.\d+)?([eE][+-]?\d+)?$/);
  if (!m) return raw;
  const sign = m[1] || "";
  const intPart = m[2] || "0";
  const frac = m[3] || "";
  const exp = m[4] || "";
  const intNormalized = String(Number(intPart));
  return `${sign}${intNormalized}${frac}${exp}`;
}

function emitClassName(name?: string): string | undefined {
  if (!name) return name;
  if (name === "Object") return "ScriptObject";
  return name;
}

let __tmpCounter = 0;
function nextTmpName(): string {
  __tmpCounter += 1;
  return `_res${__tmpCounter}`;
}

function parseParenGroupToken(part: string, tok: RawArg["tok"]): RawArg {
  if (/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(part)) {
    return { kind: "number", raw: part, tok };
  }
  if (
    (part.startsWith("\"") && part.endsWith("\"")) ||
    (part.startsWith("'") && part.endsWith("'"))
  ) {
    return { kind: "string", raw: part, tok };
  }
  return { kind: "ident", name: part, tok };
}

function expandParenGroupArg(ctx: TxCtx, a: RawArg): RawArg[] {
  if (a.kind !== "parenGroup") return [a];
  const raw = sliceText(ctx.tokens, a.tok).trim();
  if (!(raw.startsWith("(") && raw.endsWith(")"))) return [a];
  const inner = raw.slice(1, -1).trim();
  if (!inner) return [];
  const parts = inner.match(/"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'|[^\s,]+/g) ?? [];
  return parts.map((p) => parseParenGroupToken(p, a.tok));
}

function normalizeArgsForCommand(ctx: TxCtx, args: RawArg[]): RawArg[] {
  const out: RawArg[] = [];
  for (const a of args) out.push(...expandParenGroupArg(ctx, a));
  return out;
}

function wrapperVarFromGlobalRef(globalRef: string): string | undefined {
  if (!globalRef.startsWith("$.")) return undefined;
  const candidate = globalRef.slice(2);
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(candidate)) return undefined;
  return candidate;
}

function globalIdRefFromGlobalRef(globalRef: string): string | undefined {
  const name = wrapperVarFromGlobalRef(globalRef);
  if (!name) return undefined;
  return `$.$id.${name}`;
}

function refForRead(ctx: TxCtx, scName: string): string {
  return ctx.ref(scName);
}

function refForWrite(ctx: TxCtx, scName: string): string {
  return ctx.ref(scName);
}

function registerMissionFlagAlias(ctx: TxCtx, scName: string): void {
  ctx.missionFlagAliases.add(scName.toLowerCase());
}

function maybeRegisterMissionFlagAlias(ctx: TxCtx, name: string, args: RawArg[]): void {
  if (name.toUpperCase() !== "DECLARE_MISSION_FLAG") return;
  const first = args[0];
  if (first?.kind !== "ident") return;
  registerMissionFlagAlias(ctx, first.name);
}

function rawArgToJsMode(ctx: TxCtx, a: RawArg, wrapDisplayedRefs: boolean): string {
  switch (a.kind) {
    case "ident": {
      const c = constLiteralWithComment(a.name);
      if (c) return c;
      return wrapDisplayedRefs ? refForRead(ctx, a.name) : ctx.ref(a.name);
    }
    case "number":
      return normalizeNumberRaw(a.raw);
    case "string":
      return a.raw;
    case "parenLabel":
      return JSON.stringify(a.inner);
    case "parenGroup":
      return sliceText(ctx.tokens, a.tok);
    case "operator":
      return a.op;
  }
}

export function rawArgToJs(ctx: TxCtx, a: RawArg): string {
  return rawArgToJsMode(ctx, a, true);
}

/** Map a command argument using gta3.json input slot (enums, models). */
function rawArgToJsWithInputMode(
  ctx: TxCtx,
  spec: Gta3Input | undefined,
  a: RawArg,
  wrapDisplayedRefs: boolean,
): string {
  if (!spec?.type) return rawArgToJsMode(ctx, a, wrapDisplayedRefs);
  const ty = spec.type;
  if (isBoolType(ty)) {
    if (a.kind === "ident") {
      const b = boolLiteralFromIdent(a.name);
      if (b) return b;
      const c = constLiteralWithComment(a.name);
      if (c) return c;
      return wrapDisplayedRefs ? refForRead(ctx, a.name) : ctx.ref(a.name);
    }
    if (a.kind === "number") {
      const b = boolLiteralFromNumber(a.raw);
      if (b) return b;
    }
    return rawArgToJsMode(ctx, a, wrapDisplayedRefs);
  }
  if (a.kind === "ident") {
    // If the GTA3 metadata marks this input type as `string`, the SC source
    // provides a literal string token rather than a variable reference. Emit
    // the identifier as a quoted string literal so names like `PLAYERH` or
    // `cutobj01` become "PLAYERH" instead of `$.PLAYERH`.
    if (ty === "string") {
      return JSON.stringify(a.name);
    }
    if (ty === "zone_key") {
      return JSON.stringify(a.name);
    }
    if (ty === "gxt_key") {
      return JSON.stringify(a.name);
    }
    if (ty === "model_object") {
      const obj = emitObjectModelLiteral(a.name);
      if (obj) return obj;
    }
    // SfxMission is an enum whose members map to string values (see enums.ts).
    // Emit the corresponding string literal when present and cast to any
    // to avoid TypeScript errors where a `string` is used where a
    // `SfxMission` typed value is expected.
    if (ty === "SfxMission") {
      const sv = enumMemberStringValue("SfxMission", a.name);
      if (sv !== undefined) return `${JSON.stringify(sv)} as any`;
    }
    if (ty === "model_char" || ty === "model_any" || ty === "model_car") {
      // Prefer resolving against `objs.json` (numeric id) when available,
      // otherwise fall back to tagged template (`car`/`ped`/`hier`) for
      // prefix-style constants like CAR_*/PED_*/CUT_OBJ*.
      const objLit = emitObjectModelLiteral(a.name);
      if (objLit) return objLit;
      if (isModelConstant(a.name)) return emitModelExpr(a.name);
    }
    const c = constLiteralWithComment(a.name);
    if (c) return c;
  }
  return rawArgToJsMode(ctx, a, wrapDisplayedRefs);
}

export function rawArgToJsWithInput(ctx: TxCtx, spec: Gta3Input | undefined, a: RawArg): string {
  return rawArgToJsWithInputMode(ctx, spec, a, true);
}

export function exprToJs(ctx: TxCtx, e: Expr): string {
  switch (e.kind) {
    case "Atom":
      return atomToJs(ctx, e.atom);
    case "UnaryMinus":
      return `-${exprToJs(ctx, e.inner)}`;
    case "Binary":
      return `${exprToJs(ctx, e.left)} ${e.op} ${exprToJs(ctx, e.right)}`;
  }
}

function atomToJs(ctx: TxCtx, a: AtomExpr): string {
  switch (a.kind) {
    case "ident": {
      const c = constLiteralWithComment(a.name);
      if (c) return c;
      return refForRead(ctx, a.name);
    }
    case "number":
      return normalizeNumberRaw(a.raw);
    case "string":
      return a.raw;
    case "parenLabel":
      return JSON.stringify(a.inner);
  }
}

function cmpToJs(cmp: CmpOp): string {
  switch (cmp) {
    case "=":
      return "==";
    case "<>":
      return "!=";
    default:
      return cmp;
  }
}

function lowerInstanceMember(member: string): string {
  if (!member) return member;
  return member.charAt(0).toLowerCase() + member.slice(1);
}

function mapArgsWithDef(
  ctx: TxCtx,
  def: Gta3Command | undefined,
  args: RawArg[],
  wrapDisplayedRefs = true,
): string[] {
  if (!def?.input?.length) return args.map((a) => rawArgToJsMode(ctx, a, wrapDisplayedRefs));
  const normalized = normalizeArgsForCommand(ctx, args);
  return normalized.map((a, i) => rawArgToJsWithInputMode(ctx, def.input![i], a, wrapDisplayedRefs));
}

/** SCM IF/WHILE condition invoke → JS expression using lookupCommand + is_condition. */
export function conditionInvokeToJs(ctx: TxCtx, name: string, args: RawArg[]): string {
  const def = lookupCommand(name);
  if (!def?.attrs?.is_condition) {
    const jsArgs = args.map((a) => rawArgToJs(ctx, a));
    return `${name}(${jsArgs.join(", ")})`;
  }
  if (def.operator && def.input?.length === 2 && args.length === 2) {
    const left = rawArgToJsWithInput(ctx, def.input[0], args[0]!);
    const right = rawArgToJsWithInput(ctx, def.input[1], args[1]!);
    return `${left} ${def.operator} ${right}`;
  }
  const mapped = mapArgsWithDef(ctx, def, args);
  if (def.attrs?.is_static && def.class && def.member) {
    return `${emitClassName(def.class)}.${def.member}(${mapped.join(", ")})`;
  }
  if (def.class && def.member && mapped.length >= 1) {
    const self = mapped[0]!;
    const rest = mapped.slice(1).join(", ");
    return `${self}.${lowerInstanceMember(def.member)}(${rest})`;
  }
  const jsArgs = args.map((a) => rawArgToJs(ctx, a));
  return `${name}(${jsArgs.join(", ")})`;
}

function clauseExpr(ctx: TxCtx, c: CondClause): string {
  const p = c.pred;
  let inner = "";
  if (p.kind === "Compare") {
    inner = `${exprToJs(ctx, p.left)} ${cmpToJs(p.cmp)} ${exprToJs(ctx, p.right)}`;
  } else {
    inner = conditionInvokeToJs(ctx, p.name, p.args);
  }
  if (c.not) inner = `!(${inner})`;
  return inner;
}

function joinClauses(ctx: TxCtx, clauses: CondClause[]): string {
  const parts: string[] = [];
  for (const c of clauses) {
    const ex = clauseExpr(ctx, c);
    if (c.join === "OR") parts.push("||");
    else if (c.join === "AND") parts.push("&&");
    parts.push(ex);
  }
  return parts.join(" ");
}

function emitCallExpr(
  ctx: TxCtx,
  def: Gta3Command,
  args: RawArg[],
  paramCount: number,
): { expr: string; stmt: string } | null {
  const mapped = mapArgsWithDef(ctx, def, args.slice(0, paramCount));
  if (def.attrs?.is_static && def.class && def.member) {
    return { expr: `${emitClassName(def.class)}.${def.member}(${mapped.join(", ")})`, stmt: "" };
  }
  if (def.class && def.member && mapped.length >= 1) {
    const self = mapped[0]!;
    const rest = mapped.slice(1).join(", ");
    return { expr: `${self}.${lowerInstanceMember(def.member)}(${rest})`, stmt: "" };
  }
  return null;
}

function registerHudWrapper(ctx: TxCtx, kind: HudWrapKind, globalRef: string, localVar: string): void {
  const binding: HudWrapBinding = { kind, globalRef, localVar };
  ctx.hudWrap.activeByGlobalRef.set(globalRef, binding);
  if (kind === "timer") ctx.hudWrap.timerVars.add(localVar);
  else ctx.hudWrap.counterVars.add(localVar);
}

function tryTransformHudCommand(
  ctx: TxCtx,
  def: Gta3Command,
  args: RawArg[],
): string | undefined {
  if (!def.attrs?.is_static || def.class !== "Hud" || !def.member) return undefined;
  const normalized = normalizeArgsForCommand(ctx, args);
  const a0 = normalized[0];
  if (!a0 || a0.kind !== "ident") return undefined;

  const globalRef = ctx.ref(a0.name);
  const globalIdRef = globalIdRefFromGlobalRef(globalRef);
  if (!globalIdRef) return undefined;

  if (
    def.member === "DisplayTimer" ||
    def.member === "DisplayTimerWithString" ||
    def.member === "DisplayCounter" ||
    def.member === "DisplayCounterWithString" ||
    def.member === "ClearTimer" ||
    def.member === "ClearCounter"
  ) {
    const tailArgs = normalized
      .slice(1)
      .map((arg, i) => rawArgToJsWithInputMode(ctx, def.input?.[i + 1], arg, true));
    const callArgs = [globalIdRef, ...tailArgs].join(", ");
    return `Hud.${def.member}(${callArgs});`;
  }

  return undefined;
}

export function translateCommandLine(
  ctx: TxCtx,
  name: string,
  args: RawArg[],
  def: Gta3Command | undefined,
): string {
  const u = name.toUpperCase();
  if (u === "WAIT") {
    const ms = args[0] ? rawArgToJs(ctx, args[0]) : "0";
    return `await asyncWait(${ms});`;
  }
  if (!def) {
    ctx.unknowns.push(name);
    if (ctx.strict) throw new Error(`Unknown command ${name}`);
    const orig = [name, ...args.map((a) => rawArgToJs(ctx, a))].join(" ");
    return `// UNKNOWN_COMMAND ${orig}\nthrow new Error(${JSON.stringify("Unknown: " + name)});`;
  }
  if (def.attrs?.is_unsupported || def.attrs?.is_nop) {
    return `// unsupported ${name}`;
  }
  const hudTransformed = tryTransformHudCommand(ctx, def, args);
  if (hudTransformed) return hudTransformed;
  if (def.operator && def.input && def.input.length >= 2) {
    const a0 = args[0];
    const a1 = args[1];
    if (a0?.kind === "ident" && a1) {
      const lhs = refForWrite(ctx, a0.name);
      const rhs = rawArgToJsWithInput(ctx, def.input[1], a1);
      return `${lhs} ${def.operator}= ${rhs};`;
    }
  }
  const inLen = def.input?.length ?? 0;
  const outLen = def.output?.length ?? 0;
  if (
    !def.input?.length &&
    outLen === 1 &&
    args.length === 1 &&
    args[0]?.kind === "ident" &&
    def.attrs?.is_static &&
    def.class &&
    def.member
  ) {
    const r = refForWrite(ctx, args[0].name);
    if (def.member === "Abs") {
      return `${r} = ${emitClassName(def.class)}.Abs(${r});`;
    }
    return `${r} = ${emitClassName(def.class)}.${def.member}();`;
  }
  const takesOutputs = outLen > 0 && !def.attrs?.is_constructor && !def.operator;
  if (takesOutputs && args.length === inLen + outLen) {
    const callArgs = args.slice(0, inLen);
    const outArgs = args.slice(inLen);
    const allIdents = outArgs.every((a) => a.kind === "ident");
    if (allIdents) {
      const call = emitCallExpr(ctx, def, args, inLen);
      if (call) {
        const refs = outArgs.map((a) => refForWrite(ctx, (a as { name: string }).name));
        if (outLen === 1) {
          return `${refs[0]} = ${call.expr};`;
        }
        // If RHS is an instance method call and targets are globals, avoid destructuring into globals
        // by storing the result into a temp and copying properties. This prevents assigning into
        // `$.foo` via destructuring which may be undesirable in emitted JS.
        const isMethodCall = /\.[A-Za-z_$][A-Za-z0-9_$]*\([^)]*\)$/.test(call.expr);
        const allGlobals = refs.every((r) => r.startsWith("$."));
        if (isMethodCall && allGlobals) {
          const tmp = nextTmpName();
          const propNames = (def.output ?? []).slice(0, outLen).map((o) => o.name);
          const assigns = refs.map((r, i) => {
            const prop = propNames[i] ?? String(i);
            return `${r} = ${tmp}.${prop}`;
          });
          return `const ${tmp} = ${call.expr};\n${assigns.join(";\n")};`;
        }
        return `[${refs.join(", ")}] = ${call.expr};`;
      }
    }
  }
  const jsArgs = mapArgsWithDef(ctx, def, args);
  if (def.attrs?.is_constructor && def.class && def.member && def.output?.length) {
    const handle = args[args.length - 1];
    if (handle?.kind === "ident") {
      const lhs = refForWrite(ctx, handle.name);
      const rhs = `${emitClassName(def.class)}.${def.member}(${jsArgs.slice(0, -1).join(", ")})`;
      return `${lhs} = ${rhs};`;
    }
  }
  if (def.attrs?.is_static && def.class && def.member) {
    return `${emitClassName(def.class)}.${def.member}(${jsArgs.join(", ")});`;
  }
  if (def.class && def.member) {
    const self = jsArgs[0];
    const rest = jsArgs.slice(1).join(", ");
    return `${self}.${lowerInstanceMember(def.member)}(${rest});`;
  }
  return `// ${name}(${jsArgs.join(", ")});`;
}

export function translateStatement(
  ctx: TxCtx,
  st: Statement,
  defFor: (n: string) => Gta3Command | undefined,
  indent: string,
  emitChild: (s: Statement, ind: string) => string[],
): string[] {
  const lines: string[] = [];

  const extractCommentLines = (raw: string): string[] => {
    if (!raw) return [];
    const out: string[] = [];
    const normalized = raw.replace(/\r/g, "");
    const srcLines = normalized.split("\n");
    const hasLineBreak = normalized.includes("\n");
    let inBlock = false;
    for (const ln of srcLines) {
      const trimmed = ln.trim();
      if (!trimmed) {
        if (hasLineBreak) out.push("");
        continue;
      }
      const isCommentLine =
        inBlock ||
        trimmed.startsWith("//") ||
        trimmed.startsWith("/*") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("*/");
      if (!isCommentLine) continue;
      out.push(`${indent}${trimmed}`);
      if (trimmed.startsWith("/*") && !trimmed.includes("*/")) inBlock = true;
      if (inBlock && trimmed.includes("*/")) inBlock = false;
    }
    return out;
  };

  const splitRawLines = (raw: string): Array<{ line: string; isCode: boolean }> => {
    const srcLines = raw.replace(/\r/g, "").split("\n");
    const infos: Array<{ line: string; isCode: boolean }> = [];
    let inBlock = false;
    for (const line of srcLines) {
      const trimmed = line.trim();
      let isComment = false;
      if (trimmed.length > 0) {
        isComment =
          inBlock ||
          trimmed.startsWith("//") ||
          trimmed.startsWith("/*") ||
          trimmed.startsWith("*") ||
          trimmed.startsWith("*/");
      }
      infos.push({ line, isCode: trimmed.length > 0 && !isComment });
      if (trimmed.startsWith("/*") && !trimmed.includes("*/")) inBlock = true;
      if (inBlock && trimmed.includes("*/")) inBlock = false;
    }
    return infos;
  };

  const extractLeadingComments = (): string[] => {
    const raw = sliceText(ctx.tokens, st.tok).replace(/\r/g, "");
    const linesInfo = splitRawLines(raw);
    const codeIdx = linesInfo.findIndex((ln) => ln.isCode);
    if (codeIdx <= 0) return codeIdx < 0 ? extractCommentLines(raw) : [];
    const preRaw = linesInfo
      .slice(0, codeIdx)
      .map((ln) => ln.line)
      .join("\n");
    return extractCommentLines(preRaw);
  };

  const extractTrailingComments = (): string[] => {
    const raw = sliceText(ctx.tokens, st.tok).replace(/\r/g, "");
    const linesInfo = splitRawLines(raw);
    let lastCodeIdx = -1;
    for (let i = linesInfo.length - 1; i >= 0; i--) {
      if (!linesInfo[i]?.isCode) continue;
      lastCodeIdx = i;
      break;
    }
    if (lastCodeIdx < 0) return [];
    const postRaw = linesInfo
      .slice(lastCodeIdx + 1)
      .map((ln) => ln.line)
      .join("\n");
    return extractCommentLines(postRaw);
  };

  const extractCommandComments = (): { pre: string[]; inline?: string; post: string[] } => {
    const raw = sliceText(ctx.tokens, st.tok).replace(/\r/g, "");
    const linesInfo = splitRawLines(raw);
    const codeIdx = linesInfo.findIndex((ln) => ln.isCode);
    if (codeIdx < 0) {
      return { pre: extractCommentLines(raw), post: [] };
    }
    const preRaw = linesInfo
      .slice(0, codeIdx)
      .map((ln) => ln.line)
      .join("\n");
    const postRaw = linesInfo
      .slice(codeIdx + 1)
      .map((ln) => ln.line)
      .join("\n");
    const codeLine = linesInfo[codeIdx]?.line ?? "";
    const inlineMatch = codeLine.match(/\/\/[^\r\n]*$/);
    return {
      pre: extractCommentLines(preRaw),
      inline: inlineMatch?.[0]?.trim(),
      post: extractCommentLines(postRaw),
    };
  };

  const nonCommand = st.kind !== "Command";
  if (nonCommand) {
    lines.push(...extractLeadingComments());
  }

  switch (st.kind) {
    case "VarDecl":
      lines.push(`${indent}// ${st.varKind} ${st.names.join(" ")}`);
      break;
    case "Assignment":
      lines.push(
        `${indent}${refForWrite(ctx, st.target)} ${st.op === "=#" ? "=" : st.op} ${exprToJs(ctx, st.rhs)};`,
      );
      break;
    case "Mut": {
      const t = refForWrite(ctx, st.target);
      if (st.postfix) {
        lines.push(`${indent}${st.op === "++" ? `${t}++` : `${t}--`};`);
      } else {
        lines.push(`${indent}${st.op === "++" ? `++${t}` : `--${t}`};`);
      }
      break;
    }
    case "Command":
      {
        maybeRegisterMissionFlagAlias(ctx, st.name, st.args);
        const c = extractCommandComments();
        lines.push(...c.pre);
        const cmd = translateCommandLine(ctx, st.name, st.args, defFor(st.name));
        if (c.inline && !cmd.includes("\n")) {
          lines.push(`${indent}${cmd} ${c.inline}`);
        } else {
          lines.push(`${indent}${cmd}`);
        }
        lines.push(...c.post);
      }
      break;
    case "Label":
      lines.push(`${indent}// SCM label ${st.name}`);
      break;
    case "Block":
      // Raw SCM scope braces are structural hints in source and should not
      // emit standalone JS braces.
      break;
    case "Goto":
      lines.push(`${indent}// SCM GOTO → ${st.label} (not lowered; manual jump required)`);
      lines.push(
        `${indent}throw new Error(${JSON.stringify(`unresolved GOTO ${st.label}`)}); // fallback: would break linear control flow`,
      );
      break;
    case "Gosub":
      lines.push(`${indent}// SCM GOSUB ${st.label}`);
      // GOSUB targets are labels (local functions), not variables. If the
      // resolver `ctx.ref` would produce a global reference like `$.name`,
      // strip the `$.` prefix so we call the local function instead of the
      // global variable. This ensures `GOSUB boat_health` emits
      // `await boat_health()` even when a global `boat_health` slot exists.
      const _rawFn = ctx.labelFnNames?.get(st.label) ?? ctx.ref(st.label);
      const fnName = _rawFn.startsWith("$.") ? _rawFn.slice(2) : _rawFn;
      lines.push(`${indent}await ${fnName}();`);
      lines.push(`${indent}// fallback if label was not emitted as async function: no-op continues linearly`);
      break;
    case "Return":
      lines.push(`${indent}return;`);
      break;
    case "Terminate":
      lines.push(`${indent}return; // TERMINATE_THIS_SCRIPT`);
      break;
    case "ScriptName":
      lines.push(`${indent}// SCRIPT_NAME ${st.name}`);
      break;
    case "MissionBoundary":
      lines.push(`${indent}// ${st.kind}`);
      break;
    case "GosubFile":
      lines.push(`${indent}// GOSUB_FILE ${st.alias} ${st.path}`);
      break;
    case "StartNewScript":
      lines.push(`${indent}// START_NEW_SCRIPT ${st.label}`);
      break;
    case "LaunchMission":
    case "LoadLaunchMission":
      lines.push(`${indent}// ${st.kind} ${"path" in st ? st.path : ""}`);
      break;
    case "If": {
      lines.push(`${indent}if (${joinClauses(ctx, st.clauses)}) {`);
      for (const s of st.thenStmts) lines.push(...emitChild(s, indent + "  "));
      lines.push(`${indent}}`);
      if (st.elseStmts?.length) {
        lines.push(`${indent}else {`);
        for (const s of st.elseStmts) lines.push(...emitChild(s, indent + "  "));
        lines.push(`${indent}}`);
      }
      break;
    }
    case "While": {
      lines.push(`${indent}while (${joinClauses(ctx, st.clauses)}) {`);
      for (const s of st.body) lines.push(...emitChild(s, indent + "  "));
      lines.push(`${indent}}`);
      break;
    }
    case "Repeat":
      lines.push(
        `${indent}for (let ${ctx.ref(st.counterVar)} = 0; ${ctx.ref(st.counterVar)} < ${atomToJs(ctx, st.count)}; ${ctx.ref(st.counterVar)}++) {`,
      );
      for (const s of st.body) lines.push(...emitChild(s, indent + "  "));
      lines.push(`${indent}}`);
      break;
    default:
      lines.push(`${indent}// ${(st as Statement).kind}`);
  }
  if (nonCommand) {
    lines.push(...extractTrailingComments());
  }
  return lines;
}
