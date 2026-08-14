import { createHash } from "node:crypto";
import { readCanonicalObject } from "../core/json.ts";
import { readRegularFileNoFollow } from "../core/no-follow.ts";
import { safeRepoPath } from "../core/paths.ts";
import type { PacketRecord } from "../workflow/types.ts";

function mismatch(record: PacketRecord, metadata: Record<string, unknown>): boolean {
  return (
    metadata.packet_sha256 !== record.packet_sha256 ||
    metadata.role !== record.role ||
    metadata.agent_id !== record.agent_id ||
    metadata.task_id !== record.task_id ||
    metadata.attempt !== record.attempt ||
    metadata.graph_revision !== record.graph_revision
  );
}

export function packetEvidenceIssues(
  runRoot: string,
  packets: Record<string, PacketRecord>,
): string[] {
  const issues: string[] = [];
  for (const record of Object.values(packets).sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    try {
      if (
        record.markdown_path !== `packets/${record.id}/packet.md` ||
        record.metadata_path !== `packets/${record.id}/metadata.json`
      ) {
        throw new Error("recorded paths do not match the packet identifier");
      }
      const markdownPath = safeRepoPath(runRoot, record.markdown_path);
      const metadataPath = safeRepoPath(runRoot, record.metadata_path);
      const markdown = readRegularFileNoFollow(markdownPath);
      const digest = createHash("sha256").update(markdown).digest("hex");
      const metadata = readCanonicalObject(metadataPath, `packet ${record.id} metadata`, {
        maxBytes: 1024 * 1024,
        maxDepth: 32,
      });
      if (digest !== record.packet_sha256) throw new Error("markdown digest differs");
      if (mismatch(record, metadata)) throw new Error("metadata differs from durable state");
    } catch (error) {
      issues.push(`packet ${record.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return issues;
}
