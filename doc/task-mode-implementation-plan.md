# Task Mode: Implementation Plan

Companion to `task-mode-solution.md`. This doc breaks the solution into sequenced, committable work units.

## Branch

`feat/task-mode`

## Execution Strategy

- Each task lands as **one commit**
- After each task: `pnpm -r typecheck && pnpm build` must pass
- Tests updated/added per task where relevant
- No `pnpm-lock.yaml` commits (regenerated on CI)

## Task Breakdown

### T1 — UI Label Renames (Company → Task, CEO → PM, Monthly → Total Budget)
**Scope:** UI-only strings. No DB, no API, no variable/file renames.
- `packages/shared/src/constants.ts` → `AGENT_ROLE_LABELS.ceo = "PM"` (cascades everywhere)
- Sidebar, CompanySwitcher, Companies page, CompanySettings, OnboardingWizard
- Empty-state strings across all pages (~12 pages)
- Costs page — "Monthly" → "Total" in budget copy
- Hardcoded "CEO" strings in OnboardingWizard + NewAgent forms

**Verification:** `pnpm -r typecheck && pnpm --filter @paperclipai/ui build`

---

### T2 — Workspace Path on Task (DB column + UI form)
**Scope:**
- Add `workspace_path text` to `companies` schema
- Generate + apply migration
- Expose on `Company` shared type
- Validators: `createCompanySchema` accepts optional `workspacePath`
- UI: add required "Workspace Path" field in OnboardingWizard Step 1
- UI: show/edit in CompanySettings General tab
- Server route: accept + persist `workspacePath` on company create/update

**Verification:** `pnpm db:generate && pnpm -r typecheck && pnpm build && pnpm test:run`

---

### T3 — Role Library (Config-driven agent roles)
**Scope:**
- New package `packages/shared/src/roles/` with YAML role configs for: PM, EM, Product Manager, Program Manager, Research Analyst, SDE2, SDE1, QA, BD
- Role loader in `packages/shared/src/roles/index.ts`
- Each role: `name`, `can_hire`, `is_leaf`, `default_model_preference`, `default_tools`, `system_prompt`, `default_reports_to_role`
- Expose `getRole(name)`, `listRoles()`, `getLeafRoles()` helpers
- Add role-aware defaults to agent hire flow (server)

**Verification:** `pnpm -r typecheck && pnpm test:run`

---

### T4 — PM Auto-Hire + Auto-Start on Task Creation
**Scope:**
- Extend OnboardingWizard to auto-create PM with `role: "ceo"`, `canCreateAgents: true`
- Company default: `requireBoardApprovalForNewAgents: false`
- PM's adapter config: `cwd` = workspace path
- PM's system prompt: includes instructions to read `CLAUDE.md`, `architecture.md`, `dsl.md` from workspace
- BD specifies provider (adapter family); PM picks specific model

**Verification:** `pnpm -r typecheck && pnpm build && pnpm test:e2e` (if onboarding test exists)

---

### T5 — TSK-0 Root Issue + Generic Output Format
**Scope:**
- When a company is created, auto-create an issue with title=company.name, assigneeAgentId=PM, identifier = `<prefix>-0` (special seeding)
- Define `StructuredIssueOutput` type in shared
- Schema: `summary`, `status`, `artifacts[]`, `git_refs[]`, `findings[]`, `telemetry{}`
- Server: parse + store on issue completion (optional field on issues or in activity log)

**Verification:** `pnpm db:generate && pnpm -r typecheck && pnpm test:run`

---

### T6 — Per-Agent Git Branches + EM Merge Flow
**Scope:**
- Add `git_branch` column to `agents` (or compute as `<role>/<agent-id>`)
- Workspace runtime: on agent execution, checkout/create agent's branch in each repo
- Provide `em_merge_branch(branchName, repo)` tool available to EM/PM roles
- UI: show agent's branch on agent detail; show merge history on TSK-0

**Verification:** `pnpm db:generate && pnpm -r typecheck && pnpm build`

---

### T7 — Hierarchical Escalation Protocol (ask_manager tool + question threading)
**Scope:**
- New DB table: `questions` (id, companyId, issueId, askerAgentId, targetAgentId, text, isBlocking, status, answer, createdAt, answeredAt, parentQuestionId, retryCount)
- `ask_manager(question, is_blocking)` tool exposed to all agents via adapter config
- When question raised: set issue status to `blocked` if blocking, notify target via inbox/websocket
- Manager responds; if partial: forwards unknown fragment upward as new question with `parentQuestionId`
- Max retries=3 enforced server-side; exceeding escalates to BD automatically
- UI: Questions panel in inbox, questions thread view on issue detail

**Verification:** `pnpm db:generate && pnpm -r typecheck && pnpm build && pnpm test:run`

---

### T8 — Final PM Report + Task Lifecycle
**Scope:**
- PM tool: `submit_task_report(report)` sets company.status = `ready_for_review`
- UI: BD views report on Task dashboard; buttons "Approve & Close" / "Reopen with feedback"
- Approve: archive all agents in task, set company.status = `archived`
- Reopen: set company.status = `active`, record BD feedback as TSK-0 comment

**Verification:** `pnpm -r typecheck && pnpm build`

---

### T9 — Budget Warnings (50% / 80%) + Refresh Workspace Button
**Scope:**
- Activity log entries + inbox notifications at 50%/80% thresholds
- "Refresh Workspace" button on Task dashboard — executes `update-all-repos.sh` from workspace root
- Stream output to activity log / websocket

**Verification:** `pnpm -r typecheck && pnpm build`

---

## Final Steps

- Full verification: `pnpm -r typecheck && pnpm test:run && pnpm build`
- Push branch
- Open PR
- Run pr-review

## Out of Scope (Phase 2)

- Full DB rename (companies → tasks)
- PR creation + remote git push
- Slack/Email notifications
- Soft+hard budget limits
- Sandboxed shell execution
