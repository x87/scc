import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { convertTree } from "../src/cli.ts";

describe("cli floatvars output", () => {
  test("wraps VAR_FLOAT variables with SCM.Float() in vars.mts", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sc-conv-floatvars-"));
    const repoRoot = path.join(tempRoot, "repo");
    const inputDir = path.join(repoRoot, "input");
    const outRoot = path.join(tempRoot, "out");

    fs.mkdirSync(path.join(repoRoot, "GTA_III_SCRIPT-master"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "GTA_III_SCRIPT-master", "main.sc"), "SCRIPT_NAME main\n");
    
    // Create a minimal vars.json for the test
    fs.mkdirSync(path.join(repoRoot, "gta3"), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, "gta3", "vars.json"),
      JSON.stringify({ alpha: 1, beta: 2, gamma: 3, some_int: 4 }, null, 2),
    );

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

    const varsMtsPath = path.join(outRoot, "utils", "vars.mts");
    expect(fs.existsSync(varsMtsPath)).toBe(true);
    const varsMtsContent = fs.readFileSync(varsMtsPath, "utf8");
    
    // Check that float variables are wrapped with SCM.Float()
    expect(varsMtsContent).toContain("alpha: SCM.Float(1)");
    expect(varsMtsContent).toContain("beta: SCM.Float(2)");
    expect(varsMtsContent).toContain("gamma: SCM.Float(3)");
    
    // Check that non-float variables are not wrapped
    expect(varsMtsContent).toContain("some_int: 4,");
    expect(varsMtsContent).not.toContain("some_int: SCM.Float(4)");

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
});
