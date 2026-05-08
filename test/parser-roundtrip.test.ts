import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { lex } from "../src/lex.ts";
import { tokensToSource, parseSource } from "../src/parse.ts";

function collectScFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...collectScFiles(p));
    else if (e.name.endsWith(".sc")) out.push(p);
  }
  return out;
}

const gtaRoot = path.join(import.meta.dir, "..", "GTA_III_SCRIPT-master");
const corpus = fs.existsSync(gtaRoot) ? collectScFiles(gtaRoot) : [];

describe("lossless lexer roundtrip (L0)", () => {
  test("all GTA_III_SCRIPT-master .sc files byte-match after lex", () => {
    expect(corpus.length).toBeGreaterThan(0);
    for (const f of corpus) {
      const src = fs.readFileSync(f, "utf8");
      expect(tokensToSource(lex(src))).toBe(src);
    }
  });
});

describe("parser smoke", () => {
  test("parseSource succeeds on full corpus", () => {
    for (const f of corpus) {
      const src = fs.readFileSync(f, "utf8");
      expect(() => parseSource(src)).not.toThrow();
    }
  });
});
