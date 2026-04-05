import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { taskQuestions } from "@paperclipai/db";
import {
  TASK_QUESTION_MAX_RETRIES,
  type AskManager,
  type ListTaskQuestionsQuery,
  type TaskQuestion,
  type TaskQuestionStatus,
} from "@paperclipai/shared";
import { notFound, unprocessable } from "../errors.js";

type Row = typeof taskQuestions.$inferSelect;

function toTaskQuestion(row: Row): TaskQuestion {
  return {
    id: row.id,
    companyId: row.companyId,
    issueId: row.issueId,
    fromAgentId: row.fromAgentId,
    toAgentId: row.toAgentId,
    rootQuestionId: row.rootQuestionId,
    parentQuestionId: row.parentQuestionId,
    question: row.question,
    answer: row.answer,
    status: row.status as TaskQuestionStatus,
    retries: row.retries,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    answeredAt: row.answeredAt,
  };
}

export function taskQuestionService(db: Db) {
  async function ask(
    companyId: string,
    fromAgentId: string,
    input: AskManager,
  ): Promise<TaskQuestion> {
    let rootQuestionId: string | null = null;
    if (input.parentQuestionId) {
      const parent = await getById(input.parentQuestionId);
      if (!parent) throw notFound("Parent question not found");
      rootQuestionId = parent.rootQuestionId ?? parent.id;
    }

    const [created] = await db
      .insert(taskQuestions)
      .values({
        companyId,
        fromAgentId,
        toAgentId: input.toAgentId ?? null,
        issueId: input.issueId ?? null,
        parentQuestionId: input.parentQuestionId ?? null,
        rootQuestionId,
        question: input.question,
        status: "pending",
      })
      .returning();
    return toTaskQuestion(created!);
  }

  async function getById(id: string): Promise<TaskQuestion | null> {
    const row = await db
      .select()
      .from(taskQuestions)
      .where(eq(taskQuestions.id, id))
      .then((rows) => rows[0] ?? null);
    return row ? toTaskQuestion(row) : null;
  }

  async function answer(id: string, answerText: string): Promise<TaskQuestion> {
    const existing = await getById(id);
    if (!existing) throw notFound("Question not found");
    if (existing.status !== "pending" && existing.status !== "escalated") {
      throw unprocessable(`Cannot answer a ${existing.status} question`);
    }
    const [updated] = await db
      .update(taskQuestions)
      .set({
        answer: answerText,
        status: "answered",
        answeredAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(taskQuestions.id, id))
      .returning();
    return toTaskQuestion(updated!);
  }

  async function rejectAndEscalate(
    id: string,
    followUp: string,
  ): Promise<TaskQuestion> {
    const existing = await getById(id);
    if (!existing) throw notFound("Question not found");
    if (existing.retries >= TASK_QUESTION_MAX_RETRIES) {
      const [abandoned] = await db
        .update(taskQuestions)
        .set({ status: "abandoned", updatedAt: new Date() })
        .where(eq(taskQuestions.id, id))
        .returning();
      throw unprocessable(
        `Max retries (${TASK_QUESTION_MAX_RETRIES}) reached; question abandoned (id=${abandoned!.id})`,
      );
    }
    const [updated] = await db
      .update(taskQuestions)
      .set({
        question: followUp,
        answer: null,
        status: "pending",
        retries: existing.retries + 1,
        answeredAt: null,
        updatedAt: new Date(),
      })
      .where(eq(taskQuestions.id, id))
      .returning();
    return toTaskQuestion(updated!);
  }

  async function list(
    companyId: string,
    query: ListTaskQuestionsQuery = {},
  ): Promise<TaskQuestion[]> {
    const conditions = [eq(taskQuestions.companyId, companyId)];
    if (query.status) conditions.push(eq(taskQuestions.status, query.status));
    if (query.toAgentId)
      conditions.push(eq(taskQuestions.toAgentId, query.toAgentId));
    if (query.fromAgentId)
      conditions.push(eq(taskQuestions.fromAgentId, query.fromAgentId));
    if (query.issueId) conditions.push(eq(taskQuestions.issueId, query.issueId));
    const rows = await db
      .select()
      .from(taskQuestions)
      .where(and(...conditions))
      .orderBy(desc(taskQuestions.createdAt));
    return rows.map(toTaskQuestion);
  }

  return { ask, answer, rejectAndEscalate, list, getById };
}

export type TaskQuestionService = ReturnType<typeof taskQuestionService>;
