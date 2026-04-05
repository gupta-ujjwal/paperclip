import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, constants } from "node:fs/promises";
import path from "node:path";
import type { Db } from "@paperclipai/db";
import { companyService } from "./companies.js";
import { notFound, unprocessable } from "../errors.js";

const execFileAsync = promisify(execFile);

const REFRESH_SCRIPT_NAME = "update-all-repos.sh";
const REFRESH_TIMEOUT_MS = 5 * 60 * 1000;

export function workspaceRefreshService(db: Db) {
  const companies = companyService(db);

  async function refresh(companyId: string) {
    const company = await companies.getById(companyId);
    if (!company) throw notFound("Task not found");

    const workspacePath = company.workspacePath?.trim();
    if (!workspacePath) {
      throw unprocessable("Task has no workspace path configured");
    }

    if (!path.isAbsolute(workspacePath)) {
      throw unprocessable("Workspace path must be absolute");
    }

    const scriptPath = path.join(workspacePath, REFRESH_SCRIPT_NAME);
    try {
      await access(scriptPath, constants.X_OK);
    } catch {
      throw unprocessable(
        `Workspace is missing executable ${REFRESH_SCRIPT_NAME}`,
      );
    }

    const started = Date.now();
    try {
      const { stdout, stderr } = await execFileAsync(scriptPath, [], {
        cwd: workspacePath,
        timeout: REFRESH_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env },
      });
      return {
        ok: true as const,
        durationMs: Date.now() - started,
        stdout,
        stderr,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stdout =
        typeof err === "object" && err && "stdout" in err
          ? String((err as { stdout?: unknown }).stdout ?? "")
          : "";
      const stderr =
        typeof err === "object" && err && "stderr" in err
          ? String((err as { stderr?: unknown }).stderr ?? "")
          : "";
      return {
        ok: false as const,
        durationMs: Date.now() - started,
        error: message,
        stdout,
        stderr,
      };
    }
  }

  return { refresh };
}

export type WorkspaceRefreshService = ReturnType<typeof workspaceRefreshService>;
