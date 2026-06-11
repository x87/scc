import type { Gta3Command } from "./gta3.ts";
import type { SourceFile, Statement, Expr } from "./cst.ts";
import { walkAllStatements } from "./scope.ts";

export type VarKind = "int" | "float" | "unknown" | { className: string };

/** Per-variable inferred types (globals + locals). */
export type TypeEnv = Map<string, VarKind>;

export function noteConstructorTarget(
  env: TypeEnv,
  targetVar: string | undefined,
  cmd: Gta3Command,
): void {
  if (!targetVar || !cmd.attrs?.is_constructor || !cmd.class) return;
  env.set(targetVar, { className: cmd.class });
}

export function propagateFromAssignment(env: TypeEnv, target: string, rhs: Expr): void {
  if (rhs.kind !== "Atom" || rhs.atom.kind !== "ident") return;
  const src = rhs.atom.name;
  const t = env.get(src);
  if (t) env.set(target, t);
}

export function collectTypeEnv(
  sf: SourceFile,
  defFor?: (name: string) => Gta3Command | undefined,
): TypeEnv {
  const env: TypeEnv = new Map();
  walkAllStatements(sf, (s: Statement) => {
    if (s.kind === "Command") {
      const def = defFor?.(s.name);
      if (!def?.attrs?.is_constructor || !def.output?.length) return;
      const last = s.args[s.args.length - 1];
      if (last?.kind === "ident") noteConstructorTarget(env, last.name, def);
      return;
    }
    if (s.kind === "Assignment") propagateFromAssignment(env, s.target, s.rhs);
  });
  return env;
}
