/** GTA3 .sc model id constants → CLEO Redux tagged template (car / ped / hier). */

import objs from "../gta3/objs.json" with { type: "json" };
import consts from "../gta3/consts.json" with { type: "json" };

export function resolveModelName(sc: string): string | undefined {
  let key = sc.toUpperCase();
  return consts.constants[key] ?? objs[key] ?? undefined;
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
