import type { CommandSpec } from "../cli/registry/types.ts";
import { HarnessError } from "../core/errors/index.ts";
import {
  formatHardlockRemediation,
  resolveCurrentHost,
  type DetectedHost,
} from "./command-authority-remediation.ts";

export function isMechanicValidatorRole(role: string): boolean {
  const normalized = role.toLowerCase().trim();
  return (
    normalized === "mechanic-validator" ||
    normalized === "ui-mechanic-validator" ||
    normalized === "ui-headless-validator" ||
    normalized === "mechanic_validator" ||
    normalized.startsWith("mechanic-") ||
    normalized.endsWith("-mechanic-validator")
  );
}

export function isCognitiveValidatorRole(role: string): boolean {
  const normalized = role.toLowerCase().trim();
  if (isMechanicValidatorRole(normalized)) return false;
  return (
    normalized === "validator" ||
    normalized === "ui-validator" ||
    normalized === "ui-optical-validator" ||
    normalized.startsWith("validator-")
  );
}

export const EXECUTION_COMMANDS: ReadonlySet<string> = new Set(["run:exec"]);

export const PROHIBITED_COGNITIVE_TOOL_CATEGORIES: ReadonlySet<string> = new Set([
  "shell",
  "test-runner",
  "build",
  "package-manager",
  "bash",
  "terminal",
  "exec",
]);

export const PROHIBITED_COGNITIVE_TOOLS: ReadonlySet<string> = new Set([
  "run_command",
  "bash",
  "sh",
  "zsh",
  "exec",
  "terminal",
  "test_runner",
  "bun_test",
  "npm_test",
]);

export function isExecutionCommand(spec: CommandSpec): boolean {
  return [spec.name, ...spec.aliases].some((name) => EXECUTION_COMMANDS.has(name));
}

export function isExecutionToolCategory(category: string): boolean {
  return PROHIBITED_COGNITIVE_TOOL_CATEGORIES.has(category.toLowerCase().trim());
}

export function isProhibitedCognitiveTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase().trim();
  return (
    PROHIBITED_COGNITIVE_TOOLS.has(normalized) ||
    PROHIBITED_COGNITIVE_TOOL_CATEGORIES.has(normalized)
  );
}

export function assertCognitiveValidatorHardlock(
  role: string,
  invocationOrTool: string,
  agentId?: string,
  host?: DetectedHost,
): void {
  if (isCognitiveValidatorRole(role) && !isMechanicValidatorRole(role)) {
    const norm = invocationOrTool.toLowerCase().trim();
    if (norm === "run:exec" || isExecutionToolCategory(norm) || isProhibitedCognitiveTool(norm)) {
      const agentDisplay = agentId ? `agent ${agentId}` : `role ${role}`;
      const activeHost = host !== undefined ? host : resolveCurrentHost();
      const remediation = formatHardlockRemediation(activeHost);
      throw new HarnessError(
        "ROLE_CONFINEMENT_VIOLATION",
        `Cognitive Validator Hard-Lock Interlock: ${agentDisplay} holds a cognitive validator/critic grant and is strictly banned from executing bash/shell commands or running test suites (${invocationOrTool}). Test execution authority belongs exclusively to mechanic validators. ${remediation}`,
      );
    }
  }
}
