/**
 * Generic structured output format for task-mode issues.
 *
 * Every issue — regardless of assignee role — closes with one of these
 * payloads. Research, planning, coding, testing, and PM reports all share
 * this shape so the hiring manager can consume results uniformly.
 *
 * @see doc/task-mode-solution.md §8 — Issues & Output
 */

import { z } from "zod";

export const TASK_ISSUE_OUTPUT_STATUSES = [
  "completed",
  "partial",
  "blocked",
  "abandoned",
] as const;

export type TaskIssueOutputStatus = (typeof TASK_ISSUE_OUTPUT_STATUSES)[number];

export const taskIssueOutputArtifactSchema = z
  .object({
    /** Artifact kind: file, doc, commit, branch, url, report. */
    kind: z.string().min(1),
    /** Workspace-relative path or external URL. */
    path: z.string().min(1),
    /** Short human description of the artifact. */
    description: z.string().optional().nullable(),
  })
  .strict();

export const taskIssueOutputGitRefSchema = z
  .object({
    repo: z.string().min(1),
    branch: z.string().min(1),
    /** Commit SHA or list of SHAs (newline-separated). */
    commits: z.string().optional().nullable(),
  })
  .strict();

export const taskIssueOutputTelemetrySchema = z
  .object({
    agentId: z.string().optional().nullable(),
    startedAt: z.string().datetime().optional().nullable(),
    finishedAt: z.string().datetime().optional().nullable(),
    durationSec: z.number().nonnegative().optional().nullable(),
    tokensIn: z.number().nonnegative().optional().nullable(),
    tokensOut: z.number().nonnegative().optional().nullable(),
    costCents: z.number().nonnegative().optional().nullable(),
  })
  .strict();

export const taskIssueOutputSchema = z
  .object({
    /** One-line summary of what happened. */
    summary: z.string().min(1),
    /** Completion status. */
    status: z.enum(TASK_ISSUE_OUTPUT_STATUSES),
    /** Files, docs, commits, URLs the work produced. */
    artifacts: z.array(taskIssueOutputArtifactSchema).optional().default([]),
    /** Git branches / commits this issue touched. */
    gitRefs: z.array(taskIssueOutputGitRefSchema).optional().default([]),
    /** Free-form findings, decisions, caveats, follow-ups. */
    findings: z.string().optional().nullable(),
    /** Execution telemetry. */
    telemetry: taskIssueOutputTelemetrySchema.optional().nullable(),
  })
  .strict();

export type TaskIssueOutputArtifact = z.infer<typeof taskIssueOutputArtifactSchema>;
export type TaskIssueOutputGitRef = z.infer<typeof taskIssueOutputGitRefSchema>;
export type TaskIssueOutputTelemetry = z.infer<typeof taskIssueOutputTelemetrySchema>;
export type TaskIssueOutput = z.infer<typeof taskIssueOutputSchema>;
