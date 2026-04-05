import { z } from "zod";
import { TASK_QUESTION_STATUSES } from "../types/task-question.js";

export const askManagerSchema = z.object({
  /** Manager being asked. Null = escalate to BD. */
  toAgentId: z.string().uuid().nullable().optional(),
  /** Issue this question is scoped to. */
  issueId: z.string().uuid().nullable().optional(),
  /** If this is an upward escalation, the parent question id. */
  parentQuestionId: z.string().uuid().nullable().optional(),
  question: z.string().trim().min(1).max(8000),
});

export const answerQuestionSchema = z.object({
  answer: z.string().trim().min(1).max(16000),
});

export const rejectAnswerSchema = z.object({
  /** New question fragment that was not satisfied. */
  followUp: z.string().trim().min(1).max(8000),
});

export const listTaskQuestionsQuerySchema = z.object({
  status: z.enum(TASK_QUESTION_STATUSES).optional(),
  toAgentId: z.string().uuid().optional(),
  fromAgentId: z.string().uuid().optional(),
  issueId: z.string().uuid().optional(),
});

export type AskManager = z.infer<typeof askManagerSchema>;
export type AnswerQuestion = z.infer<typeof answerQuestionSchema>;
export type RejectAnswer = z.infer<typeof rejectAnswerSchema>;
export type ListTaskQuestionsQuery = z.infer<typeof listTaskQuestionsQuerySchema>;
