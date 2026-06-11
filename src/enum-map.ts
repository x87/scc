import { getActiveEnums } from "./config-entry.ts";

export type EnumInfo = {
  members: Map<string, number>;
  valueToMember: Map<number, string>;
};

export function enumMemberStringValue(enumName: string, member: string): string | undefined {
  const enumData = getActiveEnums()[enumName];
  if (!enumData) return undefined;
  
  const value = enumData[member];
  if (value !== undefined && typeof value === "string") return value;
  
  // case-insensitive fallback
  const up = member.toUpperCase();
  for (const [k, v] of Object.entries(enumData)) {
    if (k.toUpperCase() === up && typeof v === "string") return v;
  }
  return undefined;
}
