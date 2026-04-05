export const TASK_QUESTION_STATUSES = [
  "pending",
  "answered",
  "escalated",
  "abandoned",
] as const;

export type TaskQuestionStatus = (typeof TASK_QUESTION_STATUSES)[number];

export const TASK_QUESTION_MAX_RETRIES = 3;

export interface TaskQuestion {
  id: string;
  companyId: string;
  issueId: string | null;
  fromAgentId: string;
  /** Manager being asked. Null = BD (human) escalation. */
  toAgentId: string | null;
  rootQuestionId: string | null;
  parentQuestionId: string | null;
  question: string;
  answer: string | null;
  status: TaskQuestionStatus;
  retries: number;
  createdAt: Date;
  updatedAt: Date;
  answeredAt: Date | null;
}
