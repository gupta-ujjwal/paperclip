# Paperclip: Runtime Flows, Lifecycles, Orchestration Patterns, and Protocols

Comprehensive engineering reference for every runtime flow in Paperclip. Each section covers the full lifecycle, state machines, API endpoints, database tables touched, and error/edge cases.

---

## 1. Agent Lifecycle

### 1.1 Creation (Hire Flow)

Agents enter the system through two paths:

**Direct board hire** (approval not required):
1. Board user submits `POST /api/companies/:companyId/agents` with name, role, adapter config, budget
2. Server validates company scoping, org tree (no cycles, same company for manager)
3. Agent row inserted with `status = "idle"`
4. Optional API key generated via `POST /api/agents/:agentId/keys` (hash stored, plaintext shown once)
5. Activity log entry written

**Agent-requested hire** (approval required when `requireBoardApprovalForNewAgents = true`):
1. Agent (with `canCreateAgents` permission) calls `POST /api/companies/:companyId/agents`
2. Server creates agent row with `status = "pending_approval"`
3. Approval record created: `type = "hire_agent"`, `status = "pending"`, payload contains agent draft
4. Board reviews in UI, approves or rejects
5. On approval: `activatePendingApproval()` transitions agent to `"idle"`, `onHireApproved` adapter hook fires
6. On rejection: agent row stays in `pending_approval` (or is cleaned up)

**Task-mode auto-hire** (PM during onboarding):
- OnboardingWizard sets `requireBoardApprovalForNewAgents: false`
- PM agent created with `canCreateAgents: true`
- Adapter config `cwd` set to `workspacePath`
- PM starts synchronously after company creation

### 1.2 Configuration

Each agent carries:

| Field | Purpose |
|-------|---------|
| `adapterType` | Which adapter runs the agent (claude_local, codex_local, cursor, gemini_local, opencode_local, pi_local, process, http, openclaw_gateway) |
| `adapterConfig` (jsonb) | Adapter-specific blob: cwd, command, args, env, model, heartbeat settings, workspace strategy, runtime services |
| `runtimeConfig` (jsonb) | Session compaction policy, max turns per run |
| `permissions` (jsonb) | `canCreateAgents`, other permission flags |
| `contextMode` | `"thin"` (agent fetches via API) or `"fat"` (context bundled in invocation) |

**Instructions bundle** (generated at agent creation):
- `AGENTS.md` -- contributor guidelines
- `HEARTBEAT.md` -- heartbeat loop definition
- `SOUL.md` -- agent identity and mission
- `TOOLS.md` -- available tools and API reference
- `TASK_ROLE.md` -- role-specific system prompt (task mode, from role library)
- `SKILL.md` -- Paperclip skill (API interaction patterns)

### 1.3 Status State Machine

```text
                    +-----------------+
                    | pending_approval|
                    +--------+--------+
                             |
                    approve  |
                             v
          +-------+     +---+---+     +-------+
          | error |<--->|  idle |<--->| paused|
          +---+---+     +---+---+     +---+---+
              |             |             |
              |        start|        (cancel flow)
              |             v             |
              +-------> running <---------+
                            |
                            | (all states)
                            v
                      +-----------+
                      | terminated|  (irreversible, board only)
                      +-----------+
```

**Allowed transitions:**
- `pending_approval -> idle` (on approval)
- `idle -> running` (heartbeat starts)
- `running -> idle` (heartbeat completes)
- `running -> error` (heartbeat fails)
- `error -> idle` (recovery)
- `idle -> paused` (board pauses, or budget auto-pause)
- `running -> paused` (requires cancel flow: SIGTERM -> grace period -> SIGKILL)
- `paused -> idle` (board resumes, or budget resolved)
- `* -> terminated` (board only, irreversible)

### 1.4 Pause/Resume Mechanics

**Manual pause:**
1. Board calls `POST /api/agents/:agentId/pause`
2. If agent is `running`: cancel current heartbeat run (SIGTERM, then SIGKILL after grace period)
3. Agent `status = "paused"`, `pauseReason = "manual"`, `pausedAt = now`
4. Future heartbeats skipped while paused

**Budget-triggered pause:**
1. Cost event ingested -> budget service evaluates policies
2. If `observedAmount >= policyAmount` and `hardStopEnabled = true`: auto-pause
3. Agent `status = "paused"`, `pauseReason = "budget"`
4. Budget incident created with `status = "open"`
5. Running work cancelled via `hooks.cancelWorkForScope()`

**Resume:**
1. Board calls `POST /api/agents/:agentId/resume`
2. Agent `status = "idle"`, `pauseReason = null`, `pausedAt = null`
3. Heartbeat scheduler resumes normal cycle

### 1.5 Deletion/Termination

- `POST /api/agents/:agentId/terminate` -- sets `status = "terminated"`, irreversible
- Terminated agents cannot be resumed or receive heartbeats
- Company archive (`POST /api/companies/:companyId/archive`) archives all agents

**Tables:** `agents`, `agent_api_keys`, `agent_runtime_state`, `agent_task_sessions`, `agent_wakeup_requests`, `approvals`, `activity_log`

---

## 2. Heartbeat Execution

### 2.1 The Complete Heartbeat Cycle

```text
  Wakeup Source                    Wakeup Queue                  Coordinator
  ============                     ============                  ===========
  timer (scheduler)  ----+
  assignment (issue) ----+---> agent_wakeup_requests ---> withAgentStartLock()
  on_demand (manual) ----+       (coalescing)                    |
  automation         ----+                                       v
                                                         Check: agent not paused/terminated
                                                         Check: budget not exceeded
                                                         Check: concurrent runs < max (default 1)
                                                                 |
                                                                 v
                                                         Resolve workspace (project/agent home)
                                                         Resolve session (resume/compact/fresh)
                                                         Resolve secrets (env var bindings)
                                                                 |
                                                                 v
                                                         Create heartbeat_runs row (status: queued)
                                                         Publish live event: heartbeat.run.queued
                                                                 |
                                                                 v
                                                         adapter.execute(AdapterExecutionContext)
                                                                 |
                                                                 v
                                                         heartbeat_runs.status -> running
                                                         Stream stdout/stderr to run log store
                                                         Publish live events: heartbeat.run.log
                                                                 |
                                                                 v
                                                         Adapter returns AdapterExecutionResult
                                                                 |
                                                                 v
                                                         Process result:
                                                           - Save usage (tokens, cost)
                                                           - Create cost_event
                                                           - Update session state
                                                           - Persist runtime services
                                                           - Update agent status -> idle
                                                           - Budget enforcement check
                                                           - heartbeat_runs.status -> succeeded/failed
                                                           - Publish live event: heartbeat.run.status
```

### 2.2 Wakeup Sources

| Source | Trigger | Example |
|--------|---------|---------|
| `timer` | Scheduled heartbeat interval (min 30s) | Agent's `intervalSec` fires |
| `assignment` | Issue assigned to agent | `queueIssueAssignmentWakeup()` |
| `on_demand` | Manual invocation by board | `POST /api/agents/:agentId/heartbeat/invoke` |
| `automation` | Routine fires, system event | Routine trigger creates issue + wakes agent |

### 2.3 Wakeup Request Queue and Coalescing

Wakeup requests are stored in `agent_wakeup_requests` with statuses:
- `queued` -- waiting to be processed
- `deferred_issue_execution` -- waiting for execution workspace
- `claimed` -- being processed by coordinator
- `coalesced` -- merged into an existing request
- `skipped` -- dropped (agent paused, budget exceeded)
- `completed` -- successfully processed
- `failed` -- processing failed
- `cancelled` -- cancelled by user/system

**Coalescing rules:**
- If an agent already has a `queued` or `running` wakeup, new requests may coalesce
- Context snapshots are merged: `mergeCoalescedContextSnapshot()`
- Idempotency keys prevent duplicate wakeups

### 2.4 Coordinator (Max Concurrent Runs)

The coordinator uses `withAgentStartLock(agentId)` to serialize startup per agent:
- Default max concurrent runs: 1 (configurable up to 10 via `HEARTBEAT_MAX_CONCURRENT_RUNS_MAX`)
- Checks before starting: agent status is not `paused`/`terminated`, budget not exceeded, no existing active run beyond limit
- The `startLocksByAgent` in-memory Map ensures one-at-a-time invocation attempts per agent

### 2.5 Adapter Invocation Protocol

**Input: `AdapterExecutionContext`**
```typescript
{
  runId: string;                    // heartbeat run ID
  agent: AdapterAgent;             // { id, companyId, name, adapterType, adapterConfig }
  runtime: AdapterRuntime;         // { sessionId, sessionParams, sessionDisplayId, taskKey }
  config: Record<string, unknown>; // resolved adapter config (with secrets, workspace)
  context: Record<string, unknown>;// context snapshot (issueId, wakeReason, etc.)
  onLog: (stream, chunk) => void;  // stdout/stderr streaming callback
  onMeta?: (meta) => void;         // invocation metadata callback
  onSpawn?: (meta) => void;        // process spawn callback (pid, startedAt)
  authToken?: string;              // local agent JWT for API callbacks
}
```

**Output: `AdapterExecutionResult`**
```typescript
{
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  errorMessage?: string;
  errorCode?: string;
  usage?: UsageSummary;            // { inputTokens, outputTokens, cachedInputTokens }
  sessionId?: string;
  sessionParams?: Record<string, unknown>;
  sessionDisplayId?: string;
  provider?: string;
  biller?: string;
  model?: string;
  billingType?: AdapterBillingType;// "api" | "subscription" | "metered_api" | "credits" | ...
  costUsd?: number;
  resultJson?: Record<string, unknown>;
  runtimeServices?: AdapterRuntimeServiceReport[];
  summary?: string;
  clearSession?: boolean;
  question?: { prompt, choices[] };// interactive question for board
}
```

### 2.6 Session Management

**Session types:**
- **Agent-level session** (`agent_runtime_state`): global session for the agent, fallback when no task context
- **Task session** (`agent_task_sessions`): per-issue session, keyed by `taskKey` (issue ID or `__heartbeat__` for timer wakes)

**Session lifecycle:**
1. On run start: look up existing session params from `agent_task_sessions` (by taskKey) or `agent_runtime_state`
2. Pass `sessionParams` + `sessionDisplayId` to adapter via `AdapterRuntime`
3. Adapter may resume an existing conversation (e.g., Claude Code session)
4. On run end: save returned `sessionParams`/`sessionDisplayId` back to task session and runtime state

**Session compaction:**
- Policy configured per adapter type: `resolveSessionCompactionPolicy(adapterType, runtimeConfig)`
- Types: `NativeContextManagement` (adapter handles internally) or threshold-based (token count triggers rotation)
- On rotation: previous session summary is captured as `handoffMarkdown`, new session starts fresh
- `clearSession: true` in result forces session reset

**Session reset triggers:**
- `forceFreshSession: true` in context snapshot
- `wakeReason === "issue_assigned"` (new task assignment starts fresh)

### 2.7 Log Storage

- Heartbeat run logs are stored via `RunLogStore` (pluggable: database blob or file-based)
- stdout/stderr streamed in chunks (max `MAX_LIVE_LOG_CHUNK_BYTES = 8KB` per live event)
- Excerpts (truncated) stored inline in `heartbeat_runs` for quick display
- Full logs retrievable via `GET /api/heartbeat-runs/:runId/logs`
- Log entries: `{ stream: "stdout"|"stderr", chunk: string, ts: string }`

### 2.8 Cost Event Creation and Budget Enforcement

After each heartbeat run completes:
1. Extract `usage` and `costUsd` from `AdapterExecutionResult`
2. Normalize billing type: `api` -> `metered_api`, `subscription` -> `subscription_included`, etc.
3. Compute `billedCostCents = round(costUsd * 100)` (0 for `subscription_included`)
4. Insert `cost_events` row with agent, company, issue, project, provider, model, tokens, cost
5. Update `agents.spentMonthlyCents` and `companies.spentMonthlyCents`
6. Call `budgetService.enforce()` which checks all applicable policies
7. If budget exceeded: create incident, auto-pause agent

**Tables:** `heartbeat_runs`, `heartbeat_run_events`, `agent_runtime_state`, `agent_task_sessions`, `agent_wakeup_requests`, `cost_events`, `budget_policies`, `budget_incidents`, `agents`

---

## 3. Issue Orchestration

### 3.1 Issue Creation

- `POST /api/companies/:companyId/issues`
- Required: `title`, `companyId`
- Optional: `description`, `status`, `priority`, `assigneeAgentId`, `createdByAgentId`, `createdByUserId`, `projectId`, `goalId`, `parentId`, `requestDepth`, `billingCode`, `labels`, `originKind`, `originId`
- Company-scoped: `issuePrefix` + auto-incrementing `issueCounter` generates human-readable identifier (e.g., `TSK-0`, `CMP-42`)
- Activity log entry created

### 3.2 Status State Machine

```text
                   +----------+
                   |  backlog |
                   +----+-----+
                        |
                        v
                   +----+-----+
                   |   todo   |<-----------+
                   +----+-----+            |
                        |                  |
                        v                  |
                   +----+------+     +-----+-----+
                   |in_progress|<--->|  blocked   |
                   +----+------+     +-----------+
                        |
                        v
                   +----+------+
                   | in_review |
                   +----+------+
                        |
                        v
                 +------+------+
                 |    done     |
                 +-------------+

     (cancelled reachable from: backlog, todo, in_progress, in_review, blocked)
```

**Allowed transitions:**
- `backlog -> todo | cancelled`
- `todo -> in_progress | blocked | cancelled`
- `in_progress -> in_review | blocked | done | cancelled`
- `in_review -> in_progress | done | cancelled`
- `blocked -> todo | in_progress | cancelled`
- Terminal: `done`, `cancelled`

**Side effects:**
- Entering `in_progress`: sets `started_at` if null, requires `assignee_agent_id`
- Entering `done`: sets `completed_at`
- Entering `cancelled`: sets `cancelled_at`

### 3.3 Atomic Checkout

`POST /api/issues/:issueId/checkout`

```json
{
  "agentId": "uuid",
  "expectedStatuses": ["todo", "backlog", "blocked"]
}
```

**Server behavior:**
1. Single SQL UPDATE:
   ```sql
   UPDATE issues
   SET assignee_agent_id = :agentId,
       status = 'in_progress',
       started_at = COALESCE(started_at, NOW())
   WHERE id = :issueId
     AND status IN (:expectedStatuses)
     AND (assignee_agent_id IS NULL OR assignee_agent_id = :agentId)
   ```
2. If 0 rows updated: return `409 Conflict` with current owner/status
3. Success: agent owns the issue exclusively
4. Same agent can re-checkout (resume from previous session)

**Release:** `POST /api/issues/:issueId/release` -- clears assignee, reverts status to `todo`

### 3.4 Single-Assignee Invariant

- Only one agent can own an issue at a time
- Enforced at the SQL level via atomic checkout WHERE clause
- No optimistic locking or CRDTs needed
- Cross-team work: Agent A creates issue assigned to Agent B; B's costs tracked via `billingCode` back to A

### 3.5 Parent/Child Hierarchy

- `parent_id` foreign key to `issues.id`
- Unlimited nesting depth
- Child issues inherit `projectId` and `goalId` context from parent

### 3.6 Request Depth Tracking

- `request_depth` integer (default 0)
- Incremented each time a task is delegated cross-team
- Provides visibility into how far work cascades through the org

### 3.7 Billing Codes

- `billing_code` text on issues
- When Agent A creates work for Agent B, cost attribution flows through billing code
- Cost events reference `billingCode` for cross-team attribution

### 3.8 Issue Documents, Comments, Labels, Attachments

**Documents** (rich-text artifacts linked to issues):
- `PUT /api/issues/:issueId/documents/:key` -- upsert by workflow key (`plan`, `design`, `notes`)
- Versioned via `document_revisions` (append-only history)
- Tables: `documents`, `document_revisions`, `issue_documents`

**Comments:**
- `POST /api/issues/:issueId/comments`
- By agent (`author_agent_id`) or user (`author_user_id`)
- Used for BD-PM chat in task mode (TSK-0 comments)
- Table: `issue_comments`

**Labels:**
- `issue_labels` join table
- Applied during creation or update

**Attachments:**
- `POST /api/companies/:companyId/issues/:issueId/attachments` (multipart upload)
- Stored via `assets` table (local_disk or S3 provider)
- Linked via `issue_attachments` join table
- `GET /api/attachments/:attachmentId/content` for retrieval

**Tables:** `issues`, `issue_comments`, `issue_labels`, `issue_attachments`, `issue_documents`, `documents`, `document_revisions`, `assets`

---

## 4. Approval Workflow

### 4.1 Approval Types

| Type | Trigger | Payload |
|------|---------|---------|
| `hire_agent` | Agent requests to hire subordinate | Agent draft (name, role, adapter config, budget) |
| `approve_ceo_strategy` | CEO posts initial strategic plan | Plan text, org structure, high-level tasks |
| `budget_override_required` | Budget incident requires board action | Scope, metric, amounts, guidance |

### 4.2 Approval State Machine

```text
  +----------+     +--------------------+
  | pending  |<--->| revision_requested |
  +----+-----+     +--------------------+
       |
       +---------> approved (terminal)
       |
       +---------> rejected (terminal)
       |
       +---------> cancelled (terminal)
```

**Transitions:**
- `pending -> approved | rejected | cancelled | revision_requested`
- `revision_requested -> approved | rejected | cancelled | pending` (resubmit)
- `approved`, `rejected`, `cancelled` are terminal

### 4.3 Approval Comments

- `approval_comments` table for threaded discussion on approval requests
- Board can ask for revisions before final decision
- Comments support `body` text with optional structured metadata

### 4.4 Resolution Flow

**Approve hire:**
1. Board calls `POST /api/approvals/:approvalId/approve`
2. If approval has `payload.agentId`: activate existing pending agent via `activatePendingApproval()`
3. If no agent exists: create agent from payload draft
4. Budget policy created for the new agent if `budgetMonthlyCents > 0`
5. `onHireApproved` adapter lifecycle hook fires (e.g., sends callback to cloud adapter URL)

**Reject hire:**
1. Board calls `POST /api/approvals/:approvalId/reject`
2. Approval marked `rejected` with optional `decisionNote`
3. Agent stays in `pending_approval` state

### 4.5 CEO Hiring and Approval Gate

When `requireBoardApprovalForNewAgents = true` on the company:
- Any agent-initiated hire creates a `hire_agent` approval
- Board must approve before agent becomes `idle`
- Direct board hires bypass this gate entirely

**Endpoints:** `GET /api/companies/:companyId/approvals`, `POST /api/companies/:companyId/approvals`, `POST /api/approvals/:approvalId/approve`, `POST /api/approvals/:approvalId/reject`

**Tables:** `approvals`, `approval_comments`, `agents`, `activity_log`

---

## 5. Budget and Cost Enforcement

### 5.1 Budget Policies

```text
budget_policies:
  id, companyId, scopeType, scopeId, metric, windowKind,
  amount, warnPercent, hardStopEnabled, notifyEnabled, isActive
```

| Field | Values |
|-------|--------|
| `scopeType` | `company`, `agent`, `project` |
| `metric` | `billed_cents` |
| `windowKind` | `calendar_month_utc`, `lifetime` |
| `warnPercent` | Default 80 (%) |
| `hardStopEnabled` | Boolean -- whether to auto-pause on exceed |

### 5.2 Cost Event Ingestion

```text
POST /api/companies/:companyId/cost-events

{
  agentId, issueId?, projectId?, provider, model,
  inputTokens, outputTokens, cachedInputTokens?,
  costCents, occurredAt, billingCode?, biller?, billingType?
}
```

**Validation:**
- Non-negative token counts
- `costCents >= 0`
- Agent must belong to company
- Company ownership checks for all linked entities

### 5.3 The Full Enforcement Flow

```text
  Cost Event Created
        |
        v
  Update agents.spentMonthlyCents
  Update companies.spentMonthlyCents
        |
        v
  budgetService.enforce(companyId, agentId)
        |
        v
  For each applicable budget_policy:
    computeObservedAmount() -- SUM(cost_events) in window
        |
        v
  Compare against thresholds:
    observedAmount >= ceil(amount * warnPercent / 100)  -->  status: "warning"
    observedAmount >= amount                            -->  status: "hard_stop"
        |
        v
  If "hard_stop" AND hardStopEnabled AND NOT already paused:
    |
    +---> createIncidentIfNeeded()
    |       Insert budget_incidents row (status: "open")
    |       Create budget_override_required approval
    |
    +---> pauseAndCancelScopeForBudget()
            If agent: set status="paused", pauseReason="budget"
            If project: set pauseReason="budget", pausedAt=now
            If company: set status="paused", pauseReason="budget"
            hooks.cancelWorkForScope() -- cancel running heartbeats
```

### 5.4 Budget Incident Resolution

Board resolves incidents via `POST /api/budget-incidents/:id/resolve`:

| Action | Effect |
|--------|--------|
| `keep_paused` | Incident resolved, scope stays paused |
| `raise_budget_and_resume` | Policy amount increased, scope auto-resumed, incident resolved |

**Resume from budget pause:**
- `resumeScopeFromBudget()` sets agent `status = "idle"`, clears `pauseReason`
- Only resumes if `pauseReason === "budget"` (won't override manual pause)

### 5.5 Rollups and Summaries

- Read-time aggregation via SQL SUM queries on `cost_events`
- `GET /api/companies/:companyId/costs/summary` -- company totals
- `GET /api/companies/:companyId/costs/by-agent` -- per-agent breakdown
- `GET /api/companies/:companyId/costs/by-project` -- per-project breakdown
- Window calculation: `calendar_month_utc` uses UTC month boundaries; `lifetime` uses epoch to far future

**Tables:** `cost_events`, `budget_policies`, `budget_incidents`, `approvals`, `agents`, `projects`, `companies`

---

## 6. Escalation Protocol (Task Mode)

### 6.1 Overview

Hierarchical question flow enabling agents to escalate unknowns up the reporting chain. BD (human) is the terminal authority.

### 6.2 Core Rules

1. No hallucinating -- if out of scope, escalate
2. Every agent has access to `ask_manager(question, toAgentId, issueId)` via REST API
3. Questions route via `reportsTo` chain
4. BD is terminal -- only PM/EM can escalate to BD
5. Max 3 retries on the same question, then forced abandonment

### 6.3 Question State Machine

```text
  +----------+
  | pending  |----> answered (terminal)
  +----+-----+
       |
       | reject (retry < 3)
       v
  +----------+
  | pending  |  (retries incremented, question text updated to followUp)
  +----+-----+
       |
       | reject (retry >= 3)
       v
  +-----------+
  | abandoned |  (terminal, forced BD intervention)
  +-----------+
```

**Statuses:** `pending`, `answered`, `escalated`, `abandoned`

### 6.4 Partial Escalation with Translation

When an agent receives a question it can only partially answer:
1. Agent answers the parts it knows in its own context
2. Forwards only the unknown fragment upward via a new question (child of the original)
3. When the answer comes back, agent rewrites it in the asker's language before replying

**Example chain:**
```text
SDE1 --asks--> SDE2 --answers eng part, escalates product part--> PM
PM --escalates to--> BD
BD --replies--> PM --rewrites for SDE2--> SDE2 --combines + rewrites for SDE1--> SDE1
```

### 6.5 Question Threading

- `rootQuestionId`: points to the original question in the chain (null for root questions)
- `parentQuestionId`: direct parent question (for escalation chains)
- Enables tracing the full escalation path from leaf to root

### 6.6 API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /api/companies/:companyId/task-questions` | Ask a question (`askManagerSchema`) |
| `GET /api/companies/:companyId/task-questions` | List questions (filter by status, toAgentId, fromAgentId, issueId) |
| `GET /api/task-questions/:id` | Get single question |
| `POST /api/task-questions/:id/answer` | Answer a question |
| `POST /api/task-questions/:id/reject` | Reject and escalate (increments retries, updates question text) |

### 6.7 Edge Cases

- Answer attempted on non-pending question: `422 Unprocessable`
- Retry count >= `TASK_QUESTION_MAX_RETRIES` (3): question set to `abandoned`, error returned
- Reject resets `answer` to null, sets `status` back to `pending`, increments `retries`

**Tables:** `task_questions`

---

## 7. Task Mode Lifecycle

### 7.1 End-to-End Flow

```text
BD creates Task (name, desc, workspace path, budget, provider)
    |
    v
Company created with:
  - workspacePath set
  - issuePrefix forced to "TSK"
  - issueCounter seeded at -1 (so first issue = TSK-0)
  - requireBoardApprovalForNewAgents: false
    |
    v
PM auto-hired (role: ceo, task role: pm)
  - canCreateAgents: true
  - adapter cwd = workspacePath
  - Starts synchronously
    |
    v
TSK-0 root issue auto-created (PM is assignee)
  - Represents the entire task
  - BD<->PM discussion thread via comments
    |
    v
PM reads workspace context files (CLAUDE.md, architecture.md, dsl.md)
    |
    v
PM picks approach: research -> plan -> execute
    |
    v
PM hires team (SDE1, SDE2, QA, EM, Research Analyst, etc.)
  - Each agent gets role-specific system prompt
  - Per-agent git branches
    |
    v
PM creates issues, delegates to team
    |
    v
Team works (escalation + questions flow up, answers flow down)
    |
    v
PM generates final report
  POST /api/companies/:companyId/task-report
    |
    v
Task status: ready_for_review
    |
    v
BD reviews report:
  - "Approve & Close" -> all agents archived, workspace untouched
  - "Reopen with feedback" -> PM resumes with BD feedback
```

### 7.2 Role Mapping

The system bridges `AgentRole` (DB enum) to `TaskRoleName` (config library):

| AgentRole | TaskRoleName | Notes |
|-----------|-------------|-------|
| `ceo` | `pm` | Program Manager, orchestrator |
| `pm` | `program_manager` | Program Manager (non-CEO) |
| `engineer` | `sde2` | Senior engineer |
| `qa` | `qa` | QA engineer |
| `researcher` | `research_analyst` | Research |

### 7.3 Task Role Library

Defined in `packages/shared/src/task-roles.ts` (TypeScript config objects):

| Role | `can_hire` | `is_leaf` | Key capability |
|------|-----------|-----------|---------------|
| PM | true | false | Orchestrates, BD's main contact |
| EM | true | false | Reviews + merges branches |
| Product Manager | true | false | Product decisions |
| Program Manager | true | false | Program coordination |
| Research Analyst | false | true | Research only |
| SDE2 | true | false | Senior engineering |
| SDE1 | false | true | Junior engineering (code only) |
| QA | false | true | Testing only |
| BD | false | false | Domain research helper |

**Rules:**
- Leaf roles cannot hire
- Only SDE1/SDE2 write code
- Hiring agent can override any field per hire

### 7.4 TSK-0 Mechanics

- Issue prefix forced to `"TSK"` when company has `workspacePath`
- Issue counter seeded at `-1` so `createIssue()` increments to 0, producing `TSK-0`
- Multiple task-mode companies get auto-suffixed prefixes (TSK, TSKA, TSKAA, etc.) due to unique index
- TSK-0 pinned at top of issues view

### 7.5 Final PM Report

Stored on the company: `companies.taskReport` (text) + `companies.taskReportSubmittedAt` (timestamp).

Report combines:
- Executive summary
- Per-agent breakdown
- Git diff across all branches
- Cost totals
- Open questions
- Known issues

**Endpoint:** `POST /api/companies/:companyId/task-report`

### 7.6 Task Issue Output Format

Defined in `packages/shared/src/task-output.ts`:

```typescript
TaskIssueOutput {
  summary: string;
  status: "completed" | "partial" | "blocked" | "abandoned";
  artifacts: Array<{ path: string; description?: string }>;
  gitRefs: Array<{ branch?: string; commits?: string[] }>;
  findings: string[];
  telemetry: {
    startedAt?: string;
    endedAt?: string;
    durationSec?: number;
    agentId?: string;
    tokensUsed?: number;
    costCents?: number;
  };
}
```

**Tables:** `companies` (workspacePath, taskReport, taskReportSubmittedAt), `agents` (gitBranch), `task_questions`, `issues`

---

## 8. Workspace and Git

### 8.1 Workspace Path on Company

- `companies.workspace_path` text column -- path to BD-prepared workspace root
- Required for task-mode companies, optional otherwise
- Set during onboarding (Step 1 of OnboardingWizard) or in CompanySettings

### 8.2 Workspace Layout

```text
/my-workspace/
  CLAUDE.md                    # Context for agents
  architecture.md              # Architecture documentation
  dsl.md                       # DSL reference
  update-all-repos.sh          # Refresh script
  repo-1/                      # Git repositories
  repo-2/
  .paperclip/                  # Paperclip artifacts (only dir Paperclip writes to)
    <task-slug>/
      <issue-id>/
        output.md
```

### 8.3 Refresh Workspace

- `POST /api/companies/:companyId/refresh-workspace`
- Runs `update-all-repos.sh` in workspace root via `execFile` with 5-minute timeout
- Validates: workspace path is absolute, script exists and is executable
- Surfaced as "Refresh Workspace" button in Task dashboard/CompanySettings

### 8.4 Per-Agent Git Branches

- `agents.git_branch` text column
- Each code-writing agent (SDE1/SDE2) works on its own branch
- EM reviews and merges into task-level integration branch
- All local in Phase 1 -- no PRs, no remote pushes

### 8.5 Execution Workspaces

Two types of workspace resolution for heartbeat runs:

**Project workspace (primary):**
- Defined on `project_workspaces` table
- Can be a managed checkout (auto-cloned from `repoUrl`) or pre-existing path
- Multiple project workspaces per project supported
- Resolution: `resolveManagedProjectWorkspaceDir()`

**Execution workspace (per-issue):**
- Created per issue when `execution_workspace_policy` requires isolation
- Modes: `shared_workspace` (use project workspace), `isolated_workspace` (git worktree or separate checkout)
- Strategy types: `git_worktree`, `project_primary`
- Tables: `execution_workspaces`, `project_workspaces`

**Agent home (fallback):**
- `~/.paperclip/instances/default/agents/<agentId>/workspace/`
- Used when no project workspace is configured

### 8.6 Workspace Runtime Services

- Defined in adapter config `workspaceRuntime` block
- Per-workspace background services (dev servers, watchers, etc.)
- Managed by `workspace-runtime.ts`: `ensureRuntimeServicesForRun()`, `releaseRuntimeServicesForRun()`
- Services report status via `AdapterRuntimeServiceReport`: starting, running, stopped, failed
- Health checks: `healthStatus: "unknown" | "healthy" | "unhealthy"`
- Scope: `shared` (reused across runs) or `ephemeral` (per-run)

**Tables:** `execution_workspaces`, `project_workspaces`, `workspace_operations`, `workspace_operation_logs`

---

## 9. Routine Scheduling

### 9.1 Routine Model

A routine is a recurring task template that fires on triggers.

```text
routines:
  id, companyId, name, description, status,
  assigneeAgentId, projectId, goalId, parentIssueId,
  issueTitleTemplate, issueDescriptionTemplate, issuePriority,
  concurrencyPolicy, catchUpPolicy, timeZone
```

### 9.2 Routine Status

- `active` -- triggers fire normally
- `paused` -- triggers suppressed
- `archived` -- deactivated permanently

### 9.3 Triggers

Stored in `routine_triggers`:

| Kind | Description |
|------|-------------|
| `schedule` | Cron expression (5-field, timezone-aware) |
| `webhook` | External HTTP POST with signing (bearer or hmac_sha256) |
| `api` | Manual/programmatic trigger via API |

Each trigger has: `id`, `routineId`, `companyId`, `kind`, `label`, `schedule` (cron), `signingMode`, `nextFireAt`, etc.

### 9.4 Concurrency Policies

| Policy | Behavior |
|--------|----------|
| `coalesce_if_active` | If a live execution issue exists for this routine, coalesce into it |
| `always_enqueue` | Always create a new execution issue |
| `skip_if_active` | Skip if a live execution issue already exists |

### 9.5 Catch-Up Policies

| Policy | Behavior |
|--------|----------|
| `skip_missed` | Missed firings are ignored |
| `enqueue_missed_with_cap` | Catch up missed firings, capped at `MAX_CATCH_UP_RUNS` (25) |

### 9.6 Trigger Firing Flow

```text
  Cron scheduler tick (server/src/services/cron.ts)
      |
      v
  For each active routine with schedule triggers:
    matchesCronMinute(expression, timeZone, now)?
      |
      v
  Check concurrency policy:
    - coalesce_if_active: find existing live issue, coalesce
    - skip_if_active: skip if live issue exists
    - always_enqueue: proceed
      |
      v
  Create routine_runs row (status: "received")
      |
      v
  Create execution issue:
    - title from issueTitleTemplate
    - assigned to assigneeAgentId
    - linked to project, goal, parent issue
    - originKind: "routine_execution", originId: routine.id
      |
      v
  routine_runs.status -> "issue_created"
      |
      v
  Queue wakeup for assignee agent (issue assignment wakeup)
      |
      v
  Agent picks up issue via normal heartbeat cycle
```

### 9.7 Webhook Triggers

- Each webhook trigger gets a unique URL with embedded trigger ID
- Signing modes: `bearer` (token in Authorization header) or `hmac_sha256` (signature verification)
- Secret material stored in `company_secrets` (referenced by trigger)
- Timestamp validation to prevent replay attacks: `normalizeWebhookTimestampMs()`

### 9.8 Routine Run Statuses

- `received` -- trigger fired, processing
- `coalesced` -- merged into existing live execution
- `skipped` -- skipped due to concurrency policy
- `issue_created` -- execution issue created
- `completed` -- execution issue reached terminal state
- `failed` -- execution failed

**Endpoints:**
- `POST /api/companies/:companyId/routines` -- create routine
- `GET /api/companies/:companyId/routines` -- list routines
- `POST /api/routines/:routineId/triggers` -- add trigger
- `POST /api/routines/:routineId/fire` -- manual fire
- `POST /api/routine-triggers/:triggerId/webhook` -- webhook endpoint

**Tables:** `routines`, `routine_triggers`, `routine_runs`, `issues`, `company_secrets`

---

## 10. Plugin Lifecycle

### 10.1 Plugin State Machine

```text
  installed ---> ready ---> disabled
      |            |            |
      |            +---> error  |
      |            v            |
      |     upgrade_pending     |
      |            |            |
      v            v            v
           uninstalled
```

**Valid transitions:**
- `installed -> ready | error | uninstalled`
- `ready -> ready | disabled | error | upgrade_pending | uninstalled`
- `disabled -> ready | uninstalled`
- `error -> ready | uninstalled`
- `upgrade_pending -> ready | error | uninstalled`
- `uninstalled -> installed` (reinstall)

### 10.2 Installation

1. Plugin package discovered (npm/local path)
2. Manifest validated (`PaperclipPluginManifestV1`)
3. Plugin record created in DB (`plugin_registry`) with `status = "installed"`
4. Worker process spawned
5. Health check passes -> transition to `ready`
6. If health check fails -> transition to `error`

### 10.3 Worker Management

- Each plugin runs as a separate worker process
- Communication via JSON-RPC over stdio
- `pluginWorkerManager` handles start/stop/restart
- Worker crash detection with automatic restart (emits `plugin.worker.crashed`, `plugin.worker.restarted`)
- Graceful shutdown: SIGTERM -> grace period -> SIGKILL

### 10.4 Plugin Capabilities

Plugins declare capabilities in their manifest:

| Capability | Description |
|------------|-------------|
| Event subscriptions | React to lifecycle events (agent.status, heartbeat.run.*, etc.) |
| Job scheduling | Periodic background jobs via `pluginJobScheduler` |
| Webhook handling | Register webhook endpoints |
| UI contributions | Global toolbar buttons, custom pages |
| Tool registration | Register new tools via `pluginToolRegistry` |
| Data bridge | Read/write Paperclip data via host services |
| Action bridge | Trigger Paperclip actions (create issues, fire heartbeats) |

### 10.5 Plugin Services Architecture

| Service | File | Purpose |
|---------|------|---------|
| `plugin-registry` | Registry CRUD, status tracking | |
| `plugin-loader` | Package resolution, manifest parsing | |
| `plugin-lifecycle` | State machine controller, worker coordination | |
| `plugin-worker-manager` | Process lifecycle, JSON-RPC transport | |
| `plugin-event-bus` | Event delivery to subscribed plugins | |
| `plugin-job-scheduler` | Periodic job scheduling | |
| `plugin-job-coordinator` | Job execution coordination | |
| `plugin-job-store` | Job persistence | |
| `plugin-tool-registry` | Tool registration | |
| `plugin-tool-dispatcher` | Tool invocation routing | |
| `plugin-host-services` | Data/action bridge for plugins | |
| `plugin-state-store` | Plugin-specific key-value storage | |
| `plugin-secrets-handler` | Secret management for plugins | |
| `plugin-config-validator` | Config schema validation | |
| `plugin-capability-validator` | Capability validation | |
| `plugin-stream-bus` | Streaming data to plugins | |
| `plugin-runtime-sandbox` | Sandboxed execution environment | |
| `plugin-dev-watcher` | Hot-reload for development | |
| `plugin-log-retention` | Log cleanup | |

### 10.6 Lifecycle Events Emitted

- `plugin.loaded` -- plugin installed and ready
- `plugin.enabled` -- plugin transitioned to ready
- `plugin.disabled` -- plugin disabled
- `plugin.unloaded` -- plugin uninstalled
- `plugin.status_changed` -- any status transition
- `plugin.error` -- plugin entered error state
- `plugin.upgrade_pending` -- new capabilities need approval
- `plugin.worker_started` -- worker process started
- `plugin.worker_stopped` -- worker process stopped

### 10.7 Plugin SDK

Located at `packages/plugins/sdk/`:
- TypeScript SDK for building plugins
- Manifest schema definition
- JSON-RPC protocol handlers
- Helper utilities for host service communication

**Scaffolding:** `packages/plugins/create-paperclip-plugin/` -- CLI tool for generating new plugin projects

**Example plugins:** `packages/plugins/examples/` -- hello-world, kitchen-sink, file-browser

**Tables:** plugin records in DB (via `plugin-registry`), `plugin_state` (key-value), plugin job tables

---

## 11. Onboarding Flow

### 11.1 OnboardingWizard 4-Step Flow

```text
Step 1: "Task"                      Step 2: "Agent"
  - Task name (required)              - Agent name (PM)
  - Description                       - Adapter type selection
  - Workspace path (required)         - Model selection
  - Budget                            - Provider config
  - Provider selection                |
  |                                   v
  v                                 API: POST /api/companies/:companyId/agents
API: POST /api/companies              (creates PM agent with canCreateAgents: true)
  (creates company with               (heartbeat enabled by default)
   workspacePath, issuePrefix="TSK",
   issueCounter=-1,
   requireBoardApprovalForNewAgents=false)

Step 3: "Task"                      Step 4: "Launch"
  - Task title (becomes TSK-0)        - Review summary
  - Task description                  - Confirm and launch
  |                                   |
  v                                   v
API: POST /api/companies/:id/issues API: POST /api/agents/:id/heartbeat/invoke
  (creates TSK-0 as root issue,       (fires first PM heartbeat)
   assigned to PM)                    Company appears in sidebar
```

### 11.2 What Happens at Each Step

**Step 1 -- Company creation:**
- `POST /api/companies` with `{ name, description, workspacePath, budgetMonthlyCents }`
- `deriveIssuePrefixBase()` returns `"TSK"` when workspacePath is set
- `createCompanyWithUniquePrefix()` handles collision (TSK -> TSKA -> TSKAA)
- Issue counter seeded at `-1`

**Step 2 -- PM agent hire:**
- `POST /api/companies/:companyId/agents` with role `"ceo"`, adapter config
- PM gets `permissions.canCreateAgents = true`
- Adapter config `cwd` set to company's `workspacePath`
- Agent instructions bundle generated with task role chapter

**Step 3 -- Root issue creation:**
- `POST /api/companies/:companyId/issues`
- Counter increments from -1 to 0, producing identifier `TSK-0`
- Assigned to PM agent
- Status: `todo` or `backlog`

**Step 4 -- Launch:**
- `POST /api/agents/:agentId/heartbeat/invoke` with `source: "on_demand"`
- PM's first heartbeat fires
- PM reads workspace context, plans approach, begins execution

### 11.3 Defaults Set During Onboarding

- `requireBoardApprovalForNewAgents: false` (PM can hire freely)
- Budget set from wizard input (or 0 for unlimited)
- Heartbeat enabled with default interval
- Company status: `active`
- Agent status: `idle` (then `running` on first heartbeat)

**Endpoints:** `POST /api/companies`, `POST /api/companies/:id/agents`, `POST /api/companies/:id/issues`, `POST /api/agents/:id/heartbeat/invoke`

**Tables:** `companies`, `agents`, `issues`, `heartbeat_runs`, `activity_log`

---

## 12. Real-time Event Flow

### 12.1 WebSocket Subscription

- Server exposes WebSocket endpoint for live events
- Client subscribes by company ID
- `subscribeCompanyLiveEvents(companyId, listener)` returns unsubscribe function
- Global events via `subscribeGlobalLiveEvents(listener)` for cross-company updates
- Uses Node.js `EventEmitter` internally with `setMaxListeners(0)` (unlimited)

### 12.2 Event Structure

```typescript
LiveEvent {
  id: number;            // auto-incrementing sequence
  companyId: string;     // "*" for global events
  type: LiveEventType;   // event type string
  createdAt: string;     // ISO timestamp
  payload: Record<string, unknown>;
}
```

### 12.3 Event Types

| Event Type | Trigger | Payload |
|------------|---------|---------|
| `heartbeat.run.queued` | New heartbeat run created | runId, agentId |
| `heartbeat.run.status` | Run status changes (running, succeeded, failed, etc.) | runId, status |
| `heartbeat.run.event` | Structured event during run (cost, summary) | runId, event data |
| `heartbeat.run.log` | Log chunk from running heartbeat | runId, stream, chunk |
| `agent.status` | Agent status changes | agentId, status |
| `activity.logged` | New activity log entry | activity entry |
| `plugin.ui.updated` | Plugin UI contribution changed | pluginId |
| `plugin.worker.crashed` | Plugin worker process crashed | pluginId |
| `plugin.worker.restarted` | Plugin worker restarted | pluginId |

### 12.4 How Mutations Trigger Events

```text
  Service mutation (e.g., heartbeat completes)
      |
      v
  publishLiveEvent({
    companyId,
    type: "heartbeat.run.status",
    payload: { runId, status: "succeeded" }
  })
      |
      v
  EventEmitter.emit(companyId, event)
      |
      v
  WebSocket handler sends to subscribed clients
      |
      v
  UI receives event
      |
      v
  TanStack Query cache invalidation
```

### 12.5 UI Cache Invalidation

The UI uses TanStack Query (React Query) for data fetching. When live events arrive:

1. WebSocket listener receives event
2. Event type mapped to query keys that need invalidation
3. `queryClient.invalidateQueries({ queryKey: [...] })` triggers refetch
4. Components re-render with fresh data

**Toast suppression logic:** Certain events (like heartbeat log chunks) do not trigger toasts to avoid UI noise. Only status-changing events produce user-visible notifications.

---

## 13. Company Portability

### 13.1 Export

Two export modes:

**Template export** (structure only):
- Agent definitions, org chart, adapter configs, role descriptions
- Optionally includes seed tasks, projects, routines
- Strips environment-specific paths (cwd, local instruction file paths)
- Never includes secret values -- env inputs exported as portable declarations
- Skills exported with sync preferences

**Snapshot export** (full state):
- Everything in template + current issues, progress, agent status
- Complete activity history

### 13.2 Export Format

Markdown-first package rooted at `COMPANY.md`:
```text
COMPANY.md                         # Company description
.paperclip.yaml                    # Paperclip-specific fidelity
agents/<slug>/AGENTS.md            # Agent definitions
teams/<slug>/TEAM.md               # Team structure
projects/<slug>/PROJECT.md         # Project definitions
projects/<slug>/tasks/<slug>/TASK.md
tasks/<slug>/TASK.md               # Standalone tasks
skills/<slug>/SKILL.md             # Skill definitions
README.md                         # Auto-generated overview
org-chart.png                     # Org chart visualization
```

### 13.3 Import

`POST /api/companies/:companyId/import` (or create new company):

**Preview (dry-run):** `CompanyPortabilityPreviewResult`
- Shows what would be created/modified
- Per-agent plan with collision detection
- Warnings for unpinned git refs

**Apply:**
- Collision strategies: `rename`, `skip`, `replace`
- Agent timer heartbeats forced off (never start scheduled runs implicitly on import)
- Project workspaces recreated and remapped
- Routines recreated from `recurring: true` task definitions
- Skills synced per exported preferences

### 13.4 Collision Strategies

| Strategy | Behavior |
|----------|----------|
| `rename` | Import with suffixed name if collision detected |
| `skip` | Skip the colliding entity entirely |
| `replace` | Overwrite existing entity with imported data |

### 13.5 What Is Included

- Agents (name, role, adapter config, org structure, permissions)
- Projects (with workspaces, workspace policies)
- Issues (with labels, descriptions, status)
- Routines (with triggers, cron expressions)
- Skills (company-level skill preferences)
- Goals (hierarchy)
- Sidebar ordering preferences
- Org chart visualization (PNG)

### 13.6 What Is Excluded

- Secret values (env vars exported as declarations only)
- Agent API keys
- Cost events and budget incidents
- Heartbeat run history and logs
- Activity log entries
- Session state (runtime state, task sessions)

**Endpoints:**
- `POST /api/companies/:companyId/export`
- `POST /api/companies/:companyId/export/preview`
- `POST /api/companies/:companyId/import`
- `POST /api/companies/:companyId/import/preview`
- `POST /api/companies/import` (create new company from package)

**Tables:** `companies`, `agents`, `projects`, `project_workspaces`, `issues`, `goals`, `routines`, `routine_triggers`, `company_skills`, `activity_log`
