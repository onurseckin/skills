import type { AgentMetadata } from "../../../olt/scripts/src/runtime/index.ts";

export function createSyntheticToolchainPackageJson(): Record<string, unknown> {
  return {
    name: "synthetic-project",
    version: "1.0.0",
    scripts: {
      test: "bun test",
      build: "bun build",
      lint: "eslint .",
    },
    dependencies: {
      typescript: "^5.0.0",
    },
  };
}

export function createSyntheticAgentMetadata(agentId: string = "impl-1"): Record<string, unknown> {
  return {
    agent_id: agentId,
    role: "implementer",
    tier: 3,
    write_scope: ["olt/scripts/src/runtime/index.ts"],
    allowed_read_scope: ["olt/scripts/src/runtime"],
    can_execute_shell: true,
    spawned_at: "2026-08-26T00:00:00.000Z",
  };
}
