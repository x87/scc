/** GTA3 .sc model id constants → CLEO Redux tagged template (car / ped / hier). */

import { getActiveConsts, getActiveObjs } from "./config-entry.ts";

export function resolveModelName(sc: string): string | number | undefined {
  let key = sc.toUpperCase();
  const consts = getActiveConsts();
  const objs = getActiveObjs();
  return consts[key] ?? objs[key] ?? undefined;
}

export function isModelConstant(name: string): boolean {
  return resolveModelName(name) !== undefined;
}

export function emitObjectModelLiteral(name: string): string | undefined {
  // const id = resolveObjectModelId(name);
  const id = resolveModelName(name);
  if (id === undefined) return undefined;
  return `${id} /* ${name} */`;
}

export function emitModelExpr(modelName: string): string {
  const r = resolveModelName(modelName);
  return JSON.stringify(r);
}
