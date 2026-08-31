import type { RepoPolicy } from "../../../olt/scripts/src/policy/index.ts";
import type { AgentMetadata } from "../../../olt/scripts/src/runtime/index.ts";

export const samplePolicy: RepoPolicy = {
  schema_version: 1,
  ecosystem: "bun",
  package_manager: "bun",
  test_runner: {
    default_command: "bun test",
    targeted_pattern: "bun test <path>",
    full_suite_command: "bun test",
  },
  typecheck_command: "bun run typecheck",
  lint_command: "bun run lint",
  allowed_commands: ["bun test", "git status"],
  forbidden_commands: ["git commit", "git push", "rm -rf /", "curl"],
};

export const createActor = (role: string, canExec?: boolean, id = "actor-1"): AgentMetadata => ({
  agent_id: id,
  role,
  tier: 3,
  write_scope: ["src/foo.ts"],
  allowed_read_scope: [],
  can_execute_shell: canExec ?? true,
  spawned_at: new Date().toISOString(),
});
