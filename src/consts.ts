import { getActiveConsts } from "./config-entry.ts";

export type ConstsIndex = Record<string, number>;

export function loadConstsIndex(): ConstsIndex {
  return getActiveConsts();
}
