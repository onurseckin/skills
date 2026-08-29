import type { JsonObject } from "../core/contracts/index.ts";
import { HarnessError } from "../core/errors/index.ts";
import { utc } from "../workflow/task-state.ts";
import type { PacketRecord } from "../workflow/types.ts";
import type { BuiltPacket } from "./types.ts";
import { validateRepositoryBinding } from "../workflow/completion/repository-binding.ts";

export function metadataText(metadata: JsonObject, field: string): string {
  const value = metadata[field];
  if (typeof value !== "string" || value === "")
    throw new HarnessError("INTEGRITY", `packet metadata ${field} is invalid`);
  return value;
}

export function metadataInteger(metadata: JsonObject, field: string, minimum = 1): number {
  const value = metadata[field];
  if (!Number.isSafeInteger(value) || (value as number) < minimum)
    throw new HarnessError("INTEGRITY", `packet metadata ${field} is invalid`);
  return value as number;
}

export function packetRecord(id: string, packet: BuiltPacket, at: Date): PacketRecord {
  const repositoryIds = packet.metadata.repository_command_ids;
  const integritySha = packet.metadata.integrity_evidence_sha256;
  const readinessSha = packet.metadata.readiness_sha256;
  const repositoryBinding = packet.metadata.repository_binding;
  return {
    id,
    status: "preparing",
    role: metadataText(packet.metadata, "role"),
    agent_id: metadataText(packet.metadata, "agent_id"),
    task_id: packet.metadata.task_id as string | null,
    attempt: metadataInteger(packet.metadata, "attempt"),
    graph_revision: metadataInteger(packet.metadata, "graph_revision", 0),
    markdown_path: `packets/${id}/packet.md`,
    metadata_path: `packets/${id}/metadata.json`,
    packet_sha256: metadataText(packet.metadata, "packet_sha256"),
    ...(Array.isArray(repositoryIds)
      ? { repository_command_ids: [...repositoryIds] as string[] }
      : {}),
    ...(typeof integritySha === "string" ? { integrity_evidence_sha256: integritySha } : {}),
    ...(typeof readinessSha === "string" ? { readiness_sha256: readinessSha } : {}),
    ...(repositoryBinding === undefined
      ? {}
      : {
          repository_binding: validateRepositoryBinding(
            repositoryBinding,
            "packet repository binding",
          ),
        }),
    published_at: utc(at),
  };
}
