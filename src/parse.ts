import { lex, type Token, type TokenKind } from "./lex.ts";
import type {
  AtomExpr,
  CmpOp,
  CondClause,
  Expr,
  Predicate,
  RawArg,
  SourceFile,
  Statement,
  TopLevel,
  TokRef,
  VarDeclKind,
} from "./cst.ts";
import { mergeTokRef } from "./cst.ts";

function upper(s: string): string {
  return s.toUpperCase();
}

function refOne(i: number): TokRef {
  return { start: i, end: i };
}

function mergeRefRange(a: TokRef, b: TokRef): TokRef {
  return mergeTokRef(a, b);
}

export function tokensToSource(tokens: Token[]): string {
  let o = "";
  for (const t of tokens) o += t.leadingTrivia + t.lexeme;
  return o;
}

export class Parser {
  tokens: Token[];
  idx = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  peek(): Token {
    return this.tokens[this.idx]!;
  }

  at(kind: TokenKind): boolean {
    return this.peek().kind === kind;
  }

  identUpper(): string | null {
    const t = this.peek();
    if (t.kind !== "IDENT") return null;
    return upper(t.lexeme);
  }

  eat(): Token {
    return this.tokens[this.idx++]!;
  }

  eof(): boolean {
    return this.peek().kind === "EOF";
  }

  parseFile(): SourceFile {
    const body = this.parseTopLevel(() => false);
    if (!this.eof()) {
      throw new Error(`Expected EOF at token ${this.idx}, got ${this.peek().kind}`);
    }
    const last = this.tokens.length - 1;
    const tok =
      body.length === 0
        ? refOne(0)
        : mergeRefRange(
            body[0]!.kind === "Gap" ? body[0]!.tok : (body[0] as { tok: TokRef }).tok,
            refOne(last),
          );
    return { tokens: this.tokens, body, tok };
  }

  parseTopLevel(stop: () => boolean): TopLevel[] {
    const out: TopLevel[] = [];
    while (!this.eof() && !stop()) {
      const g = this.tryGap();
      if (g) {
        out.push(g);
        continue;
      }
      if (stop()) break;
      const st = this.parseStatement(stop);
      if (!st) break;
      out.push(st);
    }
    return out;
  }

  tryGap(): TopLevel | null {
    if (!this.at("NEWLINE")) return null;
    const start = this.idx;
    while (this.at("NEWLINE")) this.eat();
    const end = this.idx - 1;
    return { kind: "Gap", tok: { start, end } };
  }

  parseStatement(stop: () => boolean): Statement | null {
    if (this.eof() || stop()) return null;

    const t = this.peek();
    if (t.kind === "PLUSPLUS" || t.kind === "MINUSMINUS") {
      return this.parseMut();
    }
    if (t.kind === "IDENT") {
      const u = upper(t.lexeme);
      if (t.lexeme === "VAR_INT" || t.lexeme === "VAR_FLOAT" || t.lexeme === "LVAR_INT" || t.lexeme === "LVAR_FLOAT") {
        return this.parseVarDecl(t.lexeme);
      }
      if (t.lexeme === "SCRIPT_NAME") return this.parseScriptName();
      if (t.lexeme === "MISSION_START" || t.lexeme === "MISSION_END") return this.parseMission();
      if (u === "IF") return this.parseIf(stop);
      if (u === "WHILE") return this.parseWhile(stop);
      if (u === "REPEAT") return this.parseRepeat(stop);
      if (u === "ELSE" || u === "ENDIF" || u === "ENDWHILE" || u === "ENDREPEAT") return null;
      if (u === "GOTO") return this.parseGoto();
      if (u === "GOSUB") return this.parseGosub();
      if (t.lexeme === "GOSUB_FILE") return this.parseGosubFile();
      if (u === "RETURN") return this.parseReturn();
      if (t.lexeme === "TERMINATE_THIS_SCRIPT") return this.parseTerminate();
      if (t.lexeme === "START_NEW_SCRIPT") return this.parseStartNewScript();
      if (t.lexeme === "LAUNCH_MISSION") return this.parseLaunchMission();
      if (t.lexeme === "LOAD_AND_LAUNCH_MISSION") return this.parseLoadLaunchMission();
      if (this.isLabelAhead()) {
        return this.parseLabel();
      }
      return this.parseAssignmentOrCommand();
    }
    if (t.kind === "LBRACE") return this.parseBlockBrace("OPEN");
    if (t.kind === "RBRACE") return this.parseBlockBrace("CLOSE");
    if (t.kind === "NEWLINE") {
      return null;
    }
    throw new Error(`Unexpected token ${t.kind} at ${this.idx}`);
  }

  isLabelAhead(): boolean {
    if (this.peek().kind !== "IDENT") return false;
    let j = this.idx + 1;
    while (this.tokens[j]?.kind === "DOT" && this.tokens[j + 1]?.kind === "IDENT") {
      j += 2;
    }
    while (this.tokens[j]?.kind === "NEWLINE") j++;
    return this.tokens[j]?.kind === "COLON";
  }

  parseBlockBrace(which: "OPEN" | "CLOSE"): Statement {
    const start = this.idx;
    this.eat();
    return { kind: "Block", kindBrace: which, tok: refOne(start) };
  }

  parseVarDecl(raw: string): Statement {
    const start = this.idx;
    this.eat();
    const kindMap: Record<string, VarDeclKind> = {
      VAR_INT: "VAR_INT",
      VAR_FLOAT: "VAR_FLOAT",
      LVAR_INT: "LVAR_INT",
      LVAR_FLOAT: "LVAR_FLOAT",
    };
    const varKind = kindMap[upper(raw)]!;
    const names = this.parseNameList();
    this.consumeLineEnd();
    return { kind: "VarDecl", varKind, names, tok: { start, end: this.idx - 1 } };
  }

  parseNameList(): string[] {
    const names: string[] = [];
    while (this.peek().kind === "IDENT") {
      names.push(this.eat().lexeme);
      if (this.at("COMMA")) {
        this.eat();
        continue;
      }
      if (this.at("NEWLINE") || this.eof()) break;
      if (this.peek().kind === "IDENT") continue;
      break;
    }
    return names;
  }

  parseScriptName(): Statement {
    const start = this.idx;
    this.eat();
    while (this.at("NEWLINE")) this.eat();
    const nm = this.expectIdentLexeme();
    this.consumeLineEnd();
    return { kind: "ScriptName", name: nm, tok: { start, end: this.idx - 1 } };
  }

  parseMission(): Statement {
    const start = this.idx;
    const id = this.eat();
    const u = upper(id.lexeme);
    this.consumeLineEnd();
    return {
      kind: "MissionBoundary",
      which: u === "MISSION_START" ? "START" : "END",
      tok: { start, end: this.idx - 1 },
    };
  }

  parseLabel(): Statement {
    const start = this.idx;
    const name = this.readDottedName();
    if (!this.at("COLON")) throw new Error("label :");
    this.eat();
    this.consumeLineEnd();
    return { kind: "Label", name, tok: { start, end: this.idx - 1 } };
  }

  parseMut(): Statement {
    const start = this.idx;
    const op = this.eat().lexeme as "++" | "--";
    while (this.at("NEWLINE")) this.eat();
    const target = this.readDottedName();
    this.consumeLineEnd();
    return { kind: "Mut", op, target, postfix: false, tok: { start, end: this.idx - 1 } };
  }

  parseGoto(): Statement {
    const start = this.idx;
    this.eat();
    while (this.at("NEWLINE")) this.eat();
    const label = this.expectIdentLexeme();
    this.consumeLineEnd();
    return { kind: "Goto", label, tok: { start, end: this.idx - 1 } };
  }

  parseGosub(): Statement {
    const start = this.idx;
    this.eat();
    while (this.at("NEWLINE")) this.eat();
    const label = this.expectIdentLexeme();
    this.consumeLineEnd();
    return { kind: "Gosub", label, tok: { start, end: this.idx - 1 } };
  }

  readDottedName(): string {
    let name = this.expectIdentLexeme();
    while (this.at("DOT")) {
      this.eat();
      name += "." + this.expectIdentLexeme();
    }
    return name;
  }

  parseGosubFile(): Statement {
    const start = this.idx;
    this.eat();
    while (this.at("NEWLINE")) this.eat();
    const alias = this.expectIdentLexeme();
    while (this.at("NEWLINE")) this.eat();
    const path =
      this.peek().kind === "STRING" ? this.eat().lexeme : this.readDottedName();
    this.consumeLineEnd();
    return { kind: "GosubFile", alias, path, tok: { start, end: this.idx - 1 } };
  }

  parseReturn(): Statement {
    const start = this.idx;
    this.eat();
    this.consumeLineEnd();
    return { kind: "Return", tok: { start, end: this.idx - 1 } };
  }

  parseTerminate(): Statement {
    const start = this.idx;
    this.eat();
    this.consumeLineEnd();
    return { kind: "Terminate", tok: { start, end: this.idx - 1 } };
  }

  parseStartNewScript(): Statement {
    const start = this.idx;
    this.eat();
    while (this.at("NEWLINE")) this.eat();
    const label = this.expectIdentLexeme();
    const args: RawArg[] = [];
    // Parse variadic arguments until end of line
    while (!this.at("NEWLINE") && !this.eof()) {
      if (this.at("COMMA")) {
        this.eat();
        continue;
      }
      args.push(this.parseRawArg());
    }
    this.consumeLineEnd();
    return { kind: "StartNewScript", label, args, tok: { start, end: this.idx - 1 } };
  }

  parseLaunchMission(): Statement {
    const start = this.idx;
    this.eat();
    while (this.at("NEWLINE")) this.eat();
    const path = this.peek().kind === "STRING" ? this.eat().lexeme : this.readDottedName();
    this.consumeLineEnd();
    return { kind: "LaunchMission", path, tok: { start, end: this.idx - 1 } };
  }

  parseLoadLaunchMission(): Statement {
    const start = this.idx;
    this.eat();
    while (this.at("NEWLINE")) this.eat();
    const path = this.peek().kind === "STRING" ? this.eat().lexeme : this.readDottedName();
    this.consumeLineEnd();
    return { kind: "LoadLaunchMission", path, tok: { start, end: this.idx - 1 } };
  }

  parseIf(stop: () => boolean): Statement {
    const start = this.idx;
    this.eat();
    const clauses = this.parseConditionClauses();
    const thenStmts = this.parseTopLevel(() => {
      const u = this.identUpper();
      return u === "ELSE" || u === "ENDIF";
    });
    let elseStmts: TopLevel[] | undefined;
    if (this.identUpper() === "ELSE") {
      this.eat();
      this.consumeLineEnd();
      elseStmts = this.parseTopLevel(() => this.identUpper() === "ENDIF");
    }
    if (this.identUpper() !== "ENDIF") {
      throw new Error(`Expected ENDIF, got ${this.peek().lexeme} at ${this.idx}`);
    }
    this.eat();
    this.consumeLineEnd();
    return {
      kind: "If",
      clauses,
      thenStmts: flattenStmts(thenStmts),
      elseStmts: elseStmts ? flattenStmts(elseStmts) : undefined,
      tok: { start, end: this.idx - 1 },
    };
  }

  parseWhile(_stop: () => boolean): Statement {
    const start = this.idx;
    this.eat();
    const clauses = this.parseConditionClauses();
    const body = this.parseTopLevel(() => this.identUpper() === "ENDWHILE");
    if (this.identUpper() !== "ENDWHILE") throw new Error("ENDWHILE");
    this.eat();
    this.consumeLineEnd();
    return {
      kind: "While",
      clauses,
      body: flattenStmts(body),
      tok: { start, end: this.idx - 1 },
    };
  }

  parseRepeat(_stop: () => boolean): Statement {
    const start = this.idx;
    this.eat();
    while (this.at("NEWLINE")) this.eat();
    const count = this.parseAtomExpr();
    while (this.at("NEWLINE")) this.eat();
    const counterVar = this.expectIdentLexeme();
    this.consumeLineEnd();
    const body = this.parseTopLevel(() => this.identUpper() === "ENDREPEAT");
    if (this.identUpper() !== "ENDREPEAT") throw new Error("ENDREPEAT");
    this.eat();
    this.consumeLineEnd();
    return {
      kind: "Repeat",
      count,
      counterVar,
      body: flattenStmts(body),
      tok: { start, end: this.idx - 1 },
    };
  }

  parseConditionClauses(): CondClause[] {
    const clauses: CondClause[] = [];
    let join: "AND" | "OR" | undefined;
    while (true) {
      while (this.at("NEWLINE")) this.eat();

      let not = false;
      while (this.peek().kind === "IDENT" && upper(this.peek().lexeme) === "NOT") {
        this.eat();
        not = !not;
        while (this.at("NEWLINE")) this.eat();
      }

      // Allow `WHILE NOT` headers whose first real predicate is written on
      // the next line prefixed by OR/AND.
      const marker = this.identUpper();
      if ((marker === "AND" || marker === "OR") && clauses.length === 0) {
        this.eat();
        while (this.at("NEWLINE")) this.eat();
        continue;
      }

      const cstart = this.idx;
      const pred = this.parsePredicateLine();
      clauses.push({ join, not, pred, tok: { start: cstart, end: this.idx - 1 } });
      let scan = this.idx;
      while (this.tokens[scan]?.kind === "NEWLINE") scan++;
      const next = this.tokens[scan];
      const id = next?.kind === "IDENT" ? upper(next.lexeme) : null;
      if (id === "AND" || id === "OR") {
        while (this.idx < scan) this.eat();
        join = id;
        this.eat();
        while (this.at("NEWLINE")) this.eat();
        continue;
      }
      break;
    }
    return clauses;
  }

  parsePredicateLine(): Predicate {
    const start = this.idx;
    const lhs = this.parseAtomForExpr();
    if (this.isCmp(this.peek().kind)) {
      const cmp = this.parseCmp();
      const rhs = this.parseExprLine();
      this.consumeLineEnd();
      return {
        kind: "Compare",
        left: lhs,
        cmp,
        right: rhs,
        tok: { start, end: this.idx - 1 },
      };
    }
    if (lhs.kind !== "Atom" || lhs.atom.kind !== "ident") {
      throw new Error("Expected command or compare");
    }
    const args: RawArg[] = [];
    while (!this.at("NEWLINE") && !this.eof()) {
      if (this.at("COMMA")) {
        this.eat();
        continue;
      }
      args.push(this.parseRawArg());
    }
    this.consumeLineEnd();
    return { kind: "Invoke", name: lhs.atom.name, args, tok: { start, end: this.idx - 1 } };
  }

  isCmp(k: TokenKind): boolean {
    return k === "EQ" || k === "EQEQ" || k === "NE" || k === "LT" || k === "GT" || k === "LTE" || k === "GTE";
  }

  parseCmp(): CmpOp {
    const k = this.eat().kind;
    const m2: Partial<Record<TokenKind, CmpOp>> = {
      EQ: "=",
      EQEQ: "==",
      NE: "<>",
      LT: "<",
      GT: ">",
      LTE: "<=",
      GTE: ">=",
    };
    const o = m2[k];
    if (!o) throw new Error(`cmp ${k}`);
    return o;
  }

  parseExprLine(): Expr {
    return this.parseExpr();
  }

  parseExpr(): Expr {
    return this.parseAddSub();
  }

  parseAddSub(): Expr {
    let left = this.parseMulDiv();
    while (this.at("PLUS") || this.at("MINUS") || this.at("PLUS_AT") || this.at("MINUS_AT")) {
      const op = this.eat().lexeme as "+" | "-" | "+@" | "-@";
      const right = this.parseMulDiv();
      const tok = mergeRefRange(left.tok, right.tok);
      left = { kind: "Binary", left, op, right, tok };
    }
    return left;
  }

  parseMulDiv(): Expr {
    let left = this.parseUnary();
    while (this.at("STAR") || this.at("SLASH")) {
      const op = this.eat().lexeme as "*" | "/";
      const right = this.parseUnary();
      const tok = mergeRefRange(left.tok, right.tok);
      left = { kind: "Binary", left, op, right, tok };
    }
    return left;
  }

  parseUnary(): Expr {
    if (this.at("MINUS")) {
      const start = this.idx;
      this.eat();
      const inner = this.parseUnary();
      return { kind: "UnaryMinus", inner, tok: { start, end: inner.tok.end } };
    }
    return this.parsePrimary();
  }

  parsePrimary(): Expr {
    return this.parseAtomForExpr();
  }

  parseAtomForExpr(): Expr {
    if (this.at("MINUS")) {
      return this.parseUnary();
    }
    if (this.at("IDENT")) {
      const t = refOne(this.idx);
      const name = this.eat().lexeme;
      const atom: AtomExpr = { kind: "ident", name, tok: t };
      return { kind: "Atom", atom, tok: t };
    }
    if (this.at("NUMBER")) {
      const t = refOne(this.idx);
      const raw = this.eat().lexeme;
      return { kind: "Atom", atom: { kind: "number", raw, tok: t }, tok: t };
    }
    if (this.at("STRING")) {
      const t = refOne(this.idx);
      const raw = this.eat().lexeme;
      return { kind: "Atom", atom: { kind: "string", raw, tok: t }, tok: t };
    }
    if (this.at("LPAREN")) {
      const atom = this.parseParenLabelAtom();
      return { kind: "Atom", atom, tok: atom.tok };
    }
    throw new Error(`Bad expr ${this.peek().kind}@${this.idx}`);
  }

  parseAtomExpr(): AtomExpr {
    const e = this.parseAtomForExpr();
    if (e.kind !== "Atom") throw new Error("atom expected");
    return e.atom;
  }

  parseParenLabelAtom(): AtomExpr {
    const start = this.idx;
    this.eat();
    while (this.at("NEWLINE")) this.eat();
    const inner = this.expectIdentLexeme();
    while (this.at("NEWLINE")) this.eat();
    if (!this.at("RPAREN")) throw new Error(")");
    const end = this.idx;
    this.eat();
    return { kind: "parenLabel", inner, tok: { start, end } };
  }

  parseParenGroupRaw(): RawArg {
    const start = this.idx;
    if (!this.at("LPAREN")) throw new Error("(");
    let depth = 0;
    while (true) {
      const k = this.peek().kind;
      if (k === "EOF") throw new Error("Unclosed (");
      if (k === "LPAREN") depth++;
      else if (k === "RPAREN") depth--;
      this.eat();
      if (depth === 0) break;
    }
    return { kind: "parenGroup", tok: { start, end: this.idx - 1 } };
  }

  /**
   * `( GXT_KEY )` / `( LM3_1A )` in command args — a single text-label id, same as in expressions.
   * Otherwise returns null so caller can use {@link parseParenGroupRaw} for real grouped args.
   */
  tryParseParenLabelRaw(): RawArg | null {
    const start = this.idx;
    if (!this.at("LPAREN")) return null;
    this.eat();
    while (this.at("NEWLINE")) this.eat();
    if (!this.at("IDENT")) {
      this.idx = start;
      return null;
    }
    const inner = this.eat().lexeme;
    while (this.at("NEWLINE")) this.eat();
    if (!this.at("RPAREN")) {
      this.idx = start;
      return null;
    }
    const end = this.idx;
    this.eat();
    return { kind: "parenLabel", inner, tok: { start, end } };
  }

  parseRawArg(): RawArg {
    const start = this.idx;
    if (this.at("MINUS")) {
      const m = this.eat();
      if (this.at("NUMBER")) {
        const n = this.eat();
        return { kind: "number", raw: m.lexeme + n.lexeme, tok: { start, end: this.idx - 1 } };
      }
      return { kind: "operator", op: m.lexeme, tok: { start, end: start } };
    }
    if (this.at("IDENT")) {
      const name = this.readDottedName();
      return { kind: "ident", name, tok: { start, end: this.idx - 1 } };
    }
    if (this.at("NUMBER")) {
      const t = refOne(this.idx);
      return { kind: "number", raw: this.eat().lexeme, tok: t };
    }
    if (this.at("STRING")) {
      const t = refOne(this.idx);
      return { kind: "string", raw: this.eat().lexeme, tok: t };
    }
    if (this.at("LPAREN")) {
      const label = this.tryParseParenLabelRaw();
      if (label) return label;
      return this.parseParenGroupRaw();
    }
    if (
      this.at("EQEQ") ||
      this.at("EQ") ||
      this.at("NE") ||
      this.at("LT") ||
      this.at("GT") ||
      this.at("LTE") ||
      this.at("GTE")
    ) {
      const op = this.eat().lexeme;
      return { kind: "operator", op, tok: { start, end: this.idx - 1 } };
    }
    throw new Error(`Bad arg ${this.peek().kind}`);
  }

  parseAssignmentOrCommand(): Statement {
    const start = this.idx;
    const name = this.readDottedName();
    const op = this.assignOpAhead();
    if (op) {
      this.eatOp(op);
      let rhs = this.parseExprLine();
      // Normalize malformed compact decimals found in corpus, e.g. `32.5.8`.
      // Lexer tokenizes this as NUMBER("32.5") NUMBER(".8") with no trivia.
      // Treat the dotted suffix as a continuation of the same numeric literal.
      if (rhs.kind === "Atom" && rhs.atom.kind === "number") {
        let atom = rhs.atom;
        let end = rhs.tok.end;
        while (
          this.at("NUMBER") &&
          this.peek().lexeme.startsWith(".") &&
          this.peek().leadingTrivia.length === 0
        ) {
          const suffix = this.eat();
          atom = {
            ...atom,
            raw: atom.raw + suffix.lexeme.slice(1),
            tok: { start: atom.tok.start, end: this.idx - 1 },
          };
          end = this.idx - 1;
        }
        rhs = { kind: "Atom", atom, tok: { start: rhs.tok.start, end } };
      }
      this.consumeLineEnd();
      return { kind: "Assignment", target: name, op, rhs, tok: { start, end: this.idx - 1 } };
    }
    if (this.at("PLUSPLUS") || this.at("MINUSMINUS")) {
      const mutOp = this.eat().lexeme as "++" | "--";
      this.consumeLineEnd();
      return {
        kind: "Mut",
        op: mutOp,
        target: name,
        postfix: true,
        tok: { start, end: this.idx - 1 },
      };
    }
    this.idx = start;
    const cmdStart = this.idx;
    const cmdName = this.expectIdentLexeme();
    const args: RawArg[] = [];
    while (!this.at("NEWLINE") && !this.eof()) {
      if (this.at("COMMA")) {
        this.eat();
        continue;
      }
      args.push(this.parseRawArg());
    }
    this.consumeLineEnd();
    return { kind: "Command", name: cmdName, args, tok: { start: cmdStart, end: this.idx - 1 } };
  }

  assignOpAhead(): "=" | "+=" | "-=" | "*=" | "/=" | "+=@" | "-=@" | "=#" | null {
    let j = this.idx;
    while (this.tokens[j]?.kind === "NEWLINE") j++;
    const k = this.tokens[j]?.kind;
    if (k === "EQ") return "=";
    if (k === "PLUS_EQ_AT") return "+=@";
    if (k === "MINUS_EQ_AT") return "-=@";
    if (k === "PLUS_EQ") return "+=";
    if (k === "MINUS_EQ") return "-=";
    if (k === "STAR_EQ") return "*=";
    if (k === "SLASH_EQ") return "/=";
    if (k === "EQ_HASH") return "=#";
    return null;
  }

  eatOp(op: string): void {
    while (this.at("NEWLINE")) this.eat();
    const expect: Record<string, TokenKind> = {
      "=": "EQ",
      "+=@": "PLUS_EQ_AT",
      "-=@": "MINUS_EQ_AT",
      "+=": "PLUS_EQ",
      "-=": "MINUS_EQ",
      "*=": "STAR_EQ",
      "/=": "SLASH_EQ",
      "=#": "EQ_HASH",
    };
    if (this.peek().kind !== expect[op]!) throw new Error(`op ${op}`);
    this.eat();
  }

  expectIdentLexeme(): string {
    if (this.peek().kind !== "IDENT") throw new Error("ident");
    return this.eat().lexeme;
  }

  consumeLineEnd(): void {
    if (this.at("NEWLINE")) this.eat();
  }
}

function flattenStmts(xs: TopLevel[]): Statement[] {
  const o: Statement[] = [];
  let pendingGapStart: number | null = null;
  let pendingGapEnd: number | null = null;
  for (const x of xs) {
    if (x.kind === "Gap") {
      if (pendingGapStart === null) pendingGapStart = x.tok.start;
      pendingGapEnd = x.tok.end;
      continue;
    }
    let st: Statement = x;
    if (pendingGapStart !== null) {
      st = { ...st, tok: { start: pendingGapStart, end: st.tok.end } };
      pendingGapStart = null;
      pendingGapEnd = null;
    }
    o.push(st);
  }
  if (pendingGapEnd !== null && o.length > 0) {
    const last = o[o.length - 1]!;
    o[o.length - 1] = { ...last, tok: { start: last.tok.start, end: pendingGapEnd } };
  }
  return o;
}

export function parseSource(source: string): SourceFile {
  const tokens = lex(source);
  const p = new Parser(tokens);
  return p.parseFile();
}

export function roundtripSource(source: string): string {
  return tokensToSource(lex(source));
}
