import { beforeEach, describe, expect, test } from "bun:test";
import {
  resolveModelName,
  isModelConstant,
  emitModelExpr,
  emitObjectModelLiteral,
} from "../src/models";
import { lookupCommand, getAllCommands } from "../src/gta3";
import { enumMemberStringValue } from "../src/enum-map";
import { activateConfig } from "./test-config.ts";
// ─── Model name resolution ──────────────────────────────────────────

describe("object model mapping", () => {
  beforeEach(() => {
    activateConfig("gta3");
  });

  test("emits object model literal with original name comment", () => {
    expect(emitObjectModelLiteral("door_bombshop")).toBe("2102 /* door_bombshop */");
  });

  test("switches model/enum metadata to vc config payload", () => {
    activateConfig("vc");
    expect(resolveModelName("REDLIGHT_PEDGRP")).toBeUndefined();
    expect(resolveModelName("TIMER_UP")).toBeDefined();
    expect(enumMemberStringValue("SfxMission", "A1_a")).toBeUndefined();
    expect(enumMemberStringValue("SfxMission", "Airhrnl")).toBe("airhrnl");
  });
});

// ─── gta3.json command lookup ───────────────────────────────────────

describe("lookupCommand", () => {
  test("basic command lookup", () => {
    const wait = lookupCommand("WAIT");
    expect(wait).toBeDefined();
    expect(wait!.id).toBe("0001");
    expect(wait!.name).toBe("WAIT");
    expect(wait!.num_params).toBe(1);
  });

  test("constructor command", () => {
    const create = lookupCommand("CREATE_CAR");
    expect(create).toBeDefined();
    expect(create!.class).toBe("Car");
    expect(create!.member).toBe("Create");
    expect(create!.attrs?.is_constructor).toBe(true);
    expect(create!.num_params).toBe(5);
  });

  test("destructor command", () => {
    const del = lookupCommand("DELETE_CHAR");
    expect(del).toBeDefined();
    expect(del!.class).toBe("Char");
    expect(del!.attrs?.is_destructor).toBe(true);
  });

  test("static command", () => {
    const shake = lookupCommand("SHAKE_CAM");
    expect(shake).toBeDefined();
    expect(shake!.class).toBe("Camera");
    expect(shake!.member).toBe("Shake");
    expect(shake!.attrs?.is_static).toBe(true);
  });

  test("operator command", () => {
    const add = lookupCommand("ADD_VAL_TO_INT_VAR");
    expect(add).toBeDefined();
    expect(add!.operator).toBe("+");
  });

  test("condition command", () => {
    const has = lookupCommand("HAS_MODEL_LOADED");
    expect(has).toBeDefined();
    expect(has!.attrs?.is_condition).toBe(true);
  });

  test("case-insensitive lookup", () => {
    expect(lookupCommand("wait")).toBeDefined();
    expect(lookupCommand("Wait")).toBeDefined();
    expect(lookupCommand("create_car")).toBeDefined();
  });

  test("unknown command returns undefined", () => {
    expect(lookupCommand("NOT_A_REAL_COMMAND")).toBeUndefined();
  });

  test("command with output params", () => {
    const create = lookupCommand("CREATE_CHAR");
    expect(create).toBeDefined();
    expect(create!.output).toBeDefined();
    expect(create!.output!.length).toBeGreaterThan(0);
    expect(create!.output![0].type).toBe("Char");
  });

  test("command input params include enum types", () => {
    const create = lookupCommand("CREATE_CHAR");
    expect(create).toBeDefined();
    const pedTypeParam = create!.input?.find((p) => p.type === "PedType");
    expect(pedTypeParam).toBeDefined();
  });
});

describe("getAllCommands", () => {
  test("returns many commands", () => {
    const all = getAllCommands();
    expect(all.length).toBeGreaterThan(100);
  });

  test("includes NOP as first command", () => {
    const all = getAllCommands();
    expect(all[0].name).toBe("NOP");
    expect(all[0].id).toBe("0000");
  });
});
