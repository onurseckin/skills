import { join } from "node:path";
import type { AgentRole } from "../../contracts/packets.ts";
import { readCanonicalObject } from "../../core/json.ts";
import { readRegularFileNoFollow } from "../../core/no-follow.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import type { BuiltPacket } from "../../packets/types.ts";
import { packetEvidenceIssues } from "../../reporting/packet-evidence.ts";
import type { PacketRecord, WorkflowState } from "../../workflow/types.ts";

export interface PacketRetry {
  packet: BuiltPacket;
  record: PacketRecord;
}

export function loadPublishedPacketRetry(
  runRoot: string,
  id: string,
  role: AgentRole,
  agentId: string,
  taskId: string | undefined,
  state: WorkflowState,
): PacketRetry | undefined {
  const record = state.packets?.[id];
  if (!record) return undefined;
  if (
    record.status !== "published" ||
    record.role !== role ||
    record.agent_id !== agentId ||
    record.task_id !== (taskId ?? null)
  ) {
    throw new HarnessError("INVALID_STATE", `packet retry identity differs: ${id}`);
  }
  const issues = packetEvidenceIssues(runRoot, { [id]: record });
  if (issues.length > 0) throw new HarnessError("INTEGRITY", issues.join("; "));
  const markdown = new TextDecoder("utf-8", { fatal: true }).decode(
    readRegularFileNoFollow(join(runRoot, record.markdown_path)),
  );
  const metadata = readCanonicalObject(
    join(runRoot, record.metadata_path),
    `packet ${id} metadata`,
    { maxBytes: 1024 * 1024, maxDepth: 32 },
  );
  return { packet: { markdown, metadata }, record };
}
