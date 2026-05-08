import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export type EnumInfo = {
  members: Map<string, number>;
  valueToMember: Map<number, string>;
};

const ENUMS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "enums.ts");

// Cached string-valued enum maps: enumName -> (member -> stringValue)
let _enumStringMaps: Map<string, Map<string, string>> | undefined;

export function enumMemberStringValue(enumName: string, member: string): string | undefined {
  if (!_enumStringMaps) {
    _enumStringMaps = new Map<string, Map<string, string>>();
    const src = fs.readFileSync(ENUMS_PATH, "utf8");
    const enumRe = /export\s+enum\s+(\w+)\s*\{([\s\S]*?)\}/g;
    let m: RegExpExecArray | null;
    while ((m = enumRe.exec(src))) {
      const name = m[1]!;
      const body = m[2]!;
      const map = new Map<string, string>();
      const memRe = /"([^"]+)"\s*=\s*"([^"]+)"/g;
      let mm: RegExpExecArray | null;
      while ((mm = memRe.exec(body))) {
        map.set(mm[1]!, mm[2]!);
      }
      _enumStringMaps.set(name, map);
    }
  }
  const m = _enumStringMaps.get(enumName);
  if (!m) return undefined;
  if (m.has(member)) return m.get(member);
  // case-insensitive fallback
  const up = member.toUpperCase();
  for (const [k, v] of m.entries()) {
    if (k.toUpperCase() === up) return v;
  }
  return undefined;
}
