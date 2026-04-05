import fs from "node:fs/promises";
import {
  getTaskRole,
  isTaskRoleName,
  type TaskRoleName,
} from "@paperclipai/shared";

const DEFAULT_AGENT_BUNDLE_FILES = {
  default: ["AGENTS.md"],
  ceo: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
} as const;

type DefaultAgentBundleRole = keyof typeof DEFAULT_AGENT_BUNDLE_FILES;

/**
 * Task-mode: map AgentRole → TaskRoleName when possible so role-specific
 * system prompts from the role library are materialised into the agent's
 * instructions bundle at creation time.
 */
const AGENT_ROLE_TO_TASK_ROLE: Record<string, TaskRoleName> = {
  ceo: "pm",
  pm: "program_manager",
  engineer: "sde2",
  qa: "qa",
  researcher: "research_analyst",
};

function resolveDefaultAgentBundleUrl(role: DefaultAgentBundleRole, fileName: string) {
  return new URL(`../onboarding-assets/${role}/${fileName}`, import.meta.url);
}

function renderTaskRoleChapter(taskRoleName: TaskRoleName): string {
  const role = getTaskRole(taskRoleName);
  const toolsList = role.default_tools.map((tool) => `- ${tool}`).join("\n");
  return [
    `# Task-Mode Role: ${role.label}`,
    "",
    role.system_prompt,
    "",
    "## Default tool set",
    toolsList,
    "",
    "## Task-mode API",
    "The following Paperclip endpoints are your control surface for",
    "coordinating with your manager / hires. Call them via HTTP with your",
    "agent API key (`X-Agent-Key` header):",
    "",
    "- POST /api/companies/:id/task-questions  — ask_manager",
    "- POST /api/task-questions/:id/answer     — answer a subordinate",
    "- POST /api/task-questions/:id/reject     — reject an insufficient answer",
    "- POST /api/companies/:id/task-report     — submit final PM report",
    "- POST /api/companies/:id/refresh-workspace — re-sync repos",
    "",
    "See the `task-mode` skill for payload shapes.",
    "",
  ].join("\n");
}

export async function loadDefaultAgentInstructionsBundle(
  role: DefaultAgentBundleRole,
  options: { agentRole?: string } = {},
): Promise<Record<string, string>> {
  const fileNames = DEFAULT_AGENT_BUNDLE_FILES[role];
  const entries = await Promise.all(
    fileNames.map(async (fileName) => {
      const content = await fs.readFile(resolveDefaultAgentBundleUrl(role, fileName), "utf8");
      return [fileName, content] as const;
    }),
  );
  const bundle: Record<string, string> = Object.fromEntries(entries);

  const agentRole = options.agentRole;
  if (agentRole) {
    const taskRoleName: TaskRoleName | undefined = isTaskRoleName(agentRole)
      ? agentRole
      : AGENT_ROLE_TO_TASK_ROLE[agentRole];
    if (taskRoleName) {
      bundle["TASK_ROLE.md"] = renderTaskRoleChapter(taskRoleName);
    }
  }

  return bundle;
}

export function resolveDefaultAgentInstructionsBundleRole(role: string): DefaultAgentBundleRole {
  return role === "ceo" ? "ceo" : "default";
}
