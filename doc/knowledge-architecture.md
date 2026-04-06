# Paperclip: Engineering Architecture Reference

This document is a comprehensive reference for the Paperclip codebase covering system architecture, tech stack, data model, server API, authentication, real-time events, and deployment. It is intended for engineers who need to become experts on this system.

---

## 1. System Overview

Paperclip is a control plane for AI-agent companies. It orchestrates teams of AI agents with org charts, budgets, governance, goal alignment, and agent coordination.

### Three-Layer Stack

```
DB Schema (packages/db)  -->  Express API (server/)  -->  React UI (ui/)
        ^                          ^                          ^
        |                          |                          |
   PostgreSQL 17            Express 5 REST +           React 19 SPA
   Drizzle ORM              WebSocket live         Vite 6 + Tailwind 4
                              events               TanStack Query
```

`packages/shared/` provides types, constants, and validators used across all three layers.

### Monorepo Structure

| Package | Purpose |
|---------|---------|
| `server/` | Express 5 REST API, WebSocket live events, orchestration services |
| `ui/` | React 19 + Vite 6 SPA (Tailwind CSS 4) |
| `cli/` | Admin CLI (`pnpm paperclipai <command>`) |
| `packages/db/` | Drizzle ORM schema, migrations, DB clients (PostgreSQL 17) |
| `packages/shared/` | Shared types, constants, validators, API path constants |
| `packages/adapters/` | Agent adapter implementations (Claude, Codex, Cursor, Gemini, OpenClaw, etc.) |
| `packages/adapter-utils/` | Shared adapter utilities |
| `packages/plugins/` | Plugin system (SDK, examples, scaffolding) |

---

## 2. Tech Stack

| Technology | Version | Role |
|------------|---------|------|
| Node.js | 20+ | Runtime |
| pnpm | 9+ | Package manager (workspace monorepo) |
| TypeScript | -- | Language across all packages |
| Express | 5 | HTTP server framework |
| React | 19 | UI framework |
| Vite | 6 | UI build tool and dev server |
| Tailwind CSS | 4 | Utility-first CSS |
| Drizzle ORM | -- | Type-safe SQL query builder and migration tool |
| PostgreSQL | 17 | Primary database (embedded or external) |
| better-auth | -- | Board user authentication (sessions, accounts) |
| WebSocket (ws) | -- | Real-time server-to-client events |
| Zod | -- | Runtime schema validation |
| TanStack Query | -- | Client-side data fetching and caching |
| React Router | -- | Client-side page routing |
| Vitest | -- | Unit/integration testing |
| Playwright | -- | End-to-end testing |
| pino (via logger) | -- | Structured logging |

---

## 3. Database

### Connection Modes

| Mode | Trigger | Details |
|------|---------|---------|
| `embedded-postgres` | `DATABASE_URL` unset (default) | Auto-starts PostgreSQL 17, data at `~/.paperclip/instances/default/db/`, port 54329 |
| `postgres` | `DATABASE_URL` set or config file `database.mode: postgres` | Connects to external PostgreSQL instance |

### Migration System

- Schema defined in `packages/db/src/schema/*.ts`
- Drizzle generates SQL migrations via `pnpm db:generate` (compiles TS to JS first since `drizzle.config.ts` reads `dist/schema/*.js`)
- Apply with `pnpm db:migrate`
- After schema changes: edit schema -> export from `index.ts` -> `pnpm db:generate` -> `pnpm -r typecheck`

### Database Backup

- Enabled by default for embedded-postgres mode
- Configurable interval (default 60 minutes) and retention (default 30 days)
- Backup directory at `~/.paperclip/instances/default/backups/`

---

### Tables by Domain

#### Companies

##### `companies`
Core organization entity. Every other entity belongs to a company.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | auto-generated |
| `name` | text | NOT NULL |
| `description` | text | |
| `workspace_path` | text | filesystem path for company workspace |
| `status` | text | `active`, `paused`, `archived` (default: `active`) |
| `pause_reason` | text | |
| `paused_at` | timestamptz | |
| `issue_prefix` | text | NOT NULL, default `PAP`, unique index |
| `issue_counter` | integer | auto-increment for issue numbering |
| `budget_monthly_cents` | integer | company-level monthly budget |
| `spent_monthly_cents` | integer | current month spend |
| `require_board_approval_for_new_agents` | boolean | default true |
| `brand_color` | text | |
| `task_report` | text | |
| `task_report_submitted_at` | timestamptz | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Indexes:** unique on `issue_prefix`.

##### `company_logos`
Links a company to an uploaded logo asset.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | unique |
| `asset_id` | uuid FK -> assets | unique |

##### `company_memberships`
Tracks user and agent membership in companies.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `principal_type` | text | `user` or `agent` |
| `principal_id` | text | |
| `status` | text | `pending`, `active`, `suspended` (default: `active`) |
| `membership_role` | text | |

**Indexes:** unique on `(company_id, principal_type, principal_id)`.

##### `company_skills`
Skill documents imported into a company (e.g., markdown guides).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `key` | text | unique per company |
| `slug` | text | |
| `name` | text | |
| `description` | text | |
| `markdown` | text | full skill content |
| `source_type` | text | `local_path` (default) |
| `source_locator` | text | |
| `source_ref` | text | |
| `trust_level` | text | `markdown_only` (default) |
| `compatibility` | text | `compatible` (default) |
| `file_inventory` | jsonb | array of file records |
| `metadata` | jsonb | |

**Indexes:** unique on `(company_id, key)`.

---

#### Agents

##### `agents`
AI agent definitions with adapter configuration and organizational position.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `name` | text | NOT NULL |
| `role` | text | `ceo`, `cto`, `cmo`, `cfo`, `engineer`, `designer`, `pm`, `qa`, `devops`, `researcher`, `general` (default: `general`) |
| `title` | text | |
| `icon` | text | |
| `status` | text | `active`, `paused`, `idle`, `running`, `error`, `pending_approval`, `terminated` (default: `idle`) |
| `reports_to` | uuid FK -> agents (self) | org chart hierarchy |
| `capabilities` | text | |
| `adapter_type` | text | `process`, `http`, `claude_local`, `codex_local`, `opencode_local`, `pi_local`, `cursor`, `openclaw_gateway`, `hermes_local` (default: `process`) |
| `adapter_config` | jsonb | adapter-specific configuration |
| `runtime_config` | jsonb | runtime parameters |
| `budget_monthly_cents` | integer | agent-level monthly budget |
| `spent_monthly_cents` | integer | current month spend |
| `pause_reason` | text | `manual`, `budget`, `system` |
| `paused_at` | timestamptz | |
| `permissions` | jsonb | agent permission map |
| `git_branch` | text | |
| `last_heartbeat_at` | timestamptz | |
| `metadata` | jsonb | |

**Indexes:** `(company_id, status)`, `(company_id, reports_to)`.

##### `agent_api_keys`
SHA256-hashed bearer tokens for agent authentication.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `agent_id` | uuid FK -> agents | |
| `company_id` | uuid FK -> companies | |
| `name` | text | |
| `key_hash` | text | SHA256 hex digest of raw token |
| `last_used_at` | timestamptz | |
| `revoked_at` | timestamptz | null = active |

**Indexes:** `key_hash`, `(company_id, agent_id)`.

##### `agent_config_revisions`
Audit trail of agent configuration changes.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `agent_id` | uuid FK -> agents | cascade on delete |
| `created_by_agent_id` | uuid FK -> agents | |
| `created_by_user_id` | text | |
| `source` | text | `patch` (default) |
| `rolled_back_from_revision_id` | uuid | |
| `changed_keys` | jsonb | string array |
| `before_config` | jsonb | |
| `after_config` | jsonb | |

##### `agent_runtime_state`
Live runtime state per agent (session, tokens, costs).

| Column | Type | Notes |
|--------|------|-------|
| `agent_id` | uuid PK, FK -> agents | one row per agent |
| `company_id` | uuid FK -> companies | |
| `adapter_type` | text | |
| `session_id` | text | |
| `state_json` | jsonb | |
| `last_run_id` | uuid | |
| `last_run_status` | text | |
| `total_input_tokens` | bigint | |
| `total_output_tokens` | bigint | |
| `total_cached_input_tokens` | bigint | |
| `total_cost_cents` | bigint | |
| `last_error` | text | |

##### `agent_task_sessions`
Per-agent, per-task adapter session tracking.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `agent_id` | uuid FK -> agents | |
| `adapter_type` | text | |
| `task_key` | text | |
| `session_params_json` | jsonb | |
| `session_display_id` | text | |
| `last_run_id` | uuid FK -> heartbeat_runs | |

**Indexes:** unique on `(company_id, agent_id, adapter_type, task_key)`.

##### `agent_wakeup_requests`
Queue of pending wakeup requests for agents.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `agent_id` | uuid FK -> agents | |
| `source` | text | |
| `trigger_detail` | text | `manual`, `ping`, `callback`, `system` |
| `reason` | text | |
| `payload` | jsonb | |
| `status` | text | `queued`, `deferred_issue_execution`, `claimed`, `coalesced`, `skipped`, `completed`, `failed`, `cancelled` |
| `coalesced_count` | integer | |
| `idempotency_key` | text | |
| `run_id` | uuid | linked heartbeat run |

**Indexes:** `(company_id, agent_id, status)`.

---

#### Issues (Tasks)

##### `issues`
Core task/issue entity. Assigned to one agent at a time (single-assignee model).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `project_id` | uuid FK -> projects | |
| `project_workspace_id` | uuid FK -> project_workspaces | |
| `goal_id` | uuid FK -> goals | |
| `parent_id` | uuid FK -> issues (self) | sub-task hierarchy |
| `title` | text | NOT NULL |
| `description` | text | |
| `status` | text | `backlog`, `todo`, `in_progress`, `in_review`, `done`, `blocked`, `cancelled` (default: `backlog`) |
| `priority` | text | `critical`, `high`, `medium`, `low` (default: `medium`) |
| `assignee_agent_id` | uuid FK -> agents | single agent assignee |
| `assignee_user_id` | text | human assignee |
| `checkout_run_id` | uuid FK -> heartbeat_runs | atomic checkout lock |
| `execution_run_id` | uuid FK -> heartbeat_runs | |
| `execution_agent_name_key` | text | |
| `execution_locked_at` | timestamptz | |
| `created_by_agent_id` | uuid FK -> agents | |
| `created_by_user_id` | text | |
| `issue_number` | integer | |
| `identifier` | text | e.g., `PAP-42` (unique) |
| `origin_kind` | text | `manual`, `routine_execution` (default: `manual`) |
| `origin_id` | text | |
| `origin_run_id` | text | |
| `request_depth` | integer | sub-task depth |
| `billing_code` | text | |
| `assignee_adapter_overrides` | jsonb | |
| `execution_workspace_id` | uuid FK -> execution_workspaces | |
| `execution_workspace_preference` | text | |
| `execution_workspace_settings` | jsonb | |
| `started_at` | timestamptz | |
| `completed_at` | timestamptz | |
| `cancelled_at` | timestamptz | |
| `hidden_at` | timestamptz | |

**Indexes:** `(company_id, status)`, `(company_id, assignee_agent_id, status)`, `(company_id, parent_id)`, `(company_id, project_id)`, unique on `identifier`, partial unique on open routine executions.

##### `issue_comments`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `issue_id` | uuid FK -> issues | |
| `author_agent_id` | uuid FK -> agents | |
| `author_user_id` | text | |
| `body` | text | |

##### `issue_labels`
Join table linking issues to labels.

| Column | Type | Notes |
|--------|------|-------|
| `issue_id` | uuid FK -> issues | composite PK |
| `label_id` | uuid FK -> labels | composite PK |
| `company_id` | uuid FK -> companies | |

##### `labels`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `name` | text | unique per company |
| `color` | text | |

##### `issue_attachments`
Links issues to uploaded assets.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `issue_id` | uuid FK -> issues | cascade |
| `asset_id` | uuid FK -> assets | cascade, unique |
| `issue_comment_id` | uuid FK -> issue_comments | |

##### `issue_approvals`
Links issues to approval gates.

| Column | Type | Notes |
|--------|------|-------|
| `issue_id` | uuid FK -> issues | composite PK |
| `approval_id` | uuid FK -> approvals | composite PK |
| `company_id` | uuid FK -> companies | |
| `linked_by_agent_id` | uuid FK -> agents | |
| `linked_by_user_id` | text | |

##### `issue_read_states`
Tracks per-user read timestamps on issues.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `issue_id` | uuid FK -> issues | |
| `user_id` | text | |
| `last_read_at` | timestamptz | |

**Indexes:** unique on `(company_id, issue_id, user_id)`.

##### `issue_inbox_archives`
User-specific inbox archive state.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `issue_id` | uuid FK -> issues | |
| `user_id` | text | |
| `archived_at` | timestamptz | |

**Indexes:** unique on `(company_id, issue_id, user_id)`.

##### `issue_work_products`
Work products (PRs, deployments, etc.) linked to issues.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `project_id` | uuid FK -> projects | |
| `issue_id` | uuid FK -> issues | cascade |
| `execution_workspace_id` | uuid FK -> execution_workspaces | |
| `runtime_service_id` | uuid FK -> workspace_runtime_services | |
| `type` | text | e.g., `pull_request`, `deployment` |
| `provider` | text | e.g., `github`, `local` |
| `external_id` | text | |
| `title` | text | |
| `url` | text | |
| `status` | text | |
| `review_state` | text | default `none` |
| `is_primary` | boolean | |
| `health_status` | text | default `unknown` |
| `summary` | text | |
| `metadata` | jsonb | |
| `created_by_run_id` | uuid FK -> heartbeat_runs | |

---

#### Documents

##### `documents`
Rich-text documents attached to issues via `issue_documents`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `title` | text | |
| `format` | text | `markdown` (default) |
| `latest_body` | text | current content |
| `latest_revision_id` | uuid | |
| `latest_revision_number` | integer | |
| `created_by_agent_id` | uuid FK -> agents | |
| `created_by_user_id` | text | |

##### `document_revisions`
Immutable revision history for documents.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `document_id` | uuid FK -> documents | cascade |
| `revision_number` | integer | unique per document |
| `title` | text | |
| `format` | text | |
| `body` | text | |
| `change_summary` | text | |

##### `issue_documents`
Join table linking issues to documents with a string key.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `issue_id` | uuid FK -> issues | cascade |
| `document_id` | uuid FK -> documents | cascade, unique |
| `key` | text | unique per `(company_id, issue_id)` |

---

#### Projects

##### `projects`
Project container that groups issues under a goal with a lead agent.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `goal_id` | uuid FK -> goals | |
| `name` | text | NOT NULL |
| `description` | text | |
| `status` | text | `backlog`, `planned`, `in_progress`, `completed`, `cancelled` (default: `backlog`) |
| `lead_agent_id` | uuid FK -> agents | |
| `target_date` | date | |
| `color` | text | |
| `pause_reason` | text | |
| `execution_workspace_policy` | jsonb | |
| `archived_at` | timestamptz | |

##### `project_workspaces`
Workspace definitions for projects (source repos, directories).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `project_id` | uuid FK -> projects | cascade |
| `name` | text | |
| `source_type` | text | `local_path` (default) |
| `cwd` | text | filesystem path |
| `repo_url` | text | |
| `repo_ref` | text | |
| `default_ref` | text | |
| `visibility` | text | `default` |
| `setup_command` | text | |
| `cleanup_command` | text | |
| `remote_provider` | text | |
| `remote_workspace_ref` | text | |
| `shared_workspace_key` | text | |
| `is_primary` | boolean | |

##### `project_goals`
Many-to-many join between projects and goals.

| Column | Type | Notes |
|--------|------|-------|
| `project_id` | uuid FK -> projects | composite PK |
| `goal_id` | uuid FK -> goals | composite PK |
| `company_id` | uuid FK -> companies | |

---

#### Goals

##### `goals`
Hierarchical goal tree (company -> team -> agent -> task).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `title` | text | NOT NULL |
| `description` | text | |
| `level` | text | `company`, `team`, `agent`, `task` (default: `task`) |
| `status` | text | `planned`, `active`, `achieved`, `cancelled` (default: `planned`) |
| `parent_id` | uuid FK -> goals (self) | |
| `owner_agent_id` | uuid FK -> agents | |

---

#### Approvals

##### `approvals`
Approval workflow records for governed actions.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `type` | text | `hire_agent`, `approve_ceo_strategy`, `budget_override_required` |
| `requested_by_agent_id` | uuid FK -> agents | |
| `requested_by_user_id` | text | |
| `status` | text | `pending`, `revision_requested`, `approved`, `rejected`, `cancelled` (default: `pending`) |
| `payload` | jsonb | |
| `decision_note` | text | |
| `decided_by_user_id` | text | |
| `decided_at` | timestamptz | |

**Indexes:** `(company_id, status, type)`.

##### `approval_comments`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `approval_id` | uuid FK -> approvals | |
| `author_agent_id` | uuid FK -> agents | |
| `author_user_id` | text | |
| `body` | text | |

---

#### Budgets & Costs

##### `budget_policies`
Configurable budget rules per scope (company, agent, project).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `scope_type` | text | `company`, `agent`, `project` |
| `scope_id` | uuid | |
| `metric` | text | `billed_cents` (default) |
| `window_kind` | text | `calendar_month_utc`, `lifetime` |
| `amount` | integer | budget limit in cents |
| `warn_percent` | integer | default 80 |
| `hard_stop_enabled` | boolean | default true |
| `notify_enabled` | boolean | default true |
| `is_active` | boolean | default true |

**Indexes:** unique on `(company_id, scope_type, scope_id, metric, window_kind)`.

##### `budget_incidents`
Records when a budget threshold is breached.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `policy_id` | uuid FK -> budget_policies | |
| `scope_type` | text | |
| `scope_id` | uuid | |
| `threshold_type` | text | `soft`, `hard` |
| `amount_limit` | integer | |
| `amount_observed` | integer | |
| `status` | text | `open`, `resolved`, `dismissed` (default: `open`) |
| `approval_id` | uuid FK -> approvals | |

##### `cost_events`
Individual cost/usage events from agent runs.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `agent_id` | uuid FK -> agents | |
| `issue_id` | uuid FK -> issues | |
| `project_id` | uuid FK -> projects | |
| `goal_id` | uuid FK -> goals | |
| `heartbeat_run_id` | uuid FK -> heartbeat_runs | |
| `billing_code` | text | |
| `provider` | text | e.g., `anthropic`, `openai` |
| `biller` | text | |
| `billing_type` | text | `metered_api`, `subscription_included`, `credits`, `fixed`, `unknown` |
| `model` | text | |
| `input_tokens` | integer | |
| `cached_input_tokens` | integer | |
| `output_tokens` | integer | |
| `cost_cents` | integer | |
| `occurred_at` | timestamptz | |

##### `finance_events`
Detailed financial ledger events (debits and credits).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `agent_id` | uuid FK -> agents | |
| `issue_id` | uuid FK -> issues | |
| `project_id` | uuid FK -> projects | |
| `goal_id` | uuid FK -> goals | |
| `heartbeat_run_id` | uuid FK -> heartbeat_runs | |
| `cost_event_id` | uuid FK -> cost_events | |
| `event_kind` | text | `inference_charge`, `platform_fee`, `credit_purchase`, `credit_refund`, `manual_adjustment`, etc. |
| `direction` | text | `debit`, `credit` |
| `biller` | text | |
| `provider` | text | |
| `model` | text | |
| `amount_cents` | integer | |
| `currency` | text | `USD` (default) |
| `estimated` | boolean | |
| `occurred_at` | timestamptz | |

---

#### Heartbeats (Agent Runs)

##### `heartbeat_runs`
Each row is one agent invocation/run.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `agent_id` | uuid FK -> agents | |
| `invocation_source` | text | `timer`, `assignment`, `on_demand`, `automation` |
| `trigger_detail` | text | |
| `status` | text | `queued`, `running`, `succeeded`, `failed`, `cancelled`, `timed_out` (default: `queued`) |
| `started_at` | timestamptz | |
| `finished_at` | timestamptz | |
| `error` | text | |
| `wakeup_request_id` | uuid FK -> agent_wakeup_requests | |
| `exit_code` | integer | |
| `signal` | text | |
| `usage_json` | jsonb | token usage summary |
| `result_json` | jsonb | |
| `session_id_before` | text | |
| `session_id_after` | text | |
| `log_store` | text | |
| `log_ref` | text | |
| `log_bytes` | bigint | |
| `log_sha256` | text | |
| `log_compressed` | boolean | |
| `stdout_excerpt` | text | |
| `stderr_excerpt` | text | |
| `error_code` | text | |
| `external_run_id` | text | |
| `process_pid` | integer | |
| `retry_of_run_id` | uuid FK -> heartbeat_runs (self) | |
| `process_loss_retry_count` | integer | |
| `context_snapshot` | jsonb | |

**Indexes:** `(company_id, agent_id, started_at)`.

##### `heartbeat_run_events`
Streaming events emitted during a heartbeat run (logs, status, tool calls).

| Column | Type | Notes |
|--------|------|-------|
| `id` | bigserial PK | |
| `company_id` | uuid FK -> companies | |
| `run_id` | uuid FK -> heartbeat_runs | |
| `agent_id` | uuid FK -> agents | |
| `seq` | integer | ordering within run |
| `event_type` | text | |
| `stream` | text | |
| `level` | text | |
| `color` | text | |
| `message` | text | |
| `payload` | jsonb | |

**Indexes:** `(run_id, seq)`.

---

#### Routines

##### `routines`
Recurring automated task definitions.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | cascade |
| `project_id` | uuid FK -> projects | cascade |
| `goal_id` | uuid FK -> goals | |
| `parent_issue_id` | uuid FK -> issues | |
| `title` | text | |
| `assignee_agent_id` | uuid FK -> agents | |
| `priority` | text | `critical`, `high`, `medium`, `low` |
| `status` | text | `active`, `paused`, `archived` (default: `active`) |
| `concurrency_policy` | text | `coalesce_if_active`, `always_enqueue`, `skip_if_active` |
| `catch_up_policy` | text | `skip_missed`, `enqueue_missed_with_cap` |

##### `routine_triggers`
Trigger definitions for routines (cron, webhook, API).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | cascade |
| `routine_id` | uuid FK -> routines | cascade |
| `kind` | text | `schedule`, `webhook`, `api` |
| `enabled` | boolean | |
| `cron_expression` | text | for schedule triggers |
| `timezone` | text | |
| `next_run_at` | timestamptz | |
| `public_id` | text | unique, for webhook URL |
| `secret_id` | uuid FK -> company_secrets | for webhook signing |
| `signing_mode` | text | `bearer`, `hmac_sha256` |
| `replay_window_sec` | integer | |

##### `routine_runs`
Execution history for routine triggers.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | cascade |
| `routine_id` | uuid FK -> routines | cascade |
| `trigger_id` | uuid FK -> routine_triggers | |
| `source` | text | `schedule`, `manual`, `api`, `webhook` |
| `status` | text | `received`, `coalesced`, `skipped`, `issue_created`, `completed`, `failed` |
| `triggered_at` | timestamptz | |
| `idempotency_key` | text | |
| `trigger_payload` | jsonb | |
| `linked_issue_id` | uuid FK -> issues | |
| `coalesced_into_run_id` | uuid | |

---

#### Execution Workspaces

##### `execution_workspaces`
Isolated workspace instances for task execution (branches, worktrees).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `project_id` | uuid FK -> projects | cascade |
| `project_workspace_id` | uuid FK -> project_workspaces | |
| `source_issue_id` | uuid FK -> issues | |
| `mode` | text | |
| `strategy_type` | text | |
| `name` | text | |
| `status` | text | default `active` |
| `cwd` | text | filesystem path |
| `repo_url` | text | |
| `base_ref` | text | |
| `branch_name` | text | |
| `provider_type` | text | `local_fs` (default) |
| `derived_from_execution_workspace_id` | uuid FK -> self | |
| `closed_at` | timestamptz | |

##### `workspace_operations`
Shell operations run during workspace setup/teardown.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `execution_workspace_id` | uuid FK -> execution_workspaces | |
| `heartbeat_run_id` | uuid FK -> heartbeat_runs | |
| `phase` | text | |
| `command` | text | |
| `cwd` | text | |
| `status` | text | `running` (default) |
| `exit_code` | integer | |
| `log_store` | text | |
| `log_ref` | text | |

##### `workspace_runtime_services`
Long-lived services running in workspaces (dev servers, etc.).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `project_id` | uuid FK -> projects | |
| `project_workspace_id` | uuid FK -> project_workspaces | |
| `execution_workspace_id` | uuid FK -> execution_workspaces | |
| `issue_id` | uuid FK -> issues | |
| `scope_type` | text | |
| `service_name` | text | |
| `status` | text | |
| `lifecycle` | text | |
| `command` | text | |
| `cwd` | text | |
| `port` | integer | |
| `url` | text | |
| `provider` | text | |
| `health_status` | text | default `unknown` |

---

#### Assets

##### `assets`
Uploaded binary files (images, attachments) stored via storage provider.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `provider` | text | storage provider key |
| `object_key` | text | unique per company |
| `content_type` | text | MIME type |
| `byte_size` | integer | |
| `sha256` | text | |
| `original_filename` | text | |
| `created_by_agent_id` | uuid FK -> agents | |
| `created_by_user_id` | text | |

---

#### Secrets

##### `company_secrets`
Metadata for company-scoped secrets.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `name` | text | unique per company |
| `provider` | text | `local_encrypted` (default), `aws_secrets_manager`, `gcp_secret_manager`, `vault` |
| `external_ref` | text | |
| `latest_version` | integer | |
| `description` | text | |

##### `company_secret_versions`
Versioned encrypted secret materials.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `secret_id` | uuid FK -> company_secrets | cascade |
| `version` | integer | unique per secret |
| `material` | jsonb | encrypted payload |
| `value_sha256` | text | |
| `revoked_at` | timestamptz | |

---

#### Plugins

##### `plugins`
Installed plugin registry.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `plugin_key` | text | unique, derived from manifest `id` |
| `package_name` | text | |
| `version` | text | |
| `api_version` | integer | default 1 |
| `categories` | jsonb | array of categories |
| `manifest_json` | jsonb | full plugin manifest |
| `status` | text | `installed`, `ready`, `running`, `stopped`, `error`, `disabled` |
| `install_order` | integer | |
| `package_path` | text | local filesystem path |
| `last_error` | text | |

##### `plugin_config`
Instance-wide plugin configuration (one row per plugin).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `plugin_id` | uuid FK -> plugins | cascade, unique |
| `config_json` | jsonb | operator-provided config |

##### `plugin_company_settings`
Per-company plugin overrides (enable/disable, custom settings).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | cascade |
| `plugin_id` | uuid FK -> plugins | cascade |
| `enabled` | boolean | default true |
| `settings_json` | jsonb | |

**Indexes:** unique on `(company_id, plugin_id)`.

##### `plugin_state`
Scoped key-value storage for plugin workers.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `plugin_id` | uuid FK -> plugins | cascade |
| `scope_kind` | text | `instance`, `company`, `project`, `project_workspace`, `agent`, `issue`, `goal`, `run` |
| `scope_id` | text | null for instance scope |
| `namespace` | text | default `default` |
| `state_key` | text | |
| `value_json` | jsonb | |

**Indexes:** unique on `(plugin_id, scope_kind, scope_id, namespace, state_key)` with NULLS NOT DISTINCT.

##### `plugin_entities`
Structured object mappings between Paperclip entities and external plugin entities.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `plugin_id` | uuid FK -> plugins | cascade |
| `entity_type` | text | |
| `scope_kind` | text | |
| `scope_id` | text | |
| `external_id` | text | unique per `(plugin_id, entity_type)` |
| `title` | text | |
| `status` | text | |
| `data` | jsonb | |

##### `plugin_jobs`
Scheduled job definitions from plugin manifests.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `plugin_id` | uuid FK -> plugins | cascade |
| `job_key` | text | unique per plugin |
| `schedule` | text | cron expression |
| `status` | text | `active`, `paused`, `error` |
| `next_run_at` | timestamptz | |

##### `plugin_job_runs`
Execution history for plugin jobs.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `job_id` | uuid FK -> plugin_jobs | cascade |
| `plugin_id` | uuid FK -> plugins | cascade |
| `trigger` | text | `scheduled`, `manual` |
| `status` | text | `pending`, `running`, `succeeded`, `failed`, `cancelled` |
| `duration_ms` | integer | |
| `error` | text | |
| `logs` | jsonb | string array |

##### `plugin_webhook_deliveries`
Inbound webhook delivery audit log.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `plugin_id` | uuid FK -> plugins | cascade |
| `webhook_key` | text | |
| `external_id` | text | de-duplication ID |
| `status` | text | `pending`, `processing`, `succeeded`, `failed` |
| `duration_ms` | integer | |
| `error` | text | |
| `payload` | jsonb | raw request body |
| `headers` | jsonb | relevant HTTP headers |

##### `plugin_logs`
Structured log entries from plugin workers.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `plugin_id` | uuid FK -> plugins | cascade |
| `level` | text | `info`, `warn`, `error`, etc. |
| `message` | text | |
| `meta` | jsonb | |

---

#### Auth

##### `user` (authUsers)
better-auth user accounts.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `name` | text | |
| `email` | text | |
| `email_verified` | boolean | |
| `image` | text | |

##### `session` (authSessions)
better-auth sessions.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `expires_at` | timestamptz | |
| `token` | text | |
| `ip_address` | text | |
| `user_agent` | text | |
| `user_id` | text FK -> user | cascade |

##### `account` (authAccounts)
OAuth/credential accounts linked to users.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `account_id` | text | |
| `provider_id` | text | |
| `user_id` | text FK -> user | cascade |
| `password` | text | hashed password for credential auth |

##### `verification` (authVerifications)
Email verification tokens.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `identifier` | text | |
| `value` | text | |
| `expires_at` | timestamptz | |

##### `board_api_keys`
Long-lived API keys for board (human) users.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `user_id` | text FK -> user | cascade |
| `name` | text | |
| `key_hash` | text | SHA256, unique |
| `last_used_at` | timestamptz | |
| `revoked_at` | timestamptz | |
| `expires_at` | timestamptz | |

##### `instance_user_roles`
Instance-level admin roles.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `user_id` | text | |
| `role` | text | `instance_admin` (default) |

**Indexes:** unique on `(user_id, role)`.

##### `instance_settings`
Global instance configuration (singleton row).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `singleton_key` | text | unique, default `default` |
| `general` | jsonb | |
| `experimental` | jsonb | |

##### `cli_auth_challenges`
CLI device-flow authentication challenges.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `secret_hash` | text | |
| `command` | text | |
| `client_name` | text | |
| `requested_access` | text | `board` (default) |
| `requested_company_id` | uuid FK -> companies | |
| `pending_key_hash` | text | |
| `pending_key_name` | text | |
| `approved_by_user_id` | text FK -> user | |
| `board_api_key_id` | uuid FK -> board_api_keys | |
| `expires_at` | timestamptz | |

##### `invites`
Invitation links for joining a company.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `invite_type` | text | `company_join`, `bootstrap_ceo` |
| `token_hash` | text | unique |
| `allowed_join_types` | text | `human`, `agent`, `both` |
| `defaults_payload` | jsonb | |
| `expires_at` | timestamptz | |
| `revoked_at` | timestamptz | |
| `accepted_at` | timestamptz | |

##### `join_requests`
Agent/human join requests triggered by invite acceptance.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `invite_id` | uuid FK -> invites | unique |
| `company_id` | uuid FK -> companies | |
| `request_type` | text | `human`, `agent` |
| `status` | text | `pending_approval`, `approved`, `rejected` |
| `agent_name` | text | |
| `adapter_type` | text | |
| `claim_secret_hash` | text | for agent key claiming |
| `created_agent_id` | uuid FK -> agents | |

##### `principal_permission_grants`
Fine-grained permission grants to principals (users/agents).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `principal_type` | text | `user`, `agent` |
| `principal_id` | text | |
| `permission_key` | text | `agents:create`, `users:invite`, `users:manage_permissions`, `tasks:assign`, `tasks:assign_scope`, `joins:approve` |
| `scope` | jsonb | optional scope constraint |
| `granted_by_user_id` | text | |

**Indexes:** unique on `(company_id, principal_type, principal_id, permission_key)`.

---

#### Activity Log

##### `activity_log`
Immutable audit log for all mutations.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `actor_type` | text | `system`, `board`, `agent` |
| `actor_id` | text | |
| `action` | text | e.g., `agent.created`, `issue.updated` |
| `entity_type` | text | |
| `entity_id` | text | |
| `agent_id` | uuid FK -> agents | |
| `run_id` | uuid FK -> heartbeat_runs | |
| `details` | jsonb | |

**Indexes:** `(company_id, created_at)`, `(entity_type, entity_id)`, `run_id`.

---

#### Task Questions

##### `task_questions`
Agent-to-manager escalation protocol for task-mode.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `company_id` | uuid FK -> companies | |
| `issue_id` | uuid FK -> issues | |
| `from_agent_id` | uuid FK -> agents | asking agent |
| `to_agent_id` | uuid FK -> agents | manager (null = human escalation) |
| `root_question_id` | uuid FK -> self | original question in chain |
| `parent_question_id` | uuid FK -> self | one level down |
| `question` | text | |
| `answer` | text | |
| `status` | text | `pending`, `answered`, `escalated`, `abandoned` |
| `retries` | integer | max 3 |
| `answered_at` | timestamptz | |

---

## 4. Server Architecture

### Entry Point

The server entry point is `server/src/index.ts`, which calls `loadConfig()` from `server/src/config.ts` and then creates the app via `createApp()` in `server/src/app.ts`.

### Express 5 App Setup (`app.ts`)

```
createApp(db, opts) -> Express app
```

### Middleware Chain (in order)

1. **`express.json()`** -- Parse JSON bodies with 10MB limit; stores `rawBody` for signature verification
2. **`httpLogger`** -- Structured request/response logging (pino-based)
3. **`privateHostnameGuard`** -- Blocks requests from unrecognized hostnames when `deploymentMode=authenticated` and `deploymentExposure=private`
4. **`actorMiddleware`** -- Resolves the requesting actor (board user, agent, or none) from bearer tokens, sessions, or local_trusted implicit
5. **`boardMutationGuard`** -- CSRF protection: blocks non-GET board mutations that lack a trusted origin/referer header (skipped for `local_implicit` and `board_key` sources)
6. **Route handlers** -- Mounted under `/api`
7. **Plugin UI static routes** -- Serves plugin UI bundles
8. **UI serving** -- Either Vite dev middleware or static file serving
9. **`errorHandler`** -- Final error handler for uncaught exceptions

### Error Handling

The error handler in `server/src/middleware/error-handler.ts` handles:

- **`HttpError`** -- Custom error class with `status`, `message`, and optional `details`. Helper constructors: `badRequest(400)`, `unauthorized(401)`, `forbidden(403)`, `notFound(404)`, `conflict(409)`, `unprocessable(422)`
- **`ZodError`** -- Returns 400 with validation details
- **All other errors** -- Returns 500 "Internal server error"

### Validation Middleware

`server/src/middleware/validate.ts` exports a `validate(schema)` middleware that parses `req.body` with a Zod schema, replacing it with the parsed result or throwing a ZodError.

---

## 5. API Reference

All endpoints are prefixed with `/api`. Auth requirement abbreviations:
- **board** = requires board actor (human user session or board API key)
- **agent** = requires agent actor (agent API key or JWT)
- **any** = board or agent
- **public** = no auth required
- **local** = only in local_trusted mode
- **admin** = requires instance_admin role

### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | public | Health check with deployment info |

### Companies

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/companies` | board | List all companies |
| GET | `/companies/stats` | board | Company statistics |
| GET | `/companies/issues` | -- | Deprecated redirect |
| GET | `/companies/:companyId` | any | Get company by ID |
| POST | `/companies` | board | Create company |
| PATCH | `/companies/:companyId` | board | Update company |
| PATCH | `/companies/:companyId/branding` | board | Update brand color |
| POST | `/companies/:companyId/refresh-workspace` | board | Refresh workspace |
| POST | `/companies/:companyId/archive` | board | Archive company |
| DELETE | `/companies/:companyId` | board | Delete company (when enabled) |
| POST | `/companies/:companyId/export` | board | Export company data |
| POST | `/companies/import/preview` | board | Preview import |
| POST | `/companies/import` | board | Import company |
| POST | `/companies/:companyId/exports/preview` | board | Preview export |
| POST | `/companies/:companyId/exports` | board | Export company data (v2) |
| POST | `/companies/:companyId/imports/preview` | board | Preview import (v2) |
| POST | `/companies/:companyId/imports/apply` | board | Apply import (v2) |
| POST | `/companies/:companyId/logo` | board | Upload company logo |

### Agents

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/companies/:companyId/agents` | any | List agents for company |
| GET | `/companies/:companyId/org` | any | Get org chart data |
| GET | `/companies/:companyId/org.svg` | any | Org chart as SVG |
| GET | `/companies/:companyId/org.png` | any | Org chart as PNG |
| GET | `/companies/:companyId/agent-configurations` | any | List all agent configs |
| GET | `/companies/:companyId/adapters/:type/models` | board | List adapter models |
| GET | `/companies/:companyId/adapters/:type/detect-model` | board | Auto-detect model |
| POST | `/companies/:companyId/agent-hires` | board | Create agent via hire flow (with optional approval) |
| POST | `/companies/:companyId/agents` | board | Create agent directly |
| GET | `/agents/me` | agent | Get current agent's own record |
| GET | `/agents/me/inbox-lite` | agent | Agent's lightweight inbox |
| GET | `/agents/me/inbox/mine` | agent | Agent's assigned issues |
| GET | `/agents/:id` | any | Get agent by ID |
| PATCH | `/agents/:id` | board | Update agent |
| PATCH | `/agents/:id/permissions` | board | Update agent permissions |
| PATCH | `/agents/:id/instructions-path` | board | Set instructions file path |
| GET | `/agents/:id/instructions-bundle` | any | Get instructions bundle |
| PATCH | `/agents/:id/instructions-bundle` | any | Update instructions bundle metadata |
| GET | `/agents/:id/instructions-bundle/file` | any | Get single instruction file |
| PUT | `/agents/:id/instructions-bundle/file` | any | Upsert instruction file |
| DELETE | `/agents/:id/instructions-bundle/file` | any | Delete instruction file |
| GET | `/agents/:id/skills` | any | Get agent's skills |
| POST | `/agents/:id/skills` | any | Install/update agent skills |
| GET | `/agents/:id/configuration` | any | Get agent configuration |
| GET | `/agents/:id/config-revisions` | any | List config revision history |
| GET | `/agents/:id/config-revisions/:revisionId` | any | Get specific revision |
| POST | `/agents/:id/config-revisions/:revisionId/rollback` | board | Rollback to revision |
| GET | `/agents/:id/runtime-state` | any | Get agent runtime state |
| GET | `/agents/:id/task-sessions` | any | List task sessions |
| POST | `/agents/:id/runtime-state/reset-session` | board | Reset agent session |
| POST | `/agents/:id/pause` | board | Pause agent |
| POST | `/agents/:id/resume` | board | Resume agent |
| POST | `/agents/:id/terminate` | board | Terminate agent |
| DELETE | `/agents/:id` | board | Delete agent |
| GET | `/agents/:id/keys` | board | List agent API keys |
| POST | `/agents/:id/keys` | board | Create agent API key |
| DELETE | `/agents/:id/keys/:keyId` | board | Revoke agent API key |
| POST | `/agents/:id/wakeup` | any | Wakeup agent (enqueue run) |
| POST | `/agents/:id/heartbeat/invoke` | any | Directly invoke heartbeat |
| POST | `/agents/:id/claude-login` | board | Trigger Claude login flow |
| GET | `/instance/scheduler-heartbeats` | board | List scheduler heartbeat status |

### Heartbeat Runs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/companies/:companyId/heartbeat-runs` | any | List heartbeat runs |
| GET | `/companies/:companyId/live-runs` | any | List currently running runs |
| GET | `/heartbeat-runs/:runId` | any | Get run by ID |
| POST | `/heartbeat-runs/:runId/cancel` | any | Cancel running heartbeat |
| GET | `/heartbeat-runs/:runId/events` | any | Get run events |
| GET | `/heartbeat-runs/:runId/log` | any | Download run log |
| GET | `/heartbeat-runs/:runId/workspace-operations` | any | List workspace ops for run |
| GET | `/heartbeat-runs/:runId/issues` | any | Get issues touched by run |
| GET | `/workspace-operations/:operationId/log` | any | Download operation log |
| GET | `/issues/:issueId/live-runs` | any | List live runs for issue |
| GET | `/issues/:issueId/active-run` | any | Get active run for issue |

### Issues

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/companies/:companyId/issues` | any | List issues with filters |
| POST | `/companies/:companyId/issues` | any | Create issue |
| GET | `/issues/:id` | any | Get issue by ID |
| PATCH | `/issues/:id` | any | Update issue |
| DELETE | `/issues/:id` | any | Delete issue |
| POST | `/issues/:id/checkout` | agent | Atomic checkout (assign + lock) |
| POST | `/issues/:id/release` | agent | Release checkout |
| GET | `/issues/:id/heartbeat-context` | agent | Get issue context for heartbeat |
| GET | `/issues/:id/comments` | any | List comments |
| GET | `/issues/:id/comments/:commentId` | any | Get comment by ID |
| POST | `/issues/:id/comments` | any | Add comment |
| GET | `/issues/:id/attachments` | any | List attachments |
| POST | `/companies/:companyId/issues/:issueId/attachments` | any | Upload attachment |
| GET | `/attachments/:attachmentId/content` | any | Download attachment content |
| DELETE | `/attachments/:attachmentId` | any | Delete attachment |
| GET | `/issues/:id/work-products` | any | List work products |
| POST | `/issues/:id/work-products` | any | Create work product |
| PATCH | `/work-products/:id` | any | Update work product |
| DELETE | `/work-products/:id` | any | Delete work product |
| GET | `/issues/:id/documents` | any | List issue documents |
| GET | `/issues/:id/documents/:key` | any | Get document by key |
| PUT | `/issues/:id/documents/:key` | any | Upsert document |
| GET | `/issues/:id/documents/:key/revisions` | any | List document revisions |
| POST | `/issues/:id/documents/:key/revisions` | any | Create revision |
| DELETE | `/issues/:id/documents/:key` | any | Delete document |
| POST | `/issues/:id/read` | board | Mark issue as read |
| DELETE | `/issues/:id/read` | board | Mark issue as unread |
| POST | `/issues/:id/inbox-archive` | board | Archive from inbox |
| DELETE | `/issues/:id/inbox-archive` | board | Unarchive from inbox |
| GET | `/issues/:id/approvals` | any | List linked approvals |
| POST | `/issues/:id/approvals` | any | Link approval to issue |
| DELETE | `/issues/:id/approvals/:approvalId` | any | Unlink approval |

### Labels

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/companies/:companyId/labels` | any | List labels |
| POST | `/companies/:companyId/labels` | board | Create label |
| DELETE | `/labels/:labelId` | board | Delete label |

### Projects

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/companies/:companyId/projects` | any | List projects |
| GET | `/projects/:id` | any | Get project |
| POST | `/companies/:companyId/projects` | board | Create project |
| PATCH | `/projects/:id` | board | Update project |
| DELETE | `/projects/:id` | board | Delete project |
| GET | `/projects/:id/workspaces` | any | List project workspaces |
| POST | `/projects/:id/workspaces` | board | Create workspace |
| PATCH | `/projects/:id/workspaces/:workspaceId` | board | Update workspace |
| DELETE | `/projects/:id/workspaces/:workspaceId` | board | Delete workspace |
| POST | `/projects/:id/workspaces/:workspaceId/runtime-services/:action` | board | Manage runtime services |

### Execution Workspaces

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/companies/:companyId/execution-workspaces` | any | List execution workspaces |
| GET | `/execution-workspaces/:id` | any | Get execution workspace |
| GET | `/execution-workspaces/:id/close-readiness` | any | Check if workspace can be closed |
| GET | `/execution-workspaces/:id/workspace-operations` | any | List operations |
| POST | `/execution-workspaces/:id/runtime-services/:action` | any | Manage runtime services |
| PATCH | `/execution-workspaces/:id` | board | Update execution workspace |

### Goals

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/companies/:companyId/goals` | any | List goals |
| GET | `/goals/:id` | any | Get goal |
| POST | `/companies/:companyId/goals` | board | Create goal |
| PATCH | `/goals/:id` | board | Update goal |
| DELETE | `/goals/:id` | board | Delete goal |

### Routines

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/companies/:companyId/routines` | any | List routines |
| POST | `/companies/:companyId/routines` | board | Create routine |
| GET | `/routines/:id` | any | Get routine |
| PATCH | `/routines/:id` | board | Update routine |
| GET | `/routines/:id/runs` | any | List routine runs |
| POST | `/routines/:id/triggers` | any | Create trigger |
| PATCH | `/routine-triggers/:id` | any | Update trigger |
| DELETE | `/routine-triggers/:id` | any | Delete trigger |
| POST | `/routines/:id/triggers/:triggerId/rotate-secret` | any | Rotate trigger secret |
| POST | `/routines/:id/run` | any | Manually trigger routine |
| POST | `/routine-triggers/public/:publicId/fire` | public | Fire webhook trigger (signature-verified) |

### Approvals

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/companies/:companyId/approvals` | any | List approvals |
| GET | `/approvals/:id` | any | Get approval |
| POST | `/companies/:companyId/approvals` | any | Create approval |
| GET | `/approvals/:id/issues` | any | List linked issues |
| POST | `/approvals/:id/approve` | board | Approve |
| POST | `/approvals/:id/reject` | board | Reject |
| POST | `/approvals/:id/request-revision` | board | Request revision |
| POST | `/approvals/:id/resubmit` | any | Resubmit after revision |
| GET | `/approvals/:id/comments` | any | List comments |
| POST | `/approvals/:id/comments` | any | Add comment |

### Task Questions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/companies/:companyId/task-questions` | agent | Create question (ask_manager) |
| GET | `/companies/:companyId/task-questions` | any | List questions |
| GET | `/task-questions/:id` | any | Get question |
| POST | `/task-questions/:id/answer` | any | Answer question |
| POST | `/task-questions/:id/escalate` | agent | Escalate to higher manager |

### Secrets

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/companies/:companyId/secret-providers` | board | List available providers |
| GET | `/companies/:companyId/secrets` | board | List secrets |
| POST | `/companies/:companyId/secrets` | board | Create secret |
| POST | `/secrets/:id/rotate` | board | Rotate secret value |
| PATCH | `/secrets/:id` | board | Update secret metadata |
| DELETE | `/secrets/:id` | board | Delete secret |

### Costs & Budgets

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/companies/:companyId/cost-events` | agent | Report cost event |
| POST | `/companies/:companyId/finance-events` | agent | Report finance event |
| GET | `/companies/:companyId/costs/summary` | any | Cost summary |
| GET | `/companies/:companyId/costs/by-agent` | any | Costs grouped by agent |
| GET | `/companies/:companyId/costs/by-agent-model` | any | Costs by agent and model |
| GET | `/companies/:companyId/costs/by-provider` | any | Costs by provider |
| GET | `/companies/:companyId/costs/by-biller` | any | Costs by biller |
| GET | `/companies/:companyId/costs/by-project` | any | Costs by project |
| GET | `/companies/:companyId/costs/finance-summary` | any | Finance summary |
| GET | `/companies/:companyId/costs/finance-by-biller` | any | Finance by biller |
| GET | `/companies/:companyId/costs/finance-by-kind` | any | Finance by event kind |
| GET | `/companies/:companyId/costs/finance-events` | any | List finance events |
| GET | `/companies/:companyId/costs/window-spend` | any | Spend in budget window |
| GET | `/companies/:companyId/costs/quota-windows` | any | Quota window details |
| GET | `/companies/:companyId/budgets/overview` | any | Budget overview |
| POST | `/companies/:companyId/budgets/incidents/:incidentId/resolve` | board | Resolve budget incident |
| POST | `/companies/:companyId/budgets/incidents/:incidentId/dismiss` | board | Dismiss budget incident |
| PATCH | `/companies/:companyId/budgets` | board | Update company budget |
| PATCH | `/agents/:agentId/budgets` | board | Update agent budget |

### Activity

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/companies/:companyId/activity` | any | List activity log |
| POST | `/companies/:companyId/activity` | agent | Create activity entry |
| GET | `/issues/:id/activity` | any | Activity for issue |
| GET | `/issues/:id/runs` | any | Runs for issue |
| GET | `/heartbeat-runs/:runId/issues` | any | Issues for run |

### Assets

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/companies/:companyId/assets/images` | any | Upload image |
| GET | `/assets/:assetId/content` | any | Download asset content |

### Company Skills

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/companies/:companyId/skills` | any | List skills |
| GET | `/companies/:companyId/skills/:skillId` | any | Get skill |
| GET | `/companies/:companyId/skills/:skillId/update-status` | any | Check update availability |
| GET | `/companies/:companyId/skills/:skillId/files` | any | List skill files |
| POST | `/companies/:companyId/skills` | board | Install skill |
| PATCH | `/companies/:companyId/skills/:skillId` | board | Update skill |
| POST | `/companies/:companyId/skills/install-from-url` | board | Install from URL |
| POST | `/companies/:companyId/skills/scan-path` | board | Scan local path for skills |
| DELETE | `/companies/:companyId/skills/:skillId` | board | Delete skill |
| POST | `/companies/:companyId/skills/:skillId/install-update` | board | Install available update |

### Dashboard & Sidebar

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/companies/:companyId/dashboard` | any | Dashboard summary data |
| GET | `/companies/:companyId/sidebar-badges` | any | Sidebar badge counts |

### Instance Settings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/instance/settings/general` | board | Get general settings |
| PATCH | `/instance/settings/general` | admin | Update general settings |
| GET | `/instance/settings/experimental` | board | Get experimental settings |
| PATCH | `/instance/settings/experimental` | admin | Update experimental settings |

### LLMs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/llms/agent-configuration.txt` | public | Agent configuration as plain text |
| GET | `/llms/agent-icons.txt` | public | Available agent icons |
| GET | `/llms/agent-configuration/:adapterType.txt` | public | Adapter-specific config |

### Plugins

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/plugins` | board | List installed plugins |
| GET | `/plugins/examples` | board | List example plugins |
| GET | `/plugins/ui-contributions` | any | Get UI contributions from plugins |
| GET | `/plugins/tools` | any | List plugin-provided tools |
| POST | `/plugins/tools/execute` | any | Execute a plugin tool |
| POST | `/plugins/install` | board | Install a plugin |
| GET | `/plugins/:pluginId` | board | Get plugin details |
| DELETE | `/plugins/:pluginId` | board | Uninstall plugin |
| POST | `/plugins/:pluginId/enable` | board | Enable plugin |
| POST | `/plugins/:pluginId/disable` | board | Disable plugin |
| GET | `/plugins/:pluginId/health` | board | Plugin health check |
| GET | `/plugins/:pluginId/logs` | board | Get plugin logs |
| POST | `/plugins/:pluginId/upgrade` | board | Upgrade plugin |
| GET | `/plugins/:pluginId/config` | board | Get plugin config |
| POST | `/plugins/:pluginId/config` | board | Update plugin config |
| POST | `/plugins/:pluginId/config/test` | board | Test plugin config |
| GET | `/plugins/:pluginId/jobs` | board | List plugin jobs |
| GET | `/plugins/:pluginId/jobs/:jobId/runs` | board | List job runs |
| POST | `/plugins/:pluginId/jobs/:jobId/trigger` | board | Manually trigger job |
| POST | `/plugins/:pluginId/webhooks/:endpointKey` | public | Inbound webhook delivery |
| GET | `/plugins/:pluginId/dashboard` | board | Plugin dashboard data |
| POST | `/plugins/:pluginId/bridge/data` | any | Plugin bridge data endpoint |
| POST | `/plugins/:pluginId/bridge/action` | any | Plugin bridge action endpoint |
| POST | `/plugins/:pluginId/data/:key` | any | Plugin data key endpoint |
| POST | `/plugins/:pluginId/actions/:key` | any | Plugin action key endpoint |
| GET | `/plugins/:pluginId/bridge/stream/:channel` | any | SSE stream from plugin |

### Access, Auth & Invites

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/board-claim/:token` | public | Get board claim challenge info |
| POST | `/board-claim/:token/claim` | public | Claim board invite |
| POST | `/cli-auth/challenges` | public | Create CLI auth challenge |
| GET | `/cli-auth/challenges/:id` | public | Poll CLI auth challenge |
| POST | `/cli-auth/challenges/:id/approve` | board | Approve CLI auth challenge |
| POST | `/cli-auth/challenges/:id/cancel` | any | Cancel CLI auth challenge |
| GET | `/cli-auth/me` | board | Get current CLI user info |
| POST | `/cli-auth/revoke-current` | board | Revoke current CLI key |
| GET | `/skills/available` | public | List available skills |
| GET | `/skills/index` | public | Skills index |
| GET | `/skills/:skillName` | public | Get skill details |
| POST | `/companies/:companyId/invites` | board | Create invite |
| POST | `/companies/:companyId/openclaw/invite-prompt` | board | Generate OpenClaw invite prompt |
| GET | `/invites/:token` | public | Get invite info |
| GET | `/invites/:token/onboarding` | public | Get onboarding info |
| GET | `/invites/:token/onboarding.txt` | public | Onboarding as plain text |
| GET | `/invites/:token/test-resolution` | public | Test invite resolution |
| POST | `/invites/:token/accept` | public | Accept invite |
| POST | `/invites/:inviteId/revoke` | board | Revoke invite |
| GET | `/companies/:companyId/join-requests` | board | List join requests |
| POST | `/companies/:companyId/join-requests/:requestId/approve` | board | Approve join request |
| POST | `/companies/:companyId/join-requests/:requestId/reject` | board | Reject join request |
| POST | `/join-requests/:requestId/claim-api-key` | public | Claim agent API key |
| GET | `/companies/:companyId/members` | board | List company members |
| PATCH | `/companies/:companyId/members/:memberId/permissions` | board | Update member permissions |
| POST | `/admin/users/:userId/promote-instance-admin` | admin | Promote user to instance admin |
| POST | `/admin/users/:userId/demote-instance-admin` | admin | Demote instance admin |
| GET | `/admin/users/:userId/company-access` | admin | Get user's company access |
| PUT | `/admin/users/:userId/company-access` | admin | Set user's company access |

### Auth Session

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/auth/get-session` | board | Get current session info |
| ALL | `/auth/*` | -- | better-auth handler (sign-up, sign-in, etc.) |

---

## 6. Services Layer

Services live in `server/src/services/`. Each is a factory function that takes a `Db` instance and returns methods.

### Core Domain Services

#### `companyService` (`companies.ts`)
- Company CRUD, archival, deletion
- Workspace path management
- Company pause/resume

#### `agentService` (`agents.ts`)
- Agent CRUD, hire flow with approval gates
- Status management: pause, resume, terminate
- Org chart queries
- Agent key generation and management
- Config revision tracking and rollback

#### `agentInstructionsService` (`agent-instructions.ts`)
- Instructions bundle management (file-based instruction sets)
- File CRUD within instruction bundles
- Path-based instructions sync from filesystem

#### `issueService` (`issues.ts`)
- Issue CRUD with company-scoped access
- **Atomic checkout**: `checkout()` assigns an issue to an agent with a run lock, ensuring single-assignee invariant
- **Release**: `release()` unlocks the issue after work completes
- Status transitions with side effects (started_at, completed_at timestamps)
- Filtering by status, assignee, project, label, parent, etc.
- Sub-task (parent/child) support

#### `issueApprovalService` (`issue-approvals.ts`)
- Link/unlink approvals to issues
- Query linked approvals

#### `projectService` (`projects.ts`)
- Project CRUD with workspace management
- Lead agent assignment
- Execution workspace policy

#### `goalService` (`goals.ts`)
- Goal CRUD with hierarchical parent/child support

#### `approvalService` (`approvals.ts`)
- Approval lifecycle: create, approve, reject, request revision, resubmit, cancel
- Approval comments

#### `routineService` (`routines.ts`)
- Routine CRUD with triggers
- Trigger management (cron, webhook, API)
- Run execution with concurrency policies (`coalesce_if_active`, `skip_if_active`, `always_enqueue`)
- Catch-up policies for missed schedule runs
- Webhook signature verification (bearer, HMAC-SHA256)

#### `documentService` (`documents.ts`)
- Document CRUD with revision history
- Issue-document linking via keys

#### `costService` (`costs.ts`)
- Cost event ingestion
- Aggregation queries: by agent, by model, by provider, by biller, by project
- Budget window spend calculation

#### `financeService` (`finance.ts`)
- Finance event ingestion and querying
- Summary aggregations by biller, kind, direction

#### `budgetService` (`budgets.ts`)
- **Budget enforcement**: checks policies against actual spend, creates incidents when thresholds breached
- **Hard-stop**: auto-pauses agents when hard budget limit exceeded
- Budget policy CRUD (scoped to company/agent/project)
- Incident management: resolve (keep paused or raise budget and resume), dismiss
- Quota window calculations

#### `secretService` (`secrets.ts`)
- Secret CRUD with versioned encrypted storage
- Rotation (creates new version)
- Provider-based: `local_encrypted`, `aws_secrets_manager`, `gcp_secret_manager`, `vault`

#### `activityService` (`activity.ts`)
- Query activity log with filters (entity, actor, time range)
- Activity logging helper (`logActivity`)

#### `accessService` (`access.ts`)
- Company membership management
- Invite creation, acceptance, revocation
- Join request approval/rejection
- Permission grant management
- Instance admin role management
- Board claim (bootstrap) flow

#### `boardAuthService` (`board-auth.ts`)
- Board API key management (create, revoke, lookup by hash)
- CLI auth challenge flow (create challenge, approve, cancel, poll)
- Session resolution

#### `companyPortabilityService` (`company-portability.ts`)
- Full company export/import with all related data
- Preview imports before applying

#### `companySkillService` (`company-skills.ts`)
- Skill installation from local paths and URLs
- Skill update checking and application
- Filesystem scanning for skills

### Orchestration Services

#### `heartbeatService` (`heartbeat.ts`)
- **Core orchestration engine**: manages agent invocations
- Run lifecycle: queue -> start process -> stream events -> finalize
- Process management (spawn, monitor, kill)
- Session management (before/after state)
- Log capture and storage
- Usage/cost extraction from process output
- Retry logic for process loss
- **Heartbeat scheduling**: periodic check of agents with pending wakeup requests

#### `workspaceRuntimeService` (`workspace-runtime.ts`)
- Long-lived runtime service management (dev servers, databases, etc.)
- Start/stop/restart services
- Health checking
- Startup reconciliation (restart desired services on boot)

#### `executionWorkspaceService` (`execution-workspaces.ts`)
- Create/manage isolated workspaces for task execution
- Branch/worktree creation strategies
- Workspace cleanup and closing

#### `workspaceOperationService` (`workspace-operations.ts`)
- Track shell operations during workspace lifecycle
- Log capture for workspace setup/teardown commands

#### `taskQuestionService` (`task-questions.ts`)
- Agent-to-manager question escalation
- Answer and forward chain
- Retry tracking (max 3)

#### `cronService` (`cron.ts`)
- Periodic scheduled tasks
- Routine trigger evaluation
- Database backup scheduling

#### `issueAssignmentWakeupService` (`issue-assignment-wakeup.ts`)
- Auto-wakeup agents when issues are assigned to them

#### `issueGoalFallbackService` (`issue-goal-fallback.ts`)
- Fallback goal assignment for issues

### Plugin Services

#### `pluginLoader` (`plugin-loader.ts`)
- Plugin discovery and loading from filesystem
- Manifest validation
- Package path resolution

#### `pluginLifecycleManager` (`plugin-lifecycle.ts`)
- Plugin enable/disable/install/uninstall lifecycle
- Worker process management coordination

#### `pluginWorkerManager` (`plugin-worker-manager.ts`)
- Worker process spawning and communication
- JSON-RPC message passing to/from worker processes

#### `pluginEventBus` (`plugin-event-bus.ts`)
- Internal event bus for plugin notifications
- Bridges Paperclip events to interested plugin workers

#### `pluginJobScheduler` (`plugin-job-scheduler.ts`)
- Cron-based scheduling for plugin jobs
- Next-run calculation and firing

#### `pluginJobCoordinator` (`plugin-job-coordinator.ts`)
- Coordinates job execution across scheduler and worker manager

#### `pluginJobStore` (`plugin-job-store.ts`)
- CRUD for plugin job definitions and run history

#### `pluginToolDispatcher` (`plugin-tool-dispatcher.ts`)
- Routes tool execution requests to the correct plugin worker

#### `pluginToolRegistry` (`plugin-tool-registry.ts`)
- Maintains registry of tools exposed by active plugins

#### `pluginRegistryService` (`plugin-registry.ts`)
- Database-backed plugin metadata queries

#### `pluginHostServices` (`plugin-host-services.ts`)
- Host-side service implementations exposed to plugin workers via JSON-RPC
- DB access, event publishing, state management

#### `pluginStateStore` (`plugin-state-store.ts`)
- Scoped key-value store operations for plugins

#### `pluginRuntimeSandbox` (`plugin-runtime-sandbox.ts`)
- Security sandboxing for plugin worker processes

#### `pluginSecretsHandler` (`plugin-secrets-handler.ts`)
- Secure secret injection for plugins

#### `pluginDevWatcher` (`plugin-dev-watcher.ts`)
- Filesystem watcher for hot-reloading plugins during development

#### `pluginManifestValidator` (`plugin-manifest-validator.ts`)
- Validates plugin manifests against the spec

#### `pluginCapabilityValidator` (`plugin-capability-validator.ts`)
- Validates plugin capability declarations

#### `pluginConfigValidator` (`plugin-config-validator.ts`)
- Validates plugin instance config against schema

#### `pluginLogRetention` (`plugin-log-retention.ts`)
- Periodic cleanup of old plugin log entries

#### `pluginHostServiceCleanup` (`plugin-host-service-cleanup.ts`)
- Cleans up host service subscriptions when plugins stop

#### `pluginStreamBus` (`plugin-stream-bus.ts`)
- SSE streaming from plugin workers to clients

### Supporting Services

#### `dashboardService` (`dashboard.ts`)
- Aggregated dashboard statistics

#### `sidebarBadgeService` (`sidebar-badges.ts`)
- Badge count calculations for UI sidebar

#### `instanceSettingsService` (`instance-settings.ts`)
- Instance-wide settings CRUD

#### `localServiceSupervisor` (`local-service-supervisor.ts`)
- Supervises local subprocess services

#### `workProductService` (`work-products.ts`)
- Issue work product CRUD

#### `quotaWindowService` (`quota-windows.ts`)
- Budget quota window calculations

#### `runLogStore` (`run-log-store.ts`)
- Storage backend for heartbeat run logs

#### `workspaceOperationLogStore` (`workspace-operation-log-store.ts`)
- Storage backend for workspace operation logs

#### `companyExportReadme` (`company-export-readme.ts`)
- Generates README for company export packages

#### `hireHook` (`hire-hook.ts`)
- Post-hire notification hook (fires after agent hire is approved)

#### `liveEvents` (`live-events.ts`)
- In-memory event emitter for real-time pub/sub
- Company-scoped and global event channels

#### `agentPermissions` (`agent-permissions.ts`)
- Permission checking for agent actions

#### `defaultAgentInstructions` (`default-agent-instructions.ts`)
- Default instruction template for new agents

#### `heartbeatRunSummary` (`heartbeat-run-summary.ts`)
- Summary generation for completed runs

#### `executionWorkspacePolicy` (`execution-workspace-policy.ts`)
- Policy evaluation for workspace creation strategies

#### `projectWorkspaceRuntimeConfig` (`project-workspace-runtime-config.ts`)
- Runtime service configuration for project workspaces

#### `workspaceRefresh` (`workspace-refresh.ts`)
- Git pull/refresh for company workspaces

---

## 7. Authentication & Authorization

### Deployment Modes

| Mode | Behavior |
|------|----------|
| `local_trusted` | All requests auto-authenticate as a board user (`local-board`). No login required. Instance admin by default. Company deletion enabled. Exposure always `private`. |
| `authenticated` | Requires real authentication via better-auth sessions or bearer API keys. Supports `private` or `public` exposure. |

### Actor Types

Every request is annotated with an actor via the `actorMiddleware`:

| Actor Type | Source | Description |
|------------|--------|-------------|
| `board` | `local_implicit` | Auto-granted in `local_trusted` mode |
| `board` | `session` | better-auth session cookie (authenticated mode) |
| `board` | `board_key` | Board API key bearer token |
| `agent` | `agent_key` | Agent API key bearer token (SHA256 hashed) |
| `agent` | `agent_jwt` | Short-lived JWT for agent processes |
| `none` | `none` | Unauthenticated (default in authenticated mode) |

### Agent API Key Authentication

1. Agent sends `Authorization: Bearer <raw-token>`
2. Server computes `SHA256(token)` and looks up in `agent_api_keys` table
3. Verifies key is not revoked (`revoked_at IS NULL`)
4. Verifies agent exists and is not `terminated` or `pending_approval`
5. Updates `last_used_at` timestamp
6. Sets `req.actor = { type: "agent", agentId, companyId, keyId }`

If no key matches, falls back to JWT verification for local agent JWTs.

### Board API Key Authentication

1. Board user sends `Authorization: Bearer <raw-token>`
2. Server looks up hash in `board_api_keys`
3. Resolves user's company memberships and instance admin status
4. Sets `req.actor = { type: "board", userId, companyIds, isInstanceAdmin }`

### better-auth Sessions (Authenticated Mode)

- Uses cookie-based sessions via `better-auth`
- `resolveSession(req)` extracts user from session headers
- Looks up `instance_user_roles` and `company_memberships`
- Supports email/password and OAuth providers

### Company-Scoped Access

- Every entity belongs to a company
- Board users can access companies they are members of (or all companies if `isInstanceAdmin`)
- Agents can only access their own company (`req.actor.companyId`)
- Routes verify company access before returning data

### Permission Model

Fine-grained permissions stored in `principal_permission_grants`:

| Permission Key | Controls |
|----------------|----------|
| `agents:create` | Creating new agents |
| `users:invite` | Creating invite links |
| `users:manage_permissions` | Managing member permissions |
| `tasks:assign` | Assigning tasks to agents |
| `tasks:assign_scope` | Scope-limited task assignment |
| `joins:approve` | Approving join requests |

### CSRF Protection (Board Mutation Guard)

- Non-GET requests from `board` actors with `session` source must include a trusted `Origin` or `Referer` header
- Trusted origins: `http://localhost:3100`, `http://127.0.0.1:3100`, plus the request's own `Host` header
- Skipped for `local_implicit` and `board_key` sources (not browser-session requests)

### Private Hostname Guard

When `deploymentMode=authenticated` and `deploymentExposure=private`:
- Validates the `Host` header against an allow list
- Always allows loopback (`localhost`, `127.0.0.1`, `::1`)
- Additional hostnames configured via `PAPERCLIP_ALLOWED_HOSTNAMES` env or config

---

## 8. Real-time (WebSocket)

### Endpoint

```
ws://host:port/api/companies/:companyId/events/ws
```

Optional query parameter: `?token=<bearer-token>` (alternative to `Authorization` header for browser WebSocket connections).

### Authentication

- `local_trusted` mode: no token required; auto-authenticates as board
- `authenticated` mode without token: resolves session from request cookies/headers
- Bearer token: validates against `agent_api_keys` (same SHA256 hash lookup as REST API)
- Company access verified (agent must belong to the company, or board user must have membership)

### Event Types

| Event Type | Payload | Description |
|------------|---------|-------------|
| `heartbeat.run.queued` | run info | New heartbeat run queued |
| `heartbeat.run.status` | run ID, new status | Run status changed |
| `heartbeat.run.event` | event data | Streaming run event |
| `heartbeat.run.log` | log data | Run log output |
| `agent.status` | agent ID, new status | Agent status changed |
| `activity.logged` | activity entry | New activity log entry |
| `plugin.ui.updated` | plugin info | Plugin UI contribution changed |
| `plugin.worker.crashed` | plugin ID, error | Plugin worker process crashed |
| `plugin.worker.restarted` | plugin ID | Plugin worker restarted |

### Event Format

```json
{
  "id": 42,
  "companyId": "uuid",
  "type": "heartbeat.run.status",
  "createdAt": "2026-04-06T05:30:00.000Z",
  "payload": { ... }
}
```

### Connection Management

- **Ping/pong**: Server sends ping every 30 seconds. Clients must respond with pong. Clients that miss a pong cycle are terminated.
- **`noServer` mode**: WebSocket server handles HTTP upgrade manually, integrated with the main HTTP server.
- **Per-company subscription**: Each WebSocket connection subscribes to events for one company via an in-memory `EventEmitter`.
- **Reconnection**: Client-side responsibility. Server provides no replay of missed events.

---

## 9. Deployment Modes

### `local_trusted` (Default)

- No authentication required -- all requests treated as board admin
- Exposure always `private`
- Company deletion enabled by default
- Embedded PostgreSQL auto-starts (no setup needed)
- Data stored at `~/.paperclip/instances/default/db/`
- Default port: 3100, default host: `127.0.0.1`
- Suitable for local development and single-user operation

### `authenticated`

- Requires real authentication via better-auth
- Supports both `private` and `public` exposure
- Private: hostname guard enforces allow list
- Public: open to any hostname
- Company deletion disabled by default
- Users sign up / sign in via better-auth (email/password or OAuth)
- First user can be bootstrapped via invite flow or CLI

### Embedded PostgreSQL Auto-Mode

When `DATABASE_URL` is not set:
1. Server resolves data directory (`~/.paperclip/instances/default/db/`)
2. Starts embedded PostgreSQL 17 on port 54329
3. Runs migrations automatically
4. Handles periodic backups (default: every 60 min, retain 30 days)

### Bootstrap Flow (Authenticated Mode)

1. Start server in `authenticated` mode
2. First-time setup generates a bootstrap invite URL
3. Admin visits URL, creates account (becomes instance admin)
4. Admin creates companies and invites agents/users

### Configuration Resolution

Configuration is loaded from multiple sources with the following precedence:
1. Environment variables (`PAPERCLIP_*`, `DATABASE_URL`, `HOST`, `PORT`)
2. Config file (`~/.paperclip/config.toml` or equivalent)
3. Built-in defaults

Key environment variables:
- `DATABASE_URL` -- External PostgreSQL connection string
- `PAPERCLIP_DEPLOYMENT_MODE` -- `local_trusted` or `authenticated`
- `PAPERCLIP_DEPLOYMENT_EXPOSURE` -- `private` or `public`
- `HOST` / `PORT` -- Server bind address (defaults: `127.0.0.1:3100`)
- `PAPERCLIP_SECRETS_PROVIDER` -- Secret storage backend
- `PAPERCLIP_STORAGE_PROVIDER` -- Asset storage backend (`local_disk` or `s3`)
- `HEARTBEAT_SCHEDULER_ENABLED` -- Enable/disable heartbeat scheduler (default: true)
- `HEARTBEAT_SCHEDULER_INTERVAL_MS` -- Scheduler poll interval (default: 30000, min: 10000)

---

## 10. Key Invariants

These must be preserved in all changes:

### Company Scoping
Every entity belongs to a company. Company boundaries are enforced in routes and services. Board users see only companies they are members of (or all if instance admin). Agents see only their own company.

### Single-Assignee Task Model
Issues are assigned to one agent at a time. The `checkout()` operation atomically assigns an issue and locks it with a `checkout_run_id`. The agent must `release()` when work completes. This prevents multiple agents from working on the same task simultaneously.

### Approval Gates
Governed actions (agent hiring, budget overrides, CEO strategies) require approval workflows. The `hire_agent` flow creates a pending approval when `require_board_approval_for_new_agents` is enabled. Agents cannot become active until approved.

### Budget Hard-Stop
Budget policies with `hard_stop_enabled=true` auto-pause agents when the observed spend exceeds the budget `amount`. The budget service creates a `budget_incident` with `threshold_type=hard` and pauses the affected scope. Resolution options: keep paused, or raise budget and resume.

### Activity Logging
All mutations get activity log entries via `logActivity()`. Each entry records the actor (board/agent/system), action, entity type/ID, and optional details JSON. The activity log is immutable and queryable by company, entity, and time range.

### Contract Sync
Schema and API changes must update all layers in order:
1. `packages/db/` -- Schema changes
2. `packages/shared/` -- Type/constant updates
3. `server/` -- Route/service updates
4. `ui/` -- Component/query updates

This ensures type safety across the full stack.
