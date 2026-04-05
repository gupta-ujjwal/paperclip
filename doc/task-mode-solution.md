# Paperclip → Task Mode: Solution Doc

## 1. Vision

Repurpose Paperclip from permanent AI "companies" into **ephemeral AI task-teams** that solve features/bug-fixes in an existing codebase. A BD person provides a pre-built multi-repo workspace + a task description; a PM agent is auto-hired, reads context, builds a team, and executes.

**Phase 1 is UI-level rebranding + workspace integration + role library + escalation protocol.** No breaking DB rename.

---

## 2. Core Concepts

| Paperclip (today) | Task Mode (UI label) | Notes |
|---|---|---|
| Company | **Task** | Ephemeral, has a workspace, BD marks done |
| CEO | **PM** | First agent, orchestrates |
| Board user | **BD** | Task creator + final reviewer |
| Issue | Issue | Unchanged; types driven by assignee |
| Agent role | **First-class role** | Config-driven library |

**Constraints:**
- 1 workspace = 1 Task (no sharing)
- Workspace path is required at Task creation
- BD marks Task done — not auto

---

## 3. Task Lifecycle

```
BD creates Task (name, desc, workspace path, budget, provider)
        ↓
PM auto-hired, starts synchronously (like today's CEO)
        ↓
PM reads workspace context files (CLAUDE.md, architecture.md, dsl.md)
        ↓
PM picks approach: research → plan → execute (PM's call)
        ↓
PM hires team, creates issues, delegates
        ↓
Team works (escalation + questions flow up, answers flow down)
        ↓
PM generates final report → Task status: "ready_for_review"
        ↓
BD reviews report → "Approve & Close" OR "Reopen with feedback"
        ↓
On close: all agents archived, workspace untouched
```

**Reopen:** BD can reopen a closed Task; original budget reused (no reset); PM resumes work with BD feedback.

---

## 4. Roles (First-Class)

**Role library** shipped as config files at `packages/shared/src/roles/*.yaml`, loaded at runtime.

### Available roles (Phase 1)
- **PM** — Program Manager (auto-hired, orchestrates, BD's main contact)
- **EM** — Engineering Manager (reviews + merges branches, assigns SDEs)
- **Product Manager**
- **Program Manager**
- **Research Analyst** *(leaf)*
- **SDE2** — Senior engineer
- **SDE1** — Junior engineer *(leaf)*
- **QA** *(leaf)*
- **BD** (role instance, not the human) — domain research helper

### Role config schema
```yaml
name: SDE2
can_hire: true
is_leaf: false
default_model_preference: sonnet   # hiring agent picks actual model
default_tools: [file_read, file_write, shell_exec, git, ask_manager, request_tool]
system_prompt: |
  You are a senior software engineer...
default_reports_to_role: EM
```

### Rules
- **Leaf roles** (SDE1, QA, Research Analyst) cannot hire
- **Hiring agent** can override any field per hire (prompt, model, tools, reports_to)
- Only orchestrators (PM, EM, Product/Program Manager) hire and review; **only SDE1/SDE2 write code**
- Additional tool requests escalate to the hiring manager

---

## 5. Question & Escalation Protocol

### Core rules
1. **No hallucinating** — if out of scope, escalate
2. Every agent has `ask_manager(question, is_blocking)` tool
3. Questions route via `reportsTo` chain
4. BD is terminal — only PM/EM can escalate to BD
5. **Max 3 re-asks** on the same question; then forced BD intervention

### Partial escalation + translation
When an agent answers partially:
- Answers what it knows in its own context
- Forwards only the unknown fragment upward
- When answer comes back, **rewrites it in the asker's language** before replying

Example chain: SDE1 asks SDE2 → SDE2 answers eng part, escalates product part to PM → PM escalates to BD → BD replies → PM rewrites for SDE2 → SDE2 combines with own answer + rewrites for SDE1.

### Blocking behavior
- Agent marks question as blocking or non-blocking
- Blocking → agent pauses current issue (status: `blocked`)
- Non-blocking → agent continues other work

### BD surface
- Questions reach BD via **Inbox** + push/toast notification
- BD responds in **issue comments on TSK-0** (or on the specific issue)
- BD↔PM chat reuses issue comments; extensible to other agent pairs

---

## 6. Workspace & Git

### Workspace layout (BD-prepared, untouched by Paperclip except under `.paperclip/`)
```
/my-workspace/
  CLAUDE.md
  architecture.md
  dsl.md
  update-all-repos.sh
  repo-1/
  repo-2/
  .paperclip/
    <task-slug>/
      <issue-id>/
        output.md
```

### Git flow (Phase 1)
- Each code-writing agent (SDE1/SDE2) works on its own branch
- EM reviews and merges into a task-level integration branch
- All local — no PRs, no remote pushes (Phase 2)

### `update-all-repos.sh`
- Surfaced as **"Refresh Workspace"** button on Task dashboard
- BD triggers it manually before starting (or mid-task if needed)

### Safety
- Standard safety posture: no destructive git ops without EM approval, no unbounded shell escapes
- Specific command whitelists deferred to Phase 2

---

## 7. Budget

- **Label:** "Total Budget" (UI only; DB field stays `budgetMonthlyCents` for Phase 1)
- **Hard stop at 100%** — all agents pause
- **Warnings at 50% / 80%** — surfaced to PM + BD
- Soft-limit / hard-limit split deferred to Phase 2

---

## 8. Issues & Output

### Issue types
Not a DB enum — type is derived from assignee's role:
- SDE1/SDE2 → coding
- QA → testing
- Research Analyst → market/code/product research
- EM → code review
- etc.

### TSK-0
- Auto-created when Task starts
- Owned by PM
- Represents the whole Task
- Top-level comments = BD↔PM discussion thread

### Standard issue output (generic, all issue types)
```yaml
summary: <what was done>
status: success | partial | blocked
artifacts:
  - path: .paperclip/<task>/<issue>/notes.md
  - path: repo-1/src/foo.ts
git_refs:
  - branch: sde1/issue-5
  - commits: [sha1, sha2]
findings:
  - <bullet: decisions, concerns, followups>
telemetry:
  started_at: <iso>
  ended_at: <iso>
  duration_sec: <n>
  agent_id: <uuid>
  tokens_used: <n>
  cost_cents: <n>
```

### Final PM report (generated when Task ready for review)
Combines: executive summary, per-agent breakdown, git diff across all branches, cost totals, open questions, known issues. Generated by PM, presented to BD for final sign-off.

---

## 9. UI Changes (Phase 1)

### Label renames (UI-only, no API/DB)
- Company → Task, CEO → PM, Monthly Budget → Total Budget
- ~15 files affected in `ui/src/`
- Single change in `packages/shared/src/constants.ts` (`AGENT_ROLE_LABELS.ceo = "PM"`) cascades

### New: Task creation form (in OnboardingWizard)
- Name, description, **workspace path (required)**, total budget, **provider** (Claude/OpenCode/etc.)
- On submit: create Task → auto-hire PM → PM starts synchronously
- `requireBoardApprovalForNewAgents: false` by default
- PM gets `canCreateAgents: true` by default

### New: Task dashboard (reuse existing company pages)
- Same primary views: org chart, issues, activity, costs, inbox
- Adds: "Refresh Workspace" button
- TSK-0 pinned at top of issues

---

## 10. Minimal DB Change

Add one column:
```sql
companies.workspace_path text  -- path to BD-prepared workspace root
```

Populated via `packages/db/schema/companies.ts`; surfaced in `packages/shared/types/company.ts`.

No other DB changes. All rename is UI-only.

---

## 11. Phase 1 vs Phase 2

### Phase 1 (must-have)
- UI rename (Task, PM, Total Budget)
- Workspace path field + `.paperclip/` artifacts dir
- Role library config files + per-hire customization
- PM auto-hire + auto-start
- TSK-0 auto-created
- Hierarchical escalation with partial answers + translation
- Per-agent git branches + EM merging (local only)
- Budget hard stop + 50/80% warnings
- Generic structured issue output + final PM report
- BD↔PM chat via TSK-0 comments
- "Refresh Workspace" button

### Phase 2 (later)
- Full rename in DB/API (companies → tasks)
- PR creation + remote git push
- Slack/Email notifications
- Soft+hard budget limits
- Reopen with budget delta
- Per-role command whitelists / sandboxing

---

## 12. Open / Deferred

- Safety sandboxing beyond "standard" — revisit in Phase 2
- Role library UI editor — config files only for Phase 1
- Tool request approval UX — initial impl can auto-grant from a pre-approved pool
- Multi-task parallelism limits (RAM/CPU guards)
