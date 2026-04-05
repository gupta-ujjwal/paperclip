import { describe, expect, it } from "vitest";
import {
  TASK_ISSUE_OUTPUT_STATUSES,
  taskIssueOutputSchema,
} from "./task-output.js";

describe("taskIssueOutputSchema", () => {
  it("accepts a minimal valid payload", () => {
    const parsed = taskIssueOutputSchema.parse({
      summary: "implemented the login form",
      status: "completed",
    });
    expect(parsed.status).toBe("completed");
    expect(parsed.artifacts).toEqual([]);
    expect(parsed.gitRefs).toEqual([]);
  });

  it("accepts a fully populated payload", () => {
    const parsed = taskIssueOutputSchema.parse({
      summary: "wired escalation protocol",
      status: "partial",
      artifacts: [
        { kind: "file", path: "src/escalation.ts", description: "new module" },
        { kind: "doc", path: ".paperclip/notes.md" },
      ],
      gitRefs: [
        { repo: "main-repo", branch: "task/1/sde2-abc", commits: "a1b2c3d" },
      ],
      findings: "needs follow-up on timeout handling",
      telemetry: {
        agentId: "11111111-1111-1111-1111-111111111111",
        tokensIn: 1200,
        tokensOut: 340,
        costCents: 42,
      },
    });
    expect(parsed.artifacts).toHaveLength(2);
    expect(parsed.gitRefs[0]!.repo).toBe("main-repo");
  });

  it("rejects an unknown status", () => {
    expect(() =>
      taskIssueOutputSchema.parse({ summary: "x", status: "done" }),
    ).toThrow();
  });

  it("rejects an empty summary", () => {
    expect(() =>
      taskIssueOutputSchema.parse({ summary: "", status: "completed" }),
    ).toThrow();
  });

  it("exposes all four statuses", () => {
    expect(TASK_ISSUE_OUTPUT_STATUSES).toEqual([
      "completed",
      "partial",
      "blocked",
      "abandoned",
    ]);
  });
});
