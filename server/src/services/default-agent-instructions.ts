import fs from "node:fs/promises";
import {
  getTaskRole,
  isTaskRoleName,
  type TaskRoleName,
} from "@paperclipai/shared";

function resolveDefaultAgentBundleUrl(fileName: string) {
  return new URL(`../onboarding-assets/default/${fileName}`, import.meta.url);
}

function renderTaskRoleChapter(
  taskRoleName: TaskRoleName,
  options?: { taskDescription?: string },
): string {
  const role = getTaskRole(taskRoleName);
  const toolsList = role.default_tools.map((tool) => `- ${tool}`).join("\n");
  const sections = [
    `# Task-Mode Role: ${role.label}`,
    "",
    role.system_prompt,
    "",
  ];

  if (options?.taskDescription) {
    sections.push(
      "## Your Assignment",
      "",
      options.taskDescription,
      "",
    );
  }

  sections.push(
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
  );

  return sections.join("\n");
}

export async function loadDefaultAgentInstructionsBundle(
  _role: string,
  options: { agentRole?: string; taskDescription?: string } = {},
): Promise<Record<string, string>> {
  const content = await fs.readFile(resolveDefaultAgentBundleUrl("AGENTS.md"), "utf8");
  const bundle: Record<string, string> = { "AGENTS.md": content };

  const agentRole = options.agentRole;
  if (agentRole && isTaskRoleName(agentRole)) {
    bundle["TASK_ROLE.md"] = renderTaskRoleChapter(agentRole, {
      taskDescription: options.taskDescription,
    });
  }

  return bundle;
}

export function resolveDefaultAgentInstructionsBundleRole(_role: string): string {
  return "default";
}
