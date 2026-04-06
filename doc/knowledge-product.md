# Paperclip Product & Engineering Knowledge

Comprehensive reference covering product vision, domain model, UI architecture, adapters, skills, CLI, terminology, and roadmap. Target audience: engineers who need to understand every product concept and component.

---

## 1. Product Vision & Mission

### What Paperclip Is

Paperclip is the **control plane for autonomous AI companies**. It is the infrastructure that autonomous AI companies run on. One instance manages multiple companies, each with its own org chart, agents, tasks, budgets, and governance.

**Mission statement:** Paperclip is to autonomous companies what the corporate operating system is to human ones -- except this time, the operating system is real software, not metaphor. The measure of success is whether Paperclip becomes the default foundation that autonomous companies are built on, and whether those companies collectively become a serious economic force.

### Core Identity

Paperclip's core identity is a control plane centered on **companies, org charts, goals, issues/comments, heartbeats, budgets, approvals, and board governance**. Tasks/comments are the built-in communication model. Paperclip is not a chatbot, not a code review tool, and not an agent runtime.

### Design Principles

| # | Principle | Explanation |
|---|-----------|-------------|
| 1 | **Unopinionated about runtimes** | Any language, any framework, any runtime. Paperclip is the control plane, not the execution plane. |
| 2 | **Company as org unit** | Everything lives under a Company. One instance, many companies. |
| 3 | **Tasks as communication** | All agent communication flows through tasks + comments. No side channels. No separate chat system. |
| 4 | **All work traces to the goal** | Hierarchical task management -- nothing exists in isolation. |
| 5 | **Board governs** | Humans retain control through the Board. Conservative defaults (human approval required). |
| 6 | **Surface problems, don't hide them** | Good auditing and visibility. No silent auto-recovery. No auto-reassignment. |
| 7 | **Atomic ownership** | Single assignee per task. Atomic checkout prevents conflicts. |
| 8 | **Progressive deployment** | Trivial to start local (embedded Postgres, one command), straightforward to scale to hosted. |
| 9 | **Extensible core** | Clean boundaries so plugins can add capabilities without modifying core. |
| 10 | **Control plane, not execution plane** | Paperclip orchestrates. Agents run wherever they run and phone home. |

### Design Goals

1. **Time-to-first-success under 5 minutes** -- install to "CEO completed a first task" in one sitting.
2. **Board-level abstraction wins** -- the default UI answers: what is the company doing, who is doing it, why does it matter, what did it cost, and what needs my approval.
3. **Conversation attached to work objects** -- "chat with CEO" resolves to strategy threads, decisions, tasks, or approvals.
4. **Progressive disclosure** -- top layer: human-readable summary; middle: checklist/steps/artifacts; bottom: raw logs/tool calls.
5. **Output-first** -- work is not done until the user can see the result.
6. **Local-first, cloud-ready** -- mental model stays the same across deployment modes.
7. **Safe autonomy** -- auto mode is allowed; hidden token burn is not.
8. **Thin core, rich edges** -- optional surfaces (chat, knowledge, special UIs) go into plugins.

---

## 2. Domain Model & Terminology

### Core Entities

| Entity | Description |
|--------|-------------|
| **Company** | First-order object. In task-mode, UI-labeled as "Task". Has a goal, agents, org structure, budget, task hierarchy. All business entities are company-scoped. |
| **Agent** | Every employee is an agent. Has adapter type + config, role, title, org position, status, budget. Minimum contract: be callable. |
| **Board (BD)** | Human oversight layer. V1: single human board operator per deployment. Has unrestricted access. In task-mode, labeled "BD". |
| **Issue** | Fundamental unit of work. Single assignee. Has status, priority, parent/child hierarchy, project, goal, comments, documents. Uses human-readable identifiers (`ENG-123`). |
| **Project** | Groups issues toward a time-bound deliverable. Can span multiple teams. Has lead, status, start/target dates. |
| **Goal** | Objectives at levels: `company`, `team`, `agent`, `task`. Statuses: `planned`, `active`, `achieved`, `cancelled`. |
| **Approval** | Governance gate. Types: `hire_agent`, `approve_ceo_strategy`, `budget_override_required`. Statuses: `pending`, `revision_requested`, `approved`, `rejected`, `cancelled`. |
| **Routine** | Recurring scheduled work. Trigger kinds: `schedule`, `webhook`, `api`. Concurrency policies: `coalesce_if_active`, `always_enqueue`, `skip_if_active`. Creates issues on execution. |
| **Heartbeat** | Protocol for initiating an agent's execution cycle. Not a runtime. Sources: `timer`, `assignment`, `on_demand`, `automation`. Run statuses: `queued`, `running`, `succeeded`, `failed`, `cancelled`, `timed_out`. |
| **Adapter** | Defines how Paperclip invokes an agent. Each adapter type has its own config schema, execution logic, and skill sync mode. |
| **Skill** | Markdown-based capability definition (SKILL.md with frontmatter + body) that teaches agents how to interact with systems. Synced to adapter-specific locations. |
| **Plugin** | Out-of-process extension. JSON-RPC 2.0 protocol over stdio. Can hook events, schedule jobs, receive webhooks, contribute UI, register agent tools. |

### Specialized Terms

| Term | Definition |
|------|------------|
| **Atomic Checkout** | Agent claims a task by setting it to `in_progress` via `POST /api/issues/{id}/checkout`. Enforced atomically -- if another agent already claimed it, returns `409 Conflict`. Single-assignment model prevents conflicts. |
| **Billing Code** | Tasks carry a billing code so token spend during execution is attributed upstream to the requesting task/agent. Enables cross-org cost attribution. |
| **Request Depth** | Integer tracking how many delegation hops a cross-team task has traveled from the original requester. |
| **Wakeup Source** | What triggered a heartbeat run. Details: `manual`, `ping`, `callback`, `system`. Request statuses: `queued`, `deferred_issue_execution`, `claimed`, `coalesced`, `skipped`, `completed`, `failed`, `cancelled`. |
| **Context Delivery** | Configurable per agent. **Thin ping**: heartbeat is just a wake-up signal, agent calls Paperclip API for context. **Fat payload**: Paperclip bundles relevant context into the heartbeat invocation. |
| **Runtime State** | Per-agent runtime data including session ID, session params, session display ID, task key. Managed by the adapter session codec. |
| **Portability Package** | Exportable company configuration. **Template export**: structure only (agents, org chart, configs, role definitions, optional seed tasks). **Snapshot export**: full state including current tasks, progress, agent status. |
| **Budget Incident** | Created when budget threshold is breached. Statuses: `open`, `resolved`, `dismissed`. Resolution actions: `keep_paused`, `raise_budget_and_resume`. |
| **Activity Log Entry** | All mutations get activity log entries. Provides audit trail. Queryable by entity type, entity ID, agent ID, company. |
| **Pause Reason** | Why an agent was paused: `manual`, `budget`, `system`. |
| **Principal Type** | Authentication actor: `user` (board) or `agent`. |

### Issue Status Lifecycle

```
backlog -> todo -> in_progress -> in_review -> done
                       |                        ^
                       v                        |
                    blocked -----> (unblocked) --+
                       |
                       v
                   cancelled
```

Statuses (enum): `backlog`, `todo`, `in_progress`, `in_review`, `done`, `blocked`, `cancelled`.

Priorities (enum): `critical`, `high`, `medium`, `low`.

Origin kinds: `manual`, `routine_execution`.

### Org Structure

- **Strict tree** -- `reportsTo` chain, nullable root. No multi-manager reporting.
- **CEO at root** -- first agent created, orchestrates the company.
- **Full visibility** -- every agent can see entire org chart, all tasks, all agents. Org structure defines reporting/delegation lines, not access control.
- Each agent publishes a short description of responsibilities and capabilities for discovery.

### Task Hierarchy

```
Goal (company/team/agent/task level)
  -> Project (time-bound deliverable)
    -> Milestone (stage within project)
      -> Issue (unit of work)
        -> Sub-issue (child issue via parentId)
```

### Company Statuses

`active`, `paused`, `archived`

### Agent Statuses

`active`, `paused`, `idle`, `running`, `error`, `pending_approval`, `terminated`

---

## 3. Role System

### AgentRole Enum (Company Mode)

Defined in `packages/shared/src/constants.ts`:

| Value | UI Label |
|-------|----------|
| `ceo` | PM |
| `cto` | CTO |
| `cmo` | CMO |
| `cfo` | CFO |
| `engineer` | Engineer |
| `designer` | Designer |
| `pm` | Program Manager |
| `qa` | QA |
| `devops` | DevOps |
| `researcher` | Researcher |
| `general` | General |

Note: `ceo` maps to label "PM" (task-mode rebranding).

### TaskRoleName (Task Mode)

Defined in `packages/shared/src/roles/index.ts`. Type: `TaskRoleName`.

| Role | Label | can_hire | is_leaf | default_model | default_tools | default_reports_to |
|------|-------|----------|---------|---------------|---------------|--------------------|
| `pm` | PM | true | false | `opus` | file_read, ask_manager, hire_agent, create_issue, assign_issue, submit_task_report, refresh_workspace | `null` (BD) |
| `em` | Engineering Manager | true | false | `sonnet` | file_read, git, ask_manager, hire_agent, create_issue, assign_issue, merge_branch, request_tool | `pm` |
| `product_manager` | Product Manager | true | false | `sonnet` | file_read, ask_manager, hire_agent, create_issue, assign_issue, web_search, request_tool | `pm` |
| `program_manager` | Program Manager | true | false | `sonnet` | file_read, ask_manager, create_issue, assign_issue, request_tool | `pm` |
| `research_analyst` | Research Analyst | false | **true** | `sonnet` | file_read, file_write, web_search, ask_manager, request_tool | `pm` |
| `sde2` | Senior Engineer (SDE2) | false | false | `sonnet` | file_read, file_write, shell_exec, git, ask_manager, request_tool | `em` |
| `sde1` | Junior Engineer (SDE1) | false | **true** | `haiku` | file_read, file_write, shell_exec, git, ask_manager, request_tool | `sde2` |
| `qa` | QA | false | **true** | `haiku` | file_read, shell_exec, run_tests, ask_manager, request_tool | `em` |
| `bd` | Business Development (agent) | false | false | `sonnet` | file_read, web_search, ask_manager, request_tool | `pm` |

**Key rules:**
- Leaf roles (`sde1`, `qa`, `research_analyst`) cannot hire sub-agents.
- Only SDE1/SDE2 write code.
- Hiring agent can override any field per-hire.
- Tool requests escalate to the hiring manager via `request_tool`.

### TaskRoleTool Enum

`file_read`, `file_write`, `shell_exec`, `git`, `ask_manager`, `request_tool`, `hire_agent`, `create_issue`, `assign_issue`, `merge_branch`, `submit_task_report`, `web_search`, `run_tests`, `refresh_workspace`

### ModelPreference

`opus`, `sonnet`, `haiku`, `auto`

### AGENT_ROLE_TO_TASK_ROLE Mapping

Defined in `server/src/services/default-agent-instructions.ts`:

| AgentRole | TaskRoleName |
|-----------|-------------|
| `ceo` | `pm` |
| `pm` | `program_manager` |
| `engineer` | `sde2` |
| `qa` | `qa` |
| `researcher` | `research_analyst` |

Used to materialize role-specific system prompts into agent instruction bundles at creation time.

---

## 4. UI Architecture

### Overview

React 19 SPA built with Vite 6. Tailwind CSS 4 for styling. React Router for page routing. TanStack Query for data fetching. WebSocket for live events.

**Entry point:** `ui/src/App.tsx`

### Provider Hierarchy

```
QueryClientProvider (TanStack Query)
  -> ThemeProvider
    -> BrowserRouter
      -> CompanyProvider
        -> LiveUpdatesProvider (WebSocket)
          -> TooltipProvider
            -> BreadcrumbProvider
              -> SidebarProvider
                -> PanelProvider
                  -> PluginLauncherProvider
                    -> DialogProvider
                      -> ToastProvider
                        -> <Routes>
```

### Context Providers

| Context | File | Purpose |
|---------|------|---------|
| `CompanyContext` | `ui/src/context/CompanyContext.tsx` | Selected company state, company list, localStorage persistence of selection. All company-scoped pages read from this. |
| `BreadcrumbContext` | `ui/src/context/BreadcrumbContext.tsx` | Dynamic breadcrumb trail for page navigation. |
| `DialogContext` | `ui/src/context/DialogContext.tsx` | Manages modal dialogs including OnboardingWizard. |
| `ToastContext` | `ui/src/context/ToastContext.tsx` | Toast notifications with deduplication and TTL by tone (success, error, etc.). |
| `ThemeContext` | `ui/src/context/ThemeContext.tsx` | Dark/light theme toggle, persisted to localStorage. |
| `SidebarContext` | `ui/src/context/SidebarContext.tsx` | Sidebar open/collapsed state. |
| `PanelContext` | `ui/src/context/PanelContext.tsx` | Properties panel state for detail views. |
| `LiveUpdatesProvider` | `ui/src/context/LiveUpdatesProvider.tsx` | WebSocket connection to server for real-time events. Handles cache invalidation on events like `agent.status`, `activity.logged`, `heartbeat.run.status`, etc. |

### Routing

**Public routes** (no auth gate):

| Path | Component |
|------|-----------|
| `/auth` | `AuthPage` |
| `/board-claim/:token` | `BoardClaimPage` |
| `/cli-auth/:id` | `CliAuthPage` |
| `/invite/:token` | `InviteLandingPage` |

**Instance routes** (behind `CloudAccessGate`):

| Path | Component |
|------|-----------|
| `/instance/settings/general` | `InstanceGeneralSettings` |
| `/instance/settings/heartbeats` | `InstanceSettings` |
| `/instance/settings/experimental` | `InstanceExperimentalSettings` |
| `/instance/settings/plugins` | `PluginManager` |
| `/instance/settings/plugins/:pluginId` | `PluginSettings` |

**Company-scoped routes** (under `/:companyPrefix`, within `Layout`):

| Path | Component | Description |
|------|-----------|-------------|
| `dashboard` | `Dashboard` | High-level metrics: agent count, active tasks, costs, goal progress, burn rate. |
| `onboarding` | `OnboardingRoutePage` | Run onboarding wizard again (add agent or create company). |
| `companies` | `Companies` | Company list/switcher. |
| `company/settings` | `CompanySettings` | Company-level settings (name, governance, budget defaults). |
| `company/export/*` | `CompanyExport` | Export company as template or snapshot. |
| `company/import` | `CompanyImport` | Import a company configuration. |
| `skills/*` | `CompanySkills` | Manage company-level skills. |
| `plugins/:pluginId` | `PluginPage` | Plugin-contributed page. |
| `org` | `OrgChart` | Visual org tree with live status indicators per agent. |
| `agents/all` | `Agents` | Agent list (all). |
| `agents/active` | `Agents` | Agent list filtered to active. |
| `agents/paused` | `Agents` | Agent list filtered to paused. |
| `agents/error` | `Agents` | Agent list filtered to error. |
| `agents/new` | `NewAgent` | Create new agent form. |
| `agents/:agentId` | `AgentDetail` | Agent deep dive: tasks, activity, costs, config, status history, skills, runs. |
| `agents/:agentId/:tab` | `AgentDetail` | Agent detail with specific tab. |
| `agents/:agentId/runs/:runId` | `AgentDetail` | Agent detail showing specific run transcript. |
| `projects` | `Projects` | Project list. |
| `projects/:projectId` | `ProjectDetail` | Project overview with tabs: overview, issues, workspaces, configuration, budget. |
| `projects/:projectId/issues` | `ProjectDetail` | Project issues tab. |
| `projects/:projectId/issues/:filter` | `ProjectDetail` | Project issues with filter. |
| `projects/:projectId/workspaces/:workspaceId` | `ProjectWorkspaceDetail` | Project workspace detail. |
| `issues` | `Issues` | Issue list with filters. |
| `issues/:issueId` | `IssueDetail` | Issue detail: description, comments, activity, runs, documents, attachments, work products. |
| `routines` | `Routines` | Routine list. |
| `routines/:routineId` | `RoutineDetail` | Routine detail with run history. |
| `execution-workspaces/:workspaceId` | `ExecutionWorkspaceDetail` | Execution workspace detail. |
| `goals` | `Goals` | Goal list by level. |
| `goals/:goalId` | `GoalDetail` | Goal detail with linked projects/issues. |
| `approvals/pending` | `Approvals` | Pending approvals list. |
| `approvals/all` | `Approvals` | All approvals list. |
| `approvals/:approvalId` | `ApprovalDetail` | Approval detail with comments, linked issues, approve/reject/revision actions. |
| `costs` | `Costs` | Cost dashboard: spend by agent, project, provider, biller. Finance events. |
| `activity` | `Activity` | Activity log timeline. |
| `task-escalations` | `TaskEscalations` | Task-mode escalation queue (questions from agents to BD). |
| `inbox/mine` | `Inbox` | Agent inbox: issues assigned to current user. |
| `inbox/recent` | `Inbox` | Recently touched issues. |
| `inbox/unread` | `Inbox` | Unread issues. |
| `inbox/all` | `Inbox` | All inbox items. |
| `design-guide` | `DesignGuide` | Internal component design reference. |
| `tests/ux/runs` | `RunTranscriptUxLab` | UX lab for run transcript rendering. |
| `:pluginRoutePath` | `PluginPage` | Catch-all for plugin-contributed routes. |

### Layout

- **Sidebar** (`CompanyRail`): company switcher, navigation links with badge counts, mobile bottom nav.
- **Breadcrumbs**: dynamic trail based on current route.
- **Properties Panel**: slide-out panel for detail views (issue properties, agent config, etc.).
- **Mobile**: bottom navigation bar replaces sidebar on small screens.

### API Client Layer

All API client modules live in `ui/src/api/`. Each module exports typed functions that call the server REST API.

| Module | Key Operations |
|--------|---------------|
| `client.ts` | Base fetch wrapper with auth headers, error handling. |
| `companies.ts` | list, get, create, update, delete, stats |
| `agents.ts` | list, get, create, update, delete, pause, resume, skills, keys, config revisions, runtime state, task sessions, adapter models |
| `issues.ts` | list, get, create, update, checkout, release, comments (CRUD), documents, attachments, search, work products, runs |
| `projects.ts` | list, get, create, update, delete |
| `goals.ts` | list, get, create, update, delete |
| `approvals.ts` | list, get, create, approve, reject, request-revision, resubmit, comments |
| `costs.ts` | list by company, by agent, by project, usage by provider/biller, finance events/summary |
| `budgets.ts` | overview, thresholds, incidents |
| `activity.ts` | list by company, by entity |
| `dashboard.ts` | get dashboard stats |
| `heartbeats.ts` | list runs, run detail, run issues, workspace operations |
| `routines.ts` | list, get, create, update, runs |
| `auth.ts` | session, login, logout, signup |
| `health.ts` | get health/deployment info |
| `secrets.ts` | list, create, delete, providers |
| `plugins.ts` | list, install, uninstall, enable, disable, settings, logs |
| `companySkills.ts` | list, detail, sync, update status, file content |
| `instanceSettings.ts` | general settings, heartbeat scheduler, experimental flags |
| `assets.ts` | upload, download |
| `sidebarBadges.ts` | get badge counts for navigation |
| `taskQuestions.ts` | list task-mode escalation questions |
| `access.ts` | join requests, invites, members |
| `execution-workspaces.ts` | list, detail, close readiness, workspace operations |

### Query Key Structure

Defined in `ui/src/lib/queryKeys.ts`. Hierarchical key structure for TanStack Query cache:

```typescript
queryKeys = {
  companies: { all, detail(id), stats },
  companySkills: { list(companyId), detail(companyId, skillId), file(...) },
  agents: { list(companyId), detail(id), runtimeState(id), taskSessions(id), skills(id),
            instructionsBundle(id), keys(agentId), configRevisions(agentId),
            adapterModels(companyId, adapterType), detectModel(companyId, adapterType) },
  issues: { list(companyId), search(companyId, q, projectId?), detail(id),
            comments(issueId), attachments(issueId), documents(issueId),
            activity(issueId), runs(issueId), approvals(issueId),
            liveRuns(issueId), activeRun(issueId), workProducts(issueId),
            labels(companyId), listByProject(companyId, projectId),
            listByExecutionWorkspace(companyId, wsId) },
  routines: { list(companyId), detail(id), runs(id), activity(companyId, id) },
  executionWorkspaces: { list(companyId, filters?), detail(id), closeReadiness(id) },
  projects: { list(companyId), detail(id) },
  goals: { list(companyId), detail(id) },
  budgets: { overview(companyId) },
  taskQuestions: { list(companyId, status?) },
  approvals: { list(companyId, status?), detail(id), comments(id), issues(id) },
  access: { joinRequests(companyId, status), invite(token) },
  auth: { session },
  instance: { generalSettings, schedulerHeartbeats, experimentalSettings },
  health,
  secrets: { list(companyId), providers(companyId) },
  dashboard(companyId),
  sidebarBadges(companyId),
  activity(companyId),
  costs(companyId, from?, to?),
  heartbeats(companyId, agentId?),
  runDetail(runId),
  org(companyId),
  skills: { available },
}
```

### Cache Invalidation Strategy

The `LiveUpdatesProvider` WebSocket connection listens for server-pushed events and invalidates relevant query keys:

| Live Event Type | Invalidated Queries |
|-----------------|-------------------|
| `agent.status` | agents list, agent detail, sidebar badges |
| `activity.logged` | activity, sidebar badges, dashboard |
| `heartbeat.run.queued` | heartbeats, live runs |
| `heartbeat.run.status` | heartbeats, run detail, agent detail, issues |
| `heartbeat.run.event` | run detail |
| `heartbeat.run.log` | run detail (streaming) |
| `plugin.ui.updated` | plugin-specific queries |
| `plugin.worker.crashed` | plugin status |
| `plugin.worker.restarted` | plugin status |

### Vite Dev Proxy

`/api` requests are proxied to `http://localhost:3100` via Vite dev server configuration. In production, the server serves the built UI as static assets.

---

## 5. Adapter System

### Adapter Interface

Defined in `packages/adapter-utils/src/types.ts` as `ServerAdapterModule`:

```typescript
interface ServerAdapterModule {
  type: string;
  execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult>;
  testEnvironment(ctx: AdapterEnvironmentTestContext): Promise<AdapterEnvironmentTestResult>;
  listSkills?: (ctx: AdapterSkillContext) => Promise<AdapterSkillSnapshot>;
  syncSkills?: (ctx: AdapterSkillContext, desiredSkills: string[]) => Promise<AdapterSkillSnapshot>;
  sessionCodec?: AdapterSessionCodec;
  sessionManagement?: AdapterSessionManagement;
  supportsLocalAgentJwt?: boolean;
  models?: AdapterModel[];
  listModels?: () => Promise<AdapterModel[]>;
  agentConfigurationDoc?: string;
  onHireApproved?: (payload: HireApprovedPayload, config: Record<string, unknown>) => Promise<HireApprovedHookResult>;
  getQuotaWindows?: () => Promise<ProviderQuotaResult>;
  detectModel?: () => Promise<{ model: string; provider: string; source: string } | null>;
}
```

### All Adapters

Adapter registry: `server/src/adapters/registry.ts`. Ten adapters total.

| Type | Package | Label | Session Support | Skill Sync | Local JWT | Key Features |
|------|---------|-------|-----------------|------------|-----------|-------------|
| `claude_local` | `packages/adapters/claude-local` | Claude Code (local) | Yes (sessionCodec + compaction) | persistent (symlinks in `~/.claude/skills`) | Yes | Runs `claude` CLI locally. Stream JSON output. Session resume via `--resume`. Quota windows from Anthropic API. |
| `codex_local` | `packages/adapters/codex-local` | Codex CLI (local) | Yes (sessionCodec + compaction) | persistent (symlinks in `~/.codex/skills`) | Yes | Runs `codex` CLI locally. JSONL output. Session resume. Quota windows from OpenAI API. |
| `cursor` | `packages/adapters/cursor-local` | Cursor CLI (local) | Yes (sessionCodec + compaction) | persistent | Yes | Runs Cursor Agent CLI locally. Stream JSON output. `--resume` support. |
| `gemini_local` | `packages/adapters/gemini-local` | Gemini CLI (local) | Yes (sessionCodec + compaction) | persistent | Yes | Runs `gemini` CLI locally. |
| `opencode_local` | `packages/adapters/opencode-local` | OpenCode (local) | Yes (sessionCodec + compaction) | persistent | Yes | Runs `opencode` CLI locally. Dynamic model discovery via `listModels`. |
| `pi_local` | `packages/adapters/pi-local` | Pi CLI (local) | Yes (sessionCodec + compaction) | persistent | Yes | Runs `pi` CLI locally. Dynamic model discovery. |
| `openclaw_gateway` | `packages/adapters/openclaw-gateway` | OpenClaw Gateway | No | No | No | Fire-and-forget HTTP webhook to OpenClaw gateway. No local process. |
| `hermes_local` | external: `hermes-paperclip-adapter` | Hermes (local) | Yes (sessionCodec) | persistent | Yes | Runs Hermes agent locally. Model detection support. |
| `process` | `server/src/adapters/process` | Process | No | No | No | Generic child process adapter. Runs arbitrary command. Fallback for unknown adapter types. |
| `http` | `server/src/adapters/http` | HTTP | No | No | No | Generic HTTP webhook adapter. Sends POST to configured URL. |

### Adapter Models

| Adapter | Static Models |
|---------|--------------|
| `claude_local` | `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-6`, `claude-sonnet-4-5-20250929`, `claude-haiku-4-5-20251001` |
| `codex_local` | `gpt-5.4`, `gpt-5.3-codex-max` (default), `gpt-5.3-codex-spark`, `gpt-5`, `o3`, `o4-mini`, `gpt-5-mini`, `gpt-5-nano`, `o3-mini`, `codex-mini-latest` |
| `opencode_local` | `openai/gpt-5.3-codex-max` (default), `openai/gpt-5.4`, `openai/gpt-5.2`, `openai/gpt-5.1-codex-max`, `openai/gpt-5.1-codex-mini` |
| `gemini_local` | auto (default), `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.0-flash`, `gemini-2.0-flash-lite` |
| `cursor` | `auto`, `composer-1.5`, `composer-1`, various `gpt-5.x-codex-*` variants, `kimi-k2.5` |
| `pi_local` | Dynamic discovery only (empty static list) |
| `openclaw_gateway` | Empty (models not reported) |
| `hermes_local` | From `hermes-paperclip-adapter` package |

### Session Management

- **Session codec** (`AdapterSessionCodec`): `deserialize(raw) -> params`, `serialize(params) -> raw`, `getDisplayId(params) -> string`. Common params: `sessionId`, `cwd`, `workspaceId`, `repoUrl`, `repoRef`.
- **Compaction policies**: managed via `getAdapterSessionManagement()` from `@paperclipai/adapter-utils`. Controls when sessions are compacted/reset.
- **Task sessions**: agents can have per-task sessions tracked in `agents.task-sessions` query key.
- **Resume rules**: if a task is already assigned to the requesting agent from a previous session, they can resume.

### Adapter Utilities

Package: `packages/adapter-utils/src/`

Key utilities:
- `runChildProcess` -- spawn and manage adapter child processes
- `resolveCommandPath` -- resolve adapter CLI binary location
- `buildPaperclipEnv` -- construct `PAPERCLIP_*` environment variables for agent processes
- Template rendering for prompt construction
- Session compaction management

### Execution Context

```typescript
interface AdapterExecutionContext {
  runId: string;
  agent: AdapterAgent;          // { id, companyId, name, adapterType, adapterConfig }
  runtime: AdapterRuntime;      // { sessionId, sessionParams, sessionDisplayId, taskKey }
  config: Record<string, unknown>;
  context: Record<string, unknown>;
  onLog: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
  onMeta?: (meta: AdapterInvocationMeta) => Promise<void>;
  onSpawn?: (meta: { pid: number; startedAt: string }) => Promise<void>;
  authToken?: string;
}
```

### Execution Result

```typescript
interface AdapterExecutionResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  errorMessage?: string | null;
  usage?: UsageSummary;         // { inputTokens, outputTokens, cachedInputTokens? }
  sessionId?: string | null;
  sessionParams?: Record<string, unknown> | null;
  provider?: string | null;
  model?: string | null;
  billingType?: AdapterBillingType | null;
  costUsd?: number | null;
  runtimeServices?: AdapterRuntimeServiceReport[];
  summary?: string | null;
  clearSession?: boolean;
  question?: { prompt: string; choices: Array<{ key: string; label: string }> } | null;
}
```

---

## 6. Skills System

### SKILL.md Format

Skills are defined as markdown files with YAML frontmatter:

```markdown
---
name: skill-name
description: >
  When to use this skill and what it does.
---

# Skill Title

Body content: instructions, procedures, API references, rules.
```

### Bundled Skills

All shipped skills live at `/home/vishal/juspay/Playground/paperclip/skills/`:

#### `paperclip` (Required)

File: `skills/paperclip/SKILL.md`

The core skill that teaches agents how to interact with the Paperclip control plane. Content:

- **Authentication**: env vars `PAPERCLIP_AGENT_ID`, `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_API_URL`, `PAPERCLIP_RUN_ID`, `PAPERCLIP_API_KEY`. Wake context vars: `PAPERCLIP_TASK_ID`, `PAPERCLIP_WAKE_REASON`, `PAPERCLIP_WAKE_COMMENT_ID`, `PAPERCLIP_APPROVAL_ID`, `PAPERCLIP_APPROVAL_STATUS`, `PAPERCLIP_LINKED_ISSUE_IDS`.
- **8-step heartbeat procedure**:
  1. Identity -- `GET /api/agents/me`
  2. Approval follow-up (if triggered)
  3. Get assignments -- `GET /api/agents/me/inbox-lite`
  4. Pick work (with mention exception, blocked-task dedup)
  5. Checkout -- `POST /api/issues/{issueId}/checkout` with run ID header
  6. Understand context -- `GET /api/issues/{issueId}/heartbeat-context`, incremental comments
  7. Do the work
  8. Update status and communicate
- **Critical rules**: always checkout before work; never retry a 409; include `X-Paperclip-Run-Id` header on all mutating requests; update to `blocked` before exiting if blocked.
- **Endpoint table**: full REST API reference for agents.

#### `para-memory-files`

File: `skills/para-memory-files/SKILL.md`

File-based memory system using Tiago Forte's PARA method. Three layers:
1. **Knowledge Graph** (`$AGENT_HOME/life/` -- PARA): entity-based storage with `summary.md` + `items.yaml` per entity. Folders: `projects/`, `areas/`, `resources/`, `archives/`.
2. **Daily Notes**: raw timeline as daily markdown files.
3. **Tacit Knowledge**: patterns about user behavior.

Rules: save durable facts immediately; weekly rewrite summaries; never delete facts (supersede instead); create entity after 3+ mentions or significant relationship.

#### `paperclip-create-agent`

File: `skills/paperclip-create-agent/SKILL.md`

Governance-aware agent hiring. Workflow: inspect adapter config options, compare existing agent configs, draft new agent prompt/config, submit hire request via approval system. Requires board access or `can_create_agents=true` permission.

#### `paperclip-create-plugin`

File: `skills/paperclip-create-plugin/SKILL.md`

Plugin scaffolding skill. References `PLUGIN_AUTHORING_GUIDE.md`, SDK README, and plugin spec. Covers scaffold flow, verification steps, supported worker/UI surface.

### Skill Synchronization Modes

Defined as `AdapterSkillSyncMode` in `packages/shared/src/types/adapter-skills.ts`:

| Mode | Behavior |
|------|----------|
| `persistent` | Skills symlinked into adapter's home directory (e.g., `~/.claude/skills/`, `~/.codex/skills/`). Persist across runs. |
| `ephemeral` | Skills injected per-run and removed after. |
| `unsupported` | Adapter does not support skill sync (e.g., `process`, `http`, `openclaw_gateway`). |

### Skill States

Type: `AgentSkillState`

| State | Meaning |
|-------|---------|
| `available` | Skill exists in the skill catalog but is not installed for this agent. |
| `configured` | Skill is in the agent's desired skill list. |
| `installed` | Skill is synced and present in the adapter's skill directory. |
| `missing` | Skill is configured but not found on disk. |
| `stale` | Skill is installed but out of date with source. |
| `external` | Skill found in adapter directory but not managed by Paperclip. |

### Skill Origins

Type: `AgentSkillOrigin`

| Origin | Meaning |
|--------|---------|
| `paperclip_required` | Required by Paperclip (e.g., the `paperclip` skill). |
| `company_managed` | Managed at the company level. |
| `user_installed` | Installed by the user/operator. |
| `external_unknown` | Found on disk but origin unknown to Paperclip. |

---

## 7. Plugin System

### Plugin Manifest

Type: `PaperclipPluginManifestV1`. Current API version: `PLUGIN_API_VERSION = 1`.

Key manifest fields: name, version, description, author, categories (`connector`, `workspace`, `automation`, `ui`), capabilities (list of `PluginCapability`), config schema, event subscriptions, UI contributions, agent tools, jobs, webhooks.

### JSON-RPC 2.0 Protocol

Plugins run out-of-process. Host and worker communicate over JSON-RPC on stdio.

#### Host -> Worker Methods

| Method | Required | Purpose |
|--------|----------|---------|
| `initialize(input)` | Yes | Called once on startup. Input: manifest, resolved config, instance info, host API version. |
| `health()` | Yes | Returns status, current error, diagnostics. |
| `shutdown()` | Yes | Graceful stop. 10s deadline, then SIGTERM, then SIGKILL. |
| `validateConfig(input)` | No | Validates config. Returns ok/warnings/errors. |
| `configChanged(input)` | No | Hot-reload config without restart. |
| `onEvent(input)` | No | Receives one typed domain event. |
| `runJob(input)` | No | Execute a scheduled job. |
| `handleWebhook(input)` | No | Handle inbound webhook delivery. |
| `getData(input)` | No | Serve data for plugin UI (bridge call from frontend). |
| `performAction(input)` | No | Handle action from plugin UI (bridge call from frontend). |
| `executeTool(input)` | No | Execute agent tool registered by the plugin. |

#### Worker -> Host Methods (SDK)

Workers call back to the host via the SDK for:

| Category | Capabilities |
|----------|-------------|
| **Data Read** | `companies.read`, `projects.read`, `project.workspaces.read`, `issues.read`, `issue.comments.read`, `issue.documents.read`, `agents.read`, `goals.read`, `activity.read`, `costs.read` |
| **Data Write** | `issues.create`, `issues.update`, `issue.comments.create`, `issue.documents.write`, `agents.pause`, `agents.resume`, `agents.invoke`, `agent.sessions.*`, `activity.log.write`, `metrics.write`, `goals.create`, `goals.update` |
| **Plugin State** | `plugin.state.read`, `plugin.state.write` |
| **Runtime** | `events.subscribe`, `events.emit`, `jobs.schedule`, `webhooks.receive`, `http.outbound`, `secrets.read-ref` |
| **Agent Tools** | `agent.tools.register` |
| **UI** | `instance.settings.register`, `ui.sidebar.register`, `ui.page.register`, `ui.detailTab.register`, `ui.dashboardWidget.register`, `ui.commentAnnotation.register`, `ui.action.register` |

### Plugin Lifecycle

```
install -> installed -> ready (running) -> disabled | error | upgrade_pending | uninstalled
                                  |
                         shutdown (graceful)
```

Statuses: `installed`, `ready`, `disabled`, `error`, `upgrade_pending`, `uninstalled`.

### Plugin Storage

- **State**: scoped key-value store. Scope kinds: `instance`, `company`, `project`, `project_workspace`, `agent`, `issue`, `goal`, `run`.
- **Entities**: plugin-managed entities stored in plugin tables.
- **Config**: per-plugin configuration set by operator.
- **Logs**: plugin worker stdout/stderr captured by host.

### Plugin Event Types

Domain events plugins can subscribe to: `company.created`, `company.updated`, `project.created`, `project.updated`, `project.workspace_created`, `project.workspace_updated`, `project.workspace_deleted`, `issue.created`, `issue.updated`, `issue.comment.created`, `agent.created`, `agent.updated`, `agent.status_changed`, `agent.run.started`, `agent.run.finished`, `agent.run.failed`, `agent.run.cancelled`, `goal.created`, `goal.updated`, `approval.created`, `approval.decided`, `cost_event.created`, `activity.logged`.

### UI Contributions

UI extension slot types: `page`, `detailTab`, `taskDetailView`, `dashboardWidget`, `sidebar`, `sidebarPanel`, `projectSidebarItem`, `globalToolbarButton`, `toolbarButton`, `contextMenuItem`, `commentAnnotation`, `commentContextMenuItem`, `settingsPage`.

Launcher placement zones mirror slot types. Launcher actions: `navigate`, `openModal`, `openDrawer`, `openPopover`, `performAction`, `deepLink`.

Launcher bounds: `inline`, `compact`, `default`, `wide`, `full`.

Render environments: `hostInline`, `hostOverlay`, `hostRoute`, `external`, `iframe`.

Detail tab entity types: `project`, `issue`, `agent`, `goal`, `run`, `comment`.

### Plugin Bridge Error Codes

`WORKER_UNAVAILABLE`, `CAPABILITY_DENIED`, `WORKER_ERROR`, `TIMEOUT`, `UNKNOWN`.

---

## 8. CLI

Base command: `pnpm paperclipai` (dev) or `paperclipai` (installed).

### Top-Level Commands

| Command | Purpose |
|---------|---------|
| `onboard` | Interactive first-time setup. Sets deployment mode, server config, database. |
| `doctor` | Diagnose instance health, check adapter environments, verify config. |
| `env` | Show/manage environment configuration. |
| `configure` | Configure specific sections: `--section server`, `--section storage`. |
| `db:backup` | Trigger database backup. |
| `allowed-hostname <hostname>` | Allow an additional hostname for authenticated/private mode (e.g., Tailscale DNS). |
| `run` | Start the Paperclip server (API + UI). Options: `--instance <name>`, `--data-dir <path>`. |
| `auth bootstrap-ceo` | Generate the first admin invite URL for authenticated mode. |

### Heartbeat Command

```sh
paperclipai heartbeat run --agent-id <id> [--api-base <url>] [--api-key <token>] [--source <source>] [--timeout-ms <ms>]
```

### Client Subcommands

All support: `--data-dir`, `--api-base`, `--api-key`, `--context`, `--profile`, `--json`. Company-scoped commands also support `--company-id`.

| Command | Operations |
|---------|-----------|
| `context` | `set`, `show`, `list`, `use <profile>` -- manage local defaults in `~/.paperclip/context.json`. |
| `company` | `list`, `get <id>`, `delete <id> --yes --confirm <id>` |
| `issue` | `list`, `get <id>`, `create`, `update <id>`, `comment <id>`, `checkout <id>`, `release <id>` |
| `agent` | `list`, `get <id>`, `local-cli <id-or-shortname>` |
| `approval` | `list`, `get <id>`, `create`, `approve <id>`, `reject <id>`, `request-revision <id>`, `resubmit <id>`, `comment <id>` |
| `activity` | `list` with filters: `--agent-id`, `--entity-type`, `--entity-id` |
| `dashboard` | `get` |
| `auth` | `bootstrap-ceo` |
| `plugin` | Plugin management (install, list, etc.) |
| `worktree` | Git worktree management for agent workspaces |

### `agent local-cli`

Quick local agent setup:
- Creates a new long-lived agent API key
- Installs Paperclip skills into `~/.codex/skills` and `~/.claude/skills`
- Prints `export` lines for `PAPERCLIP_API_URL`, `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_AGENT_ID`, `PAPERCLIP_API_KEY`

### Local Storage Layout

Default instance root: `~/.paperclip/instances/default/`

| Path | Content |
|------|---------|
| `config.json` | Instance configuration |
| `db/` | Embedded PostgreSQL data |
| `logs/` | Server logs |
| `data/storage/` | File/object storage |
| `data/backups/` | Database backups |
| `secrets/master.key` | Encryption master key |

Override with env vars: `PAPERCLIP_HOME=/custom/home`, `PAPERCLIP_INSTANCE_ID=dev`.

---

## 9. Onboarding Assets

CEO and default agent instruction bundles shipped at `server/src/onboarding-assets/`.

### Bundle Configuration

Defined in `server/src/services/default-agent-instructions.ts`:

```typescript
const DEFAULT_AGENT_BUNDLE_FILES = {
  default: ["AGENTS.md"],
  ceo: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
};
```

### CEO Bundle

Located at `server/src/onboarding-assets/ceo/`:

| File | Content Summary |
|------|----------------|
| `AGENTS.md` | CEO responsibilities: delegation rules (code/bugs -> CTO, marketing -> CMO, UX -> Designer), what CEO does personally (priorities, cross-team conflicts, board communication, hiring), memory/planning requirements (use `para-memory-files` skill). |
| `HEARTBEAT.md` | 8-step heartbeat checklist: (1) Identity + context, (2) Local planning check (read daily plan, review blockers), (3) Approval follow-up, (4) Get assignments, (5) Checkout and work, (6) Delegation (create subtasks with parentId + goalId), (7) Check on reports, (8) End-of-day summary. |
| `SOUL.md` | CEO persona definition. **Strategic posture**: own the P&L, default to action, hold long view while executing near term, protect focus, optimize for learning speed, know the numbers cold, think in constraints, hire slow fire fast, create organizational clarity, pull for bad news, stay close to customer, be replaceable in operations. **Voice/tone**: be direct, write like a board meeting, confident not performative, match intensity to stakes, skip corporate warm-up, plain language, own uncertainty, disagree openly, keep praise specific and rare, async-friendly formatting. |
| `TOOLS.md` | Placeholder for tool notes. Populated as agent acquires and uses tools. |

### Default Bundle

Located at `server/src/onboarding-assets/default/`:

| File | Content Summary |
|------|----------------|
| `AGENTS.md` | Minimal agent instructions: keep work moving, ask for reviews/unblocking, don't let work sit idle, always update task with a comment. |

---

## 10. Governance Model

### Board Powers (Always Available)

The Board has **unrestricted access** to the entire system at all times:

- **Set and modify Company budgets** -- top-level token/LLM cost budgets
- **Pause/resume any Agent** -- stop heartbeat immediately
- **Pause/resume any work item** -- pause task, project, subtask tree, milestone
- **Full project management access** -- create, edit, comment on, modify, delete, reassign any task/project/milestone
- **Override any Agent decision** -- reassign tasks, change priorities, modify descriptions
- **Manually change any budget** at any level

### Approval-Gated Actions

Approval types (`APPROVAL_TYPES`):

| Type | Gate |
|------|------|
| `hire_agent` | Creating new agents requires board approval |
| `approve_ceo_strategy` | CEO's initial strategic breakdown requires board sign-off |
| `budget_override_required` | Budget changes beyond threshold need approval |

Approval statuses: `pending` -> `revision_requested` / `approved` / `rejected` / `cancelled`.

### Conservative Defaults

- `requireBoardApprovalForNewAgents: true` by default (in company-mode).
- In task-mode: `requireBoardApprovalForNewAgents: false` by default, PM gets `canCreateAgents: true`.

### Budget Enforcement

Three tiers:
1. **Visibility** -- dashboards showing spend at every level
2. **Soft alerts** -- configurable thresholds (e.g., warn at 50%, 80%)
3. **Hard ceiling** -- auto-pause the agent when budget is hit. Board notified. Board can override/raise.

Budget scope types: `company`, `agent`, `project`.
Budget metrics: `billed_cents`.
Budget window kinds: `calendar_month_utc`, `lifetime`.
Budget threshold types: `soft`, `hard`.

---

## 11. Product Roadmap

### Phase 1 (V1) -- Must-Haves

- Company lifecycle (CRUD, archive)
- Agent lifecycle with org structure and adapter configuration
- Goal hierarchy linked to company mission
- Task lifecycle with parent/child hierarchy and comments
- Atomic task checkout and explicit status transitions
- Board approvals for hires and CEO strategy
- Heartbeat invocation, status tracking, cancellation
- Cost event ingestion and rollups (agent/task/project/company)
- Budget settings and hard-stop enforcement
- Board web UI (dashboard, org chart, tasks, agents, approvals, costs)
- Agent-facing API contract
- Auditable activity log for all mutations
- Multiple adapter types (process, HTTP, Claude, Codex, Cursor, OpenCode, etc.)
- One-command dev setup with embedded PostgreSQL
- Agent auth (connection string with API key)

### Phase 1 -- Out of Scope

- Plugin framework and third-party extension SDK (now shipped)
- Revenue/expense accounting beyond model/token costs
- Knowledge base subsystem
- Public marketplace (ClipHub)
- Multi-board governance or role-based human permission granularity
- Automatic self-healing orchestration

### Task-Mode Phase 1

- UI rename (Company -> Task, CEO -> PM, Monthly Budget -> Total Budget)
- Workspace path field + `.paperclip/` artifacts directory
- Role library config files (`packages/shared/src/roles/`) + per-hire customization
- PM auto-hire + auto-start on Task creation
- TSK-0 auto-created (root issue owned by PM)
- Hierarchical escalation with partial answers + translation
- Per-agent git branches + EM merging (local only)
- Budget hard stop + 50%/80% warnings
- Generic structured issue output + final PM report
- BD <-> PM chat via TSK-0 comments
- "Refresh Workspace" button

### Task-Mode Phase 2

- Full rename in DB/API (companies -> tasks)
- PR creation + remote git push
- Slack/Email notifications
- Soft + hard budget limits
- Reopen with budget delta
- Per-role command whitelists / sandboxing

### Future Roadmap

| Area | Items |
|------|-------|
| **ClipHub Marketplace** | Public registry for company templates. Browse, search (semantic), install, fork, star, comment. Template + agent + team sub-packages. Versioning (semver). GitHub OAuth. Moderation. |
| **Multi-Board Governance** | Multi-member boards, hiring budgets (auto-approve within limits), delegated authority. |
| **Cloud Hosting** | Hosted deployment mode. Remote agents connect to cloud Paperclip instance. |
| **Advanced Budgets** | Per-day/week/month/rolling budget periods. Revenue/expense tracking (plugin). |
| **Notifications** | Slack, email notifications for approvals, budget incidents, agent status changes. |
| **Knowledge Base** | Plugin-based. Vector DB, wiki, shared docs. Clean API boundaries already designed for this. |
| **Advanced Task Model** | Workflow states (per-team custom workflows with fixed categories), labels/tags, milestones, initiatives, estimates, issue relations (blocks/blocked_by/duplicate/related). |
| **Plugin Marketplace** | Cloud-ready plugin distribution, cross-node coordination, plugin asset uploads. |
| **Open Company** | Public-facing job boards, open company visibility features. |
| **Workspace Enhancements** | Git worktrees, preview servers, PR links, external review tool integration. |

---

## Appendix A: Adapter Type Constants

Source: `packages/shared/src/constants.ts`

```typescript
export const AGENT_ADAPTER_TYPES = [
  "process",
  "http",
  "claude_local",
  "codex_local",
  "opencode_local",
  "pi_local",
  "cursor",
  "openclaw_gateway",
  "hermes_local",
] as const;
```

## Appendix B: Live Event Types

```typescript
export const LIVE_EVENT_TYPES = [
  "heartbeat.run.queued",
  "heartbeat.run.status",
  "heartbeat.run.event",
  "heartbeat.run.log",
  "agent.status",
  "activity.logged",
  "plugin.ui.updated",
  "plugin.worker.crashed",
  "plugin.worker.restarted",
] as const;
```

## Appendix C: Finance Event Kinds

```typescript
export const FINANCE_EVENT_KINDS = [
  "inference_charge", "platform_fee", "credit_purchase", "credit_refund",
  "credit_expiry", "byok_fee", "gateway_overhead", "log_storage_charge",
  "logpush_charge", "provisioned_capacity_charge", "training_charge",
  "custom_model_import_charge", "custom_model_storage_charge", "manual_adjustment",
] as const;
```

## Appendix D: Key File Paths

| Path | Purpose |
|------|---------|
| `packages/shared/src/constants.ts` | All enum constants (statuses, types, roles, etc.) |
| `packages/shared/src/roles/index.ts` | Task-mode role library definitions |
| `packages/shared/src/types/` | Shared type definitions for all domain entities |
| `packages/shared/src/api.ts` | API path constants |
| `packages/shared/src/config-schema.ts` | Zod schemas for instance configuration |
| `packages/shared/src/validators/` | Input validation schemas |
| `packages/adapter-utils/src/types.ts` | `ServerAdapterModule` interface and all adapter types |
| `server/src/adapters/registry.ts` | Adapter registry (maps type string to module) |
| `server/src/onboarding-assets/` | CEO and default agent instruction bundles |
| `server/src/services/default-agent-instructions.ts` | `AGENT_ROLE_TO_TASK_ROLE` mapping, bundle generation |
| `skills/paperclip/SKILL.md` | Core Paperclip skill (heartbeat procedure, API reference) |
| `skills/para-memory-files/SKILL.md` | PARA memory system skill |
| `skills/paperclip-create-agent/SKILL.md` | Agent creation skill |
| `skills/paperclip-create-plugin/SKILL.md` | Plugin scaffolding skill |
| `ui/src/App.tsx` | UI entry point and full route table |
| `ui/src/lib/queryKeys.ts` | TanStack Query key structure |
| `ui/src/context/` | All React context providers |
| `ui/src/api/` | All API client modules |
| `doc/SPEC.md` | Long-horizon product specification |
| `doc/SPEC-implementation.md` | V1 implementation contract |
| `doc/PRODUCT.md` | Product definition |
| `doc/GOAL.md` | Vision and mission |
| `doc/TASKS.md` | Task management data model |
| `doc/plugins/PLUGIN_SPEC.md` | Full plugin system specification |
| `doc/task-mode-solution.md` | Task-mode solution document |
| `doc/CLI.md` | CLI reference |
| `doc/CLIPHUB.md` | ClipHub marketplace specification |
