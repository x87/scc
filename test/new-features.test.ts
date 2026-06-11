import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { emitFileJs } from "../src/emit.ts";
import { parseSource } from "../src/parse.ts";
import { lex } from "../src/lex.ts";
import { ProjectScope } from "../src/scope.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("new emission features", () => {
  test("normalizes numeric literals with leading zeros", () => {
    const scope = new ProjectScope();
    const src = `SCRIPT_NAME t
SET_TIME_OF_DAY 00 36
`;
    const { text } = emitFileJs("t.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).toMatch(/SetTimeOfDay\(0,\s*36\)/);
  });

  test("emits timed helper for +=@ compound assignment", () => {
    const scope = new ProjectScope();
    scope.globalSlots.set("boat02_heading", 1);
    const src = `SCRIPT_NAME t
boat02_heading +=@ 1.0
`;
    const { text } = emitFileJs("t.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).toContain('import { timed } from "./utils/scm.mts";');
    expect(text).toContain("$.boat02_heading += timed(1.0);");
  });

  test("emits timed helper for -@ expression operator", () => {
    const scope = new ProjectScope();
    scope.globalSlots.set("targ2_y_bankjob2", 1);
    const src = `SCRIPT_NAME t
targ2_y_bankjob2 = targ2_y_bankjob2 -@ 0.04
`;
    const { text } = emitFileJs("t.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).toContain('import { timed } from "./utils/scm.mts";');
    expect(text).toContain("$.targ2_y_bankjob2 = $.targ2_y_bankjob2 - timed(0.04);");
  });

  test("wraps gxt_key arguments as quoted strings (KillFrenzy.Start)", () => {
    const scope = new ProjectScope();
    scope.globalSlots.set("rampage_16_kills", 1);
    const src = `SCRIPT_NAME t
START_KILL_FRENZY PAGE_00 8 120000 rampage_16_kills -2 -1 -1 -1 FALSE
`;
    const { text } = emitFileJs("t.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).toContain('KillFrenzy.Start("PAGE_00"');
  });

  test("destructuring multiple outputs from instance method uses temp and property names from gta3.json", () => {
    const scope = new ProjectScope();
    // mark targets as globals so ctx.ref yields $.name
    scope.globalSlots.set("a1_x", 1);
    scope.globalSlots.set("a1_y", 1);
    scope.globalSlots.set("a1_z", 1);
    const src = `SCRIPT_NAME t
GET_PLAYER_COORDINATES Player a1_x a1_y a1_z
`;
    const { text } = emitFileJs("t.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).toMatch(/const _res\d+ = .*getCoordinates\(/);
    expect(text).toMatch(/\$\.a1_x = _res\d+\.x;/);
    expect(text).toMatch(/\$\.a1_y = _res\d+\.y;/);
    expect(text).toMatch(/\$\.a1_z = _res\d+\.z;/);
  });

  test("emits SfxMission args as quoted string values", () => {
    const scope = new ProjectScope();
    const src = `SCRIPT_NAME t
LOAD_MISSION_AUDIO A1_a
`;
    const { text } = emitFileJs("t.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).toContain('Audio.LoadMissionAudio("a1_a" as any)');
  });

  test("`timera`, `timerb`, `onmission` globals are emitted UPPERCASE", () => {
    const scope = new ProjectScope();
    scope.globalSlots.set("timera", 1);
    scope.globalSlots.set("timerb", 2);
    scope.globalSlots.set("onmission", 3);
    const src = `SCRIPT_NAME t
timera = 5
timerb = timera
IF onmission == 1
  timerb = 2
ENDIF
`;
    const { text } = emitFileJs("t.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).toContain("$.TIMERA = 5;");
    expect(text).toContain("$.TIMERB = $.TIMERA;");
    expect(text).toContain("if (ONMISSION == 1)");
  });

  test("DECLARE_MISSION_FLAG aliases subsequent variable uses to ONMISSION", () => {
    const scope = new ProjectScope();
    scope.globalSlots.set("onmission", 3);
    scope.globalSlots.set("flag_player_on_mission", 4);
    const src = `SCRIPT_NAME t
DECLARE_MISSION_FLAG flag_player_on_mission
flag_player_on_mission = 0
IF flag_player_on_mission == 0
  flag_player_on_mission = 1
ENDIF
`;
    const { text } = emitFileJs("t.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).toContain("// DECLARE_MISSION_FLAG(ONMISSION);");
    expect(text).toContain("ONMISSION = 0;");
    expect(text).toContain("if (ONMISSION == 0)");
    expect(text).toContain("ONMISSION = 1;");
    expect(text).not.toContain("$.flag_player_on_mission");
  });

  test("mission prelude remaps body/onFailed/cleanup and lifts mission wall to file top", () => {
    const scope = new ProjectScope();
    const src = `MISSION_START
// *****************************************************************************************
// *********************************  Tiny Mission  ***************************************
// *****************************************************************************************

// Mission start stuff

GOSUB mission_start_tiny

IF HAS_DEATHARREST_BEEN_EXECUTED
  GOSUB mission_tiny_failed
ENDIF

GOSUB mission_cleanup_tiny

MISSION_END

mission_start_tiny:
WAIT 0
RETURN

mission_tiny_failed:
RETURN

mission_cleanup_tiny:
RETURN
`;
    const { text } = emitFileJs("tiny.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).toContain("async function body()");
    expect(text).toContain("async function onFailed()");
    expect(text).toContain("async function cleanup()");
    expect(text).not.toContain("async function mission_start_tiny()");
    expect(text).toContain("await body();");
    expect(text).toContain("await onFailed();");
    expect(text).toContain("await cleanup();");
    expect(text).toContain("// Mission start stuff");
    expect(text).not.toContain("MissionBoundary");
    expect(text.indexOf("Tiny Mission")).toBeGreaterThan(-1);
    expect(text.indexOf("Tiny Mission")).toBeLessThan(text.indexOf("async function body()"));
  });

  test("mission prelude without death-arrest branch maps only body + cleanup", () => {
    const scope = new ProjectScope();
    const src = `MISSION_START
GOSUB mission_start_hood1
GOSUB mission_cleanup_hood1
MISSION_END

mission_start_hood1:
WAIT 0
RETURN

mission_cleanup_hood1:
RETURN
`;
    const { text } = emitFileJs("hood1.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).toContain("async function body()");
    expect(text).toContain("async function cleanup()");
    expect(text).not.toContain("async function onFailed()");
    expect(text).toContain("await body();");
    expect(text).toContain("await cleanup();");
  });

  test("keeps inter-label mission comments outside the previous hoisted function scope", () => {
    const scope = new ProjectScope();
    const src = `MISSION_START
GOSUB mission_start_demo
IF HAS_DEATHARREST_BEEN_EXECUTED
  GOSUB mission_demo_failed
ENDIF
GOSUB mission_cleanup_demo
MISSION_END

mission_start_demo:
WAIT 0
RETURN

// Mission Demo failed
mission_demo_failed:
RETURN

mission_cleanup_demo:
RETURN
`;
    const { text } = emitFileJs("demo.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).toMatch(/}\n(?:\n)*\/\/ Mission Demo failed\n(?:\n)*async function onFailed\(\)/);
  });

  test("emits GOSUB await with inline SCM comment and without fallback note", () => {
    const scope = new ProjectScope();
    const src = `SCRIPT_NAME t
GOSUB chunk3_ambulance

chunk3_ambulance:
RETURN
`;
    const { text } = emitFileJs("t.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).toContain("await chunk3_ambulance();  // SCM GOSUB chunk3_ambulance");
    expect(text).not.toContain("fallback if label was not emitted as async function: no-op continues linearly");
    expect(text).not.toMatch(/\n\s*\/\/ SCM GOSUB chunk3_ambulance\s*\n\s*await chunk3_ambulance\(\);/);
  });

  test("drops terminal bare return at function tail", () => {
    const scope = new ProjectScope();
    const src = `SCRIPT_NAME t
RETURN
`;
    const { text } = emitFileJs("t.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).not.toContain("return;");
  });

  test("does not emit standalone SCM scope braces", () => {
    const scope = new ProjectScope();
    const src = `SCRIPT_NAME t
scope_loop:
{
WAIT 0
}
`;
    const { text } = emitFileJs("scope.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).toContain("await asyncWait(0);");
    expect(text).not.toMatch(/^  \{$/m);
    expect(text).not.toMatch(/^  \}$/m);
  });

  test("parses command arguments separated by commas", () => {
    const src = `SCRIPT_NAME t
SET_VISIBILITY_OF_CLOSEST_OBJECT_OF_TYPE -647.0, -1323.0, 19.9 100.0 LODcargoshp03 FALSE
`;
    expect(() => parseSource(src)).not.toThrow();
  });

  test("lexes nested block comments as trivia and normalizes inner markers in emission", () => {
    const scope = new ProjectScope();
    const src = `SCRIPT_NAME t
/* outer
  /* inner */
  keep
*/
WAIT 0
`;
    const toks = lex(src);
    const starSlashTokens = toks.filter((t) => t.kind === "STAR" || t.kind === "SLASH");
    expect(starSlashTokens.length).toBe(0);

    const { text } = emitFileJs("t.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).toContain("/* outer");
    expect(text).toContain("inner");
    expect(text).toContain("keep");
    expect(text).toContain("*/");
    expect(text).not.toContain("/* inner */");
  });

  test("normalizes malformed compact decimal literals in assignments", () => {
    const scope = new ProjectScope();
    scope.globalSlots.set("spray_taxi_subY", 1);
    const src = `SCRIPT_NAME t
spray_taxi_subY = 32.5.8
`;
    const { text } = emitFileJs("t.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).toContain("$.spray_taxi_subY = 32.58;");
  });

  test("parses multiline WHILE NOT header with OR-prefixed predicates", () => {
    const src = `SCRIPT_NAME t
WHILE NOT
OR NOT HAS_MODEL_LOADED COLT45
  WAIT 0
ENDWHILE
`;
    expect(() => parseSource(src)).not.toThrow();
  });
});
