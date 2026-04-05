import type { TaskQuestion, TaskQuestionStatus } from "@paperclipai/shared";
import { api } from "./client";

export const taskQuestionsApi = {
  list: (
    companyId: string,
    filter?: { status?: TaskQuestionStatus; toAgentId?: string; fromAgentId?: string },
  ) => {
    const params = new URLSearchParams();
    if (filter?.status) params.set("status", filter.status);
    if (filter?.toAgentId) params.set("toAgentId", filter.toAgentId);
    if (filter?.fromAgentId) params.set("fromAgentId", filter.fromAgentId);
    const qs = params.toString();
    return api.get<TaskQuestion[]>(
      `/companies/${companyId}/task-questions${qs ? `?${qs}` : ""}`,
    );
  },
  get: (id: string) => api.get<TaskQuestion>(`/task-questions/${id}`),
  answer: (id: string, answer: string) =>
    api.post<TaskQuestion>(`/task-questions/${id}/answer`, { answer }),
  reject: (id: string, followUp: string) =>
    api.post<TaskQuestion>(`/task-questions/${id}/reject`, { followUp }),
};
