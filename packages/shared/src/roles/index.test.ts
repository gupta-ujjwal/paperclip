import { describe, expect, it } from "vitest";
import {
  TASK_ROLE_NAMES,
  getTaskRole,
  listTaskRoles,
  listLeafTaskRoles,
  listHiringTaskRoles,
  isTaskRoleName,
  type TaskRoleName,
} from "./index.js";

describe("task role library", () => {
  it("exposes all expected roles", () => {
    const expected: TaskRoleName[] = [
      "pm",
      "em",
      "product_manager",
      "program_manager",
      "research_analyst",
      "sde2",
      "sde1",
      "qa",
      "bd",
    ];
    expect(TASK_ROLE_NAMES.sort()).toEqual(expected.sort());
  });

  it("PM is the only role with no manager (reports to BD)", () => {
    const pm = getTaskRole("pm");
    expect(pm.default_reports_to_role).toBeNull();
    expect(pm.can_hire).toBe(true);
    expect(pm.is_leaf).toBe(false);
  });

  it("leaf roles cannot hire", () => {
    const leaves = listLeafTaskRoles();
    expect(leaves.length).toBeGreaterThan(0);
    for (const role of leaves) {
      expect(role.can_hire).toBe(false);
      expect(role.is_leaf).toBe(true);
    }
  });

  it("identifies SDE1, QA, Research Analyst as leaf roles", () => {
    const leafNames = new Set(listLeafTaskRoles().map((r) => r.name));
    expect(leafNames).toContain("sde1");
    expect(leafNames).toContain("qa");
    expect(leafNames).toContain("research_analyst");
  });

  it("SDE2 is not a leaf (can sub-delegate to SDE1)", () => {
    const sde2 = getTaskRole("sde2");
    expect(sde2.is_leaf).toBe(false);
    expect(sde2.can_hire).toBe(false);
  });

  it("hiring roles include PM, EM, Product Manager, Program Manager, BD", () => {
    const hirers = new Set(listHiringTaskRoles().map((r) => r.name));
    expect(hirers).toContain("pm");
    expect(hirers).toContain("em");
    expect(hirers).toContain("product_manager");
    expect(hirers).toContain("program_manager");
  });

  it("every non-PM role reports to another defined role", () => {
    for (const role of listTaskRoles()) {
      if (role.name === "pm") continue;
      expect(role.default_reports_to_role).not.toBeNull();
      const parent = role.default_reports_to_role as TaskRoleName;
      expect(TASK_ROLE_NAMES).toContain(parent);
    }
  });

  it("every role has ask_manager in its default tool set", () => {
    for (const role of listTaskRoles()) {
      expect(role.default_tools).toContain("ask_manager");
    }
  });

  it("every role has a non-empty system prompt", () => {
    for (const role of listTaskRoles()) {
      expect(role.system_prompt.length).toBeGreaterThan(20);
    }
  });

  it("isTaskRoleName validates correctly", () => {
    expect(isTaskRoleName("pm")).toBe(true);
    expect(isTaskRoleName("sde1")).toBe(true);
    expect(isTaskRoleName("ceo")).toBe(false);
    expect(isTaskRoleName("notarole")).toBe(false);
  });

  it("listTaskRoles returns stable array of all roles", () => {
    const all = listTaskRoles();
    expect(all.length).toBe(TASK_ROLE_NAMES.length);
    expect(new Set(all.map((r) => r.name)).size).toBe(all.length);
  });
});
