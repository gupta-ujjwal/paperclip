import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquareWarning } from "lucide-react";
import { taskQuestionsApi } from "../api/taskQuestions";
import { agentsApi } from "../api/agents";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { TASK_QUESTION_MAX_RETRIES, type TaskQuestion } from "@paperclipai/shared";

type Action = "answer" | "reject";

export function TaskEscalations() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, { action: Action; text: string }>>({});

  useEffect(() => {
    setBreadcrumbs([{ label: "Task Escalations" }]);
  }, [setBreadcrumbs]);

  const questionsQuery = useQuery({
    queryKey: queryKeys.taskQuestions.list(selectedCompanyId!, "pending"),
    queryFn: () => taskQuestionsApi.list(selectedCompanyId!, { status: "pending" }),
    enabled: !!selectedCompanyId,
  });

  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const agentsById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agentsQuery.data ?? []) map.set(a.id, a.name);
    return map;
  }, [agentsQuery.data]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["task-questions", selectedCompanyId!] });

  const answerMutation = useMutation({
    mutationFn: ({ id, answer }: { id: string; answer: string }) =>
      taskQuestionsApi.answer(id, answer),
    onSuccess: (_q, vars) => {
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[vars.id];
        return next;
      });
      invalidate();
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, followUp }: { id: string; followUp: string }) =>
      taskQuestionsApi.reject(id, followUp),
    onSuccess: (_q, vars) => {
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[vars.id];
        return next;
      });
      invalidate();
    },
  });

  if (!selectedCompanyId) {
    return <p className="text-sm text-muted-foreground">Select a task first.</p>;
  }

  const questions = questionsQuery.data ?? [];

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center gap-2">
        <MessageSquareWarning className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Task Escalations</h1>
        <span className="text-xs text-muted-foreground">
          {questions.length} pending
        </span>
      </div>

      {questionsQuery.isLoading && (
        <div className="text-sm text-muted-foreground">Loading...</div>
      )}
      {questionsQuery.error && (
        <div className="text-sm text-destructive">
          {questionsQuery.error instanceof Error
            ? questionsQuery.error.message
            : "Failed to load questions"}
        </div>
      )}
      {!questionsQuery.isLoading && questions.length === 0 && (
        <div className="rounded-md border border-border px-4 py-6 text-sm text-muted-foreground">
          No pending escalations.
        </div>
      )}

      {questions.map((q) => (
        <EscalationRow
          key={q.id}
          question={q}
          fromName={agentsById.get(q.fromAgentId) ?? q.fromAgentId}
          toName={q.toAgentId ? agentsById.get(q.toAgentId) ?? q.toAgentId : "BD (human)"}
          draft={drafts[q.id]}
          onDraftChange={(draft) =>
            setDrafts((prev) => ({ ...prev, [q.id]: draft }))
          }
          onCancel={() =>
            setDrafts((prev) => {
              const next = { ...prev };
              delete next[q.id];
              return next;
            })
          }
          onSubmitAnswer={(text) => answerMutation.mutate({ id: q.id, answer: text })}
          onSubmitReject={(text) => rejectMutation.mutate({ id: q.id, followUp: text })}
          submitting={answerMutation.isPending || rejectMutation.isPending}
          error={
            (answerMutation.error instanceof Error && answerMutation.variables?.id === q.id
              ? answerMutation.error.message
              : null) ??
            (rejectMutation.error instanceof Error && rejectMutation.variables?.id === q.id
              ? rejectMutation.error.message
              : null)
          }
        />
      ))}
    </div>
  );
}

function EscalationRow(props: {
  question: TaskQuestion;
  fromName: string;
  toName: string;
  draft: { action: Action; text: string } | undefined;
  onDraftChange: (draft: { action: Action; text: string }) => void;
  onCancel: () => void;
  onSubmitAnswer: (text: string) => void;
  onSubmitReject: (text: string) => void;
  submitting: boolean;
  error: string | null;
}) {
  const { question: q, fromName, toName, draft } = props;
  return (
    <div className="rounded-md border border-border px-4 py-3 space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div>
          <span className="font-medium text-foreground">{fromName}</span> → {toName}
        </div>
        <div className="flex items-center gap-2">
          <span>retries: {q.retries}/{TASK_QUESTION_MAX_RETRIES}</span>
          <span>{new Date(q.createdAt).toLocaleString()}</span>
        </div>
      </div>
      <div className="text-sm whitespace-pre-wrap">{q.question}</div>
      {draft ? (
        <div className="space-y-2 border-t border-border pt-2">
          <textarea
            className="w-full min-h-[80px] rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
            value={draft.text}
            onChange={(e) => props.onDraftChange({ ...draft, text: e.target.value })}
            placeholder={
              draft.action === "answer" ? "Your answer..." : "Follow-up not yet satisfied..."
            }
          />
          {props.error && (
            <div className="text-xs text-destructive">{props.error}</div>
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() =>
                draft.action === "answer"
                  ? props.onSubmitAnswer(draft.text.trim())
                  : props.onSubmitReject(draft.text.trim())
              }
              disabled={props.submitting || draft.text.trim().length === 0}
            >
              {props.submitting
                ? "Submitting..."
                : draft.action === "answer"
                ? "Send answer"
                : "Reject & escalate"}
            </Button>
            <Button size="sm" variant="ghost" onClick={props.onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => props.onDraftChange({ action: "answer", text: "" })}
          >
            Answer
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => props.onDraftChange({ action: "reject", text: "" })}
          >
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}
