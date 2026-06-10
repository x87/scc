/** Concrete syntax: all nodes carry token spans for lossless print. */

import type { Token } from "./lex.ts";

export type TokRef = { start: number; end: number };

export function sliceText(tokens: Token[], ref: TokRef): string {
  let s = "";
  for (let i = ref.start; i <= ref.end && i < tokens.length; i++) {
    const t = tokens[i]!;
    s += t.leadingTrivia + t.lexeme;
  }
  return s;
}

export function emptyTokRef(): TokRef {
  return { start: -1, end: -1 };
}

export function mergeTokRef(a: TokRef, b: TokRef): TokRef {
  if (a.start < 0) return b;
  if (b.start < 0) return a;
  return { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) };
}

export type TopLevel = Statement | { kind: "Gap"; tok: TokRef };

export type SourceFile = {
  tokens: Token[];
  body: TopLevel[];
  tok: TokRef;
};

export type Statement =
  | { kind: "Mut"; op: "++" | "--"; target: string; postfix?: boolean; tok: TokRef }
  | { kind: "VarDecl"; varKind: VarDeclKind; names: string[]; tok: TokRef }
  | { kind: "ScriptName"; name: string; tok: TokRef }
  | { kind: "MissionBoundary"; which: "START" | "END"; tok: TokRef }
  | { kind: "Label"; name: string; tok: TokRef }
  | { kind: "Block"; kindBrace: "OPEN" | "CLOSE"; tok: TokRef }
  | {
      kind: "Assignment";
      target: string;
      op: "=" | "+=" | "-=" | "*=" | "/=" | "+=@" | "-=@" | "=#";
      rhs: Expr;
      tok: TokRef;
    }
  | { kind: "If"; clauses: CondClause[]; thenStmts: Statement[]; elseStmts?: Statement[]; tok: TokRef }
  | { kind: "While"; clauses: CondClause[]; body: Statement[]; tok: TokRef }
  | { kind: "Repeat"; count: AtomExpr; counterVar: string; body: Statement[]; tok: TokRef }
  | { kind: "Command"; name: string; args: RawArg[]; tok: TokRef }
  | { kind: "Goto"; label: string; tok: TokRef }
  | { kind: "Gosub"; label: string; tok: TokRef }
  | { kind: "GosubFile"; alias: string; path: string; tok: TokRef }
  | { kind: "Return"; tok: TokRef }
  | { kind: "Terminate"; tok: TokRef }
  | { kind: "StartNewScript"; label: string; tok: TokRef }
  | { kind: "LaunchMission"; path: string; tok: TokRef }
  | { kind: "LoadLaunchMission"; path: string; tok: TokRef };

export type VarDeclKind = "VAR_INT" | "VAR_FLOAT" | "LVAR_INT" | "LVAR_FLOAT";

export type CondClause =
  | { join?: "AND" | "OR"; not: boolean; pred: Predicate; tok: TokRef };

export type Predicate =
  | { kind: "Compare"; left: Expr; cmp: CmpOp; right: Expr; tok: TokRef }
  | { kind: "Invoke"; name: string; args: RawArg[]; tok: TokRef };

export type CmpOp = "==" | "!=" | "<>" | "<" | ">" | "<=" | ">=" | "=";

export type Expr =
  | { kind: "Binary"; left: Expr; op: "+" | "-" | "*" | "/" | "+@" | "-@"; right: Expr; tok: TokRef }
  | { kind: "UnaryMinus"; inner: Expr; tok: TokRef }
  | { kind: "Atom"; atom: AtomExpr; tok: TokRef };

export type AtomExpr =
  | { kind: "ident"; name: string; tok: TokRef }
  | { kind: "number"; raw: string; tok: TokRef }
  | { kind: "string"; raw: string; tok: TokRef }
  | { kind: "parenLabel"; inner: string; tok: TokRef };

export type RawArg =
  | { kind: "ident"; name: string; tok: TokRef }
  | { kind: "number"; raw: string; tok: TokRef }
  | { kind: "string"; raw: string; tok: TokRef }
  | { kind: "parenLabel"; inner: string; tok: TokRef }
  | { kind: "parenGroup"; tok: TokRef }
  | { kind: "operator"; op: string; tok: TokRef };

export function tokensToSource(tokens: Token[]): string {
  let o = "";
  for (const t of tokens) o += t.leadingTrivia + t.lexeme;
  return o;
}

export function printExpr(tokens: Token[], e: Expr): string {
  switch (e.kind) {
    case "Atom":
      return printAtom(tokens, e.atom);
    case "UnaryMinus":
      return "-" + printExpr(tokens, e.inner);
    case "Binary":
      return `${printExpr(tokens, e.left)} ${e.op} ${printExpr(tokens, e.right)}`;
  }
}

export function printAtom(tokens: Token[], a: AtomExpr): string {
  switch (a.kind) {
    case "ident":
    case "number":
    case "string":
    case "parenLabel":
      return sliceText(tokens, a.tok);
  }
}
