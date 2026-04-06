import { describe, expect, it } from "vitest";
import { resolveJoinRequestAgentManagerId } from "../routes/access.js";

describe("resolveJoinRequestAgentManagerId", () => {
  it("returns null when no PM exists in the company agent list", () => {
    const managerId = resolveJoinRequestAgentManagerId([
      { id: "a1", role: "em", reportsTo: null },
      { id: "a2", role: "sde2", reportsTo: "a1" },
    ]);

    expect(managerId).toBeNull();
  });

  it("selects the root PM when available", () => {
    const managerId = resolveJoinRequestAgentManagerId([
      { id: "pm-child", role: "pm", reportsTo: "manager-1" },
      { id: "manager-1", role: "em", reportsTo: null },
      { id: "pm-root", role: "pm", reportsTo: null },
    ]);

    expect(managerId).toBe("pm-root");
  });

  it("falls back to the first PM when no root PM is present", () => {
    const managerId = resolveJoinRequestAgentManagerId([
      { id: "pm-1", role: "pm", reportsTo: "mgr" },
      { id: "pm-2", role: "pm", reportsTo: "mgr" },
      { id: "mgr", role: "em", reportsTo: null },
    ]);

    expect(managerId).toBe("pm-1");
  });
});
