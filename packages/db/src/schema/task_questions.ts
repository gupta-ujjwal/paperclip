import {
  type AnyPgColumn,
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { issues } from "./issues.js";

/**
 * Task-mode escalation: agent-to-manager questions.
 *
 * An agent calls ask_manager, which inserts a row here. The manager
 * answers by writing `answer` + status=answered, or forwards the
 * unknown fragment to their own manager (creating a new row with
 * parent_question_id set).
 *
 * Retries track how many times a downstream asker bounced the answer
 * back as insufficient. Hard cap is 3; beyond that the question is
 * marked abandoned.
 *
 * @see doc/task-mode-solution.md §5 — Escalation Protocol
 */
export const taskQuestions = pgTable(
  "task_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    issueId: uuid("issue_id").references(() => issues.id),
    fromAgentId: uuid("from_agent_id").notNull().references(() => agents.id),
    /** Manager being asked. Null = BD (human) escalation. */
    toAgentId: uuid("to_agent_id").references(() => agents.id),
    /** Original question at the bottom of the chain. */
    rootQuestionId: uuid("root_question_id").references(
      (): AnyPgColumn => taskQuestions.id,
    ),
    /** Question this was escalated from (one level down). */
    parentQuestionId: uuid("parent_question_id").references(
      (): AnyPgColumn => taskQuestions.id,
    ),
    question: text("question").notNull(),
    answer: text("answer"),
    /** pending | answered | escalated | abandoned */
    status: text("status").notNull().default("pending"),
    /** How many times the downstream asker rejected the answer. Max 3. */
    retries: integer("retries").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
  },
  (table) => ({
    companyStatusIdx: index("task_questions_company_status_idx").on(
      table.companyId,
      table.status,
    ),
    toAgentStatusIdx: index("task_questions_to_agent_status_idx").on(
      table.toAgentId,
      table.status,
    ),
    issueIdx: index("task_questions_issue_idx").on(table.issueId),
  }),
);
