import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { convertTree } from "../src/cli.ts";

describe("cli floatvars output", () => {
  test("writes deduplicated VAR_FLOAT names to floatvars.txt", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sc-conv-floatvars-"));
    const repoRoot = path.join(tempRoot, "repo");
    const inputDir = path.join(repoRoot, "input");
    const outRoot = path.join(tempRoot, "out");

    fs.mkdirSync(path.join(repoRoot, "GTA_III_SCRIPT-master"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "GTA_III_SCRIPT-master", "main.sc"), "SCRIPT_NAME main\n");

    fs.mkdirSync(path.join(inputDir, "sub"), { recursive: true });
    fs.writeFileSync(
      path.join(inputDir, "a.sc"),
      [
        "SCRIPT_NAME a",
        "VAR_FLOAT alpha, beta",
        "VAR_INT i",
        "",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(inputDir, "sub", "b.sc"),
      [
        "SCRIPT_NAME b",
        "VAR_FLOAT beta",
        "LVAR_FLOAT local_beta",
        "VAR_FLOAT gamma",
        "",
      ].join("\n"),
    );

    convertTree(repoRoot, inputDir, outRoot, false);

    const floatVarsPath = path.join(outRoot, "floatvars.txt");
    expect(fs.existsSync(floatVarsPath)).toBe(true);
    expect(fs.readFileSync(floatVarsPath, "utf8")).toBe("alpha\nbeta\ngamma\n");

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
});
