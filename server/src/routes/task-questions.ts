import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  askManagerSchema,
  answerQuestionSchema,
  rejectAnswerSchema,
  listTaskQuestionsQuerySchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { taskQuestionService } from "../services/task-questions.js";
import { assertCompanyAccess } from "./authz.js";

export function taskQuestionRoutes(db: Db) {
  const router = Router();
  const svc = taskQuestionService(db);

  // Agent → manager escalation.
  router.post(
    "/companies/:companyId/task-questions",
    validate(askManagerSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      if (req.actor.type !== "agent" || !req.actor.agentId) {
        res.status(403).json({ error: "Only agents can ask managers" });
        return;
      }
      const created = await svc.ask(companyId, req.actor.agentId, req.body);
      res.status(201).json(created);
    },
  );

  // List questions (inbox for manager, outbox for asker, etc.).
  router.get("/companies/:companyId/task-questions", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const parsed = listTaskQuestionsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
      return;
    }
    const items = await svc.list(companyId, parsed.data);
    res.json(items);
  });

  router.get("/task-questions/:id", async (req, res) => {
    const id = req.params.id as string;
    const q = await svc.getById(id);
    if (!q) {
      res.status(404).json({ error: "Question not found" });
      return;
    }
    assertCompanyAccess(req, q.companyId);
    res.json(q);
  });

  // Manager answers a pending question.
  router.post(
    "/task-questions/:id/answer",
    validate(answerQuestionSchema),
    async (req, res) => {
      const id = req.params.id as string;
      const q = await svc.getById(id);
      if (!q) {
        res.status(404).json({ error: "Question not found" });
        return;
      }
      assertCompanyAccess(req, q.companyId);
      const updated = await svc.answer(id, req.body.answer);
      res.json(updated);
    },
  );

  // Downstream asker rejects an answer → retry-bump + back to pending with
  // new follow-up text. Throws 422 once retries exceed the cap.
  router.post(
    "/task-questions/:id/reject",
    validate(rejectAnswerSchema),
    async (req, res) => {
      const id = req.params.id as string;
      const q = await svc.getById(id);
      if (!q) {
        res.status(404).json({ error: "Question not found" });
        return;
      }
      assertCompanyAccess(req, q.companyId);
      const updated = await svc.rejectAndEscalate(id, req.body.followUp);
      res.json(updated);
    },
  );

  return router;
}
