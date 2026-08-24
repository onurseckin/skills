import { spawnSync } from "child_process";

export interface ValidatorConfig {
  role: string;
  can_execute_shell: boolean;
}

export function enforceValidatorCommandLock(role: string): ValidatorConfig {
  const isCognitive = role === "validator" || role === "cognitive" || role.includes("cognitive");
  return {
    role,
    can_execute_shell: !isCognitive,
  };
}

export function performMechanicAutomatedChecks(
  taskId: string,
  targetFiles: string[],
): { success: boolean; output: string } {
  // Ensure mechanic validators perform automated AST audits and typechecks via task:check
  const args = ["task:check", "--task", taskId, ...targetFiles.flatMap((f) => ["--file", f])];
  const result = spawnSync("bun", args, { encoding: "utf-8" });

  return {
    success: result.status === 0,
    output: result.stdout || result.stderr,
  };
}
