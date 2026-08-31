import { createAgentMetadata } from "../../../olt/scripts/src/runtime/metadata.ts";
import type { AgentMetadata } from "../../../olt/scripts/src/runtime/metadata.ts";

export function createTestAgentMetadata(
  agentId = "test-agent",
  role = "implementer",
  canExecuteShell = true,
): AgentMetadata {
  return createAgentMetadata({
    agent_id: agentId,
    role,
    write_scope: ["."],
    can_execute_shell: canExecuteShell,
  });
}
