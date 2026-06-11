import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { emitFileJs } from "../src/emit.ts";
import { parseSource } from "../src/parse.ts";
import { lowerSourceFile } from "../src/lower.ts";
import type { Statement, TopLevel } from "../src/cst.ts";
import { ProjectScope } from "../src/scope.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function countCommandsInBody(body: TopLevel[]): number {
  let n = 0;
  const walk = (st: Statement) => {
    if (st.kind === "Command") n++;
    switch (st.kind) {
      case "If":
        for (const x of st.thenStmts) walk(x);
        if (st.elseStmts) for (const x of st.elseStmts) walk(x);
        break;
      case "While":
        for (const x of st.body) walk(x);
        break;
      case "Repeat":
        for (const x of st.body) walk(x);
        break;
      default:
        break;
    }
  };
  for (const t of body) {
    if (t.kind !== "Gap") walk(t);
  }
  return n;
}

describe("emit L2 fixtures", () => {
  test("control-flow, gta3 conditions, goto, terminate", () => {
    const scope = new ProjectScope();
    scope.globalSlots.set("counter", 10);
    const src = fs.readFileSync(path.join(repoRoot, "test/fixtures/controlflow.sc"), "utf8");
    const { text } = emitFileJs("controlflow.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).toContain("if ($.counter > 0)");
    expect(text).not.toContain("import { car, ped, hier }");
    expect(text).toContain("while (!($.counter > 10))");
    expect(text).toContain("Streaming.HasModelLoaded(");
    expect(text).toContain("for (let i = 0; i < 3; i++)");
    expect(text).toContain("// SCM GOTO");
    expect(text).toContain("unresolved GOTO after_skip");
    expect(text).toContain("async function after_skip()");
    expect(text).toContain("return; // TERMINATE_THIS_SCRIPT");
  });

  test("emits shared vars import instead of local SCM.bind block", () => {
    const scope = new ProjectScope();
    scope.globalSlots.set("g_ped", 42);
    const src = fs.readFileSync(path.join(repoRoot, "test/fixtures/bind-ctor.sc"), "utf8");
    const { text } = emitFileJs("bind-ctor.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).toContain('import { $ } from "./utils/vars.mts";');
    expect(text).not.toContain("SCM.bind(");
    expect(text).toContain("$.g_ped = Char.Create(");
    expect(text).toContain("Char.Create(");
    expect(text).toContain("6 /* PEDTYPE_COP */");
  });

  test("GXT parenthesized key in PRINT_HELP emits quoted string", () => {
    const scope = new ProjectScope();
    const src = `SCRIPT_NAME t

PRINT_HELP ( LM3_1A )
`;
    const { text } = emitFileJs("t.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).toContain('Text.PrintHelp("LM3_1A")');
    expect(text).not.toContain("( LM3_1A )");
  });

  test("zone_key arguments are emitted as quoted string literals", () => {
    const scope = new ProjectScope();
    const src = `SCRIPT_NAME z
SETUP_ZONE_PED_INFO CITYZON DAY (12) 0 0 0 0 0 0 0 20
`;
    const { text } = emitFileJs("z.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).toContain('Zone.SetPedInfo("CITYZON", 1 /* DAY */, 12, 0, 0, 0, 0, 0, 0, 0, 20)');
    expect(text).not.toContain("(12)");
    expect(text).not.toContain("(0 0 0 0)");
  });

  test("does not import enums in generated output", () => {
    const scope = new ProjectScope();
    const src = "SCRIPT_NAME t\n";
    const { text } = emitFileJs("t.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).not.toContain("from \"./enums.ts\"");
  });

  test("emits instance methods in lowercase", () => {
    const scope = new ProjectScope();
    const src = `SCRIPT_NAME t
VAR_INT wanted_info
REMOVE_PICKUP wanted_info
`;
    const { text } = emitFileJs("t.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).toContain("wanted_info.remove();");
    expect(text).not.toContain("wanted_info.Remove();");
  });

  test("emits bool-typed arguments as booleans", () => {
    const scope = new ProjectScope();
    const src = `SCRIPT_NAME t
SET_PLAYER_CONTROL Player OFF
SET_PLAYER_CONTROL Player 1
`;
    const { text } = emitFileJs("t.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).toContain("setControl(false /* OFF */);");
    expect(text).toContain("setControl(true);");
    expect(text).not.toContain("setControl(0");
  });

  test("emits model_object arguments as ids with source-name comment", () => {
    const scope = new ProjectScope();
    const src = `SCRIPT_NAME t
VAR_INT obj
CREATE_OBJECT door_bombshop 0 0 0 obj
`;
    const { text } = emitFileJs("t.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).toContain("Object.Create(2102 /* door_bombshop */, 0, 0, 0)");
  });

  test("keeps section comments between commands and inline comment on command line", () => {
    const scope = new ProjectScope();
    const src = `SCRIPT_NAME t
SET_ROTATING_GARAGE_DOOR escort_garage

// ************************************Industrial Crane Positions***************************

ACTIVATE_MILITARY_CRANE 1 2 3 4 5 6 7 8 9 10 //Docks crane for the Police cars onto boat height for area 10.8
`;
    const { text } = emitFileJs("t.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).toMatch(/escort_garage\.setRotatingDoor\(\);\s*\n\s*\n\s*\/\/ \*{4,}Industrial Crane Positions/);
    expect(text).toContain("Crane.ActivateMilitary(1, 2, 3, 4, 5, 6, 7, 8, 9, 10); //Docks crane for the Police cars onto boat height for area 10.8");
    expect(text).not.toContain("//Docks crane for the Police cars onto boat height for area 10.8\n  Crane.ActivateMilitary(");
  });

  test("preserves banner comments that trail non-command statements", () => {
    const scope = new ProjectScope();
    const src = `SCRIPT_NAME t
VAR_INT mission_trigger_wait_time
mission_trigger_wait_time = 250

// ***************************************Frankie 3 Warp Stuff******************************
// ******************************************DO NOT REMOVE!*********************************
VAR_INT flag_taken_money_off_fm3
`;
    const { text } = emitFileJs("t.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).toMatch(/mission_trigger_wait_time = 250;\s*\n\s*\n\s*\/\/ \*{4,}Frankie 3 Warp Stuff/);
    expect(text).toContain("// ******************************************DO NOT REMOVE!*********************************");
  });

  test("preserves standalone comments and blank lines inside control-flow blocks", () => {
    const scope = new ProjectScope();
    const src = `SCRIPT_NAME t
blob_help_loop:
{
WAIT 100
IF IS_PLAYER_PLAYING Player
	//CONTACT BLOB HELP MESSAGE

	IF IS_PLAYER_IN_AREA_ON_FOOT_3D player 895.3 -428.0 12.0 900.3 -423.2 18.0 FALSE
		PRINT_HELP ( HELP12 ) // Tells player about contact blobs
		TERMINATE_THIS_SCRIPT
	ENDIF
ENDIF
GOTO blob_help_loop
}
`;
    const { text } = emitFileJs("t.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).toContain("//CONTACT BLOB HELP MESSAGE");
    expect(text).toMatch(/\/\/CONTACT BLOB HELP MESSAGE\s*\n\s*\n\s*if \(/);
  });

  test("preserves multiline block-commented SCM code without translating or splitting markers", () => {
    const scope = new ProjectScope();
    const src = `SCRIPT_NAME t
VAR_INT playersdoor
IF IS_PLAYER_PLAYING Player
  /*
  WHILE NOT ROTATE_OBJECT playersdoor 210.0 10.0 FALSE
    WAIT 0
  ENDWHILE
  */
  WAIT 0
ENDIF
`;
    const { text } = emitFileJs("t.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).toMatch(/\/\*\s*\n\s*WHILE NOT ROTATE_OBJECT playersdoor 210\.0 10\.0 FALSE/);
    expect(text).toMatch(/ENDWHILE\s*\n\s*\*\//);
    expect(text).not.toContain("while (!($.playersdoor.rotate(210.0, 10.0, false /* FALSE */))) {");
  });

  test("rewrites HUD timer/counter display and clear to wrappers with xxx comments", () => {
    const scope = new ProjectScope();
    scope.globalSlots.set("timer_x", 10);
    scope.globalSlots.set("counter_x", 11);
    const src = `SCRIPT_NAME t
VAR_INT timer_x counter_x
timer_x = 120000
counter_x = 0
DISPLAY_ONSCREEN_TIMER timer_x
DISPLAY_ONSCREEN_COUNTER_WITH_STRING counter_x COUNTER_DISPLAY_NUMBER KILLS
counter_x += 1
IF counter_x > 0
  CLEAR_ONSCREEN_TIMER timer_x
  CLEAR_ONSCREEN_COUNTER counter_x
ENDIF
`;
    const { text } = emitFileJs("hud-wrap.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).toContain('import { $ } from "./utils/vars.mts";');
    expect(text).toContain("$.timer_x = 120000;");
    expect(text).toContain("$.counter_x = 0;");
    expect(text).toContain("Hud.DisplayTimer($.$id.timer_x);");
    expect(text).toContain('Hud.DisplayCounterWithString($.$id.counter_x, 0 /* COUNTER_DISPLAY_NUMBER */, "KILLS");');
    expect(text).toContain("$.counter_x += 1;");
    expect(text).toContain("if ($.counter_x > 0)");
    expect(text).toContain("Hud.ClearTimer($.$id.timer_x);");
    expect(text).toContain("Hud.ClearCounter($.$id.counter_x);");
  });

  test("sanitizes exported function names from file names", () => {
    const scope = new ProjectScope();
    const src = "SCRIPT_NAME 4x4_2\n";
    const { text } = emitFileJs("Main/Commercial/4x4_2.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).toContain("export async function _4x4_2()");
    expect(text).not.toContain("export async function 4x4_2()");
  });

  test("lowers trailing same-level self GOTO to endless loop", () => {
    const scope = new ProjectScope();
    const src = `SCRIPT_NAME t
loop:
WAIT 0
GOTO loop
`;
    const { text } = emitFileJs("loop.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).toContain("async function loop()");
    expect(text).toContain("while (true) {");
    expect(text).toContain("await asyncWait(0);");
    expect(text).not.toContain("unresolved GOTO loop");
  });

  test("lowers self GOTO to endless loop when only trailing block closes follow", () => {
    const scope = new ProjectScope();
    const src = `SCRIPT_NAME t
loop:
{
WAIT 0
GOTO loop
}
`;
    const { text } = emitFileJs("loop.sc", src, scope, repoRoot, repoRoot, false);
    expect(text).toContain("async function loop()");
    expect(text).toContain("while (true) {");
    expect(text).toContain("await asyncWait(0);");
    expect(text).not.toContain("unresolved GOTO loop");
  });
});

describe("L3 parse / lower sanity", () => {
  test("fixture opcode-shaped statements round-trip parse + lower", () => {
    const src = fs.readFileSync(path.join(repoRoot, "test/fixtures/controlflow.sc"), "utf8");
    let sf = parseSource(src);
    sf = lowerSourceFile(sf);
    const cmds = countCommandsInBody(sf.body);
    expect(cmds).toBeGreaterThanOrEqual(5);
    expect(sf.body.length).toBeGreaterThanOrEqual(10);
  });
});
