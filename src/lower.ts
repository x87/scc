import type { SourceFile, Statement, TopLevel } from "./cst.ts";

/** Recursively normalize control-flow shapes for emit (If/While/Repeat bodies, nested blocks). */
export function lowerStatement(s: Statement): Statement {
  switch (s.kind) {
    case "If":
      return {
        ...s,
        thenStmts: s.thenStmts.map(lowerStatement),
        elseStmts: s.elseStmts?.map(lowerStatement),
      };
    case "While":
      return { ...s, body: s.body.map(lowerStatement) };
    case "Repeat":
      return { ...s, body: s.body.map(lowerStatement) };
    default:
      return s;
  }
}

export function lowerTopLevel(t: TopLevel): TopLevel {
  if (t.kind === "Gap") return t;
  return lowerStatement(t);
}

export function lowerSourceFile(sf: SourceFile): SourceFile {
  return { ...sf, body: sf.body.map(lowerTopLevel) };
}
