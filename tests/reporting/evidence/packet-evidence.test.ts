import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { join } from "node:path";
import { canonicalJsonBytes } from "../../../olt/scripts/src/core/json.ts";
import { packetEvidenceIssues } from "../../../olt/scripts/src/reporting/packet-evidence.ts";
import type { PacketRecord } from "../../../olt/scripts/src/workflow/types.ts";
import {
  cleanupVirtualBrowserFS,
  setupVirtualBrowserFS,
  tempDir,
} from "../browser/browser-virtual-fs.ts";

function packet(overrides: Partial<PacketRecord> = {}): PacketRecord {
  return {
    id: "P-1",
    status: "published",
    role: "implementer",
    agent_id: "worker-1",
    task_id: "task-1",
    attempt: 1,
    graph_revision: 1,
    markdown_path: "packets/P-1/packet.md",
    metadata_path: "packets/P-1/metadata.json",
    packet_sha256: "",
    published_at: "2026-08-19T00:00:00.000Z",
    ...overrides,
  };
}

function writePacket(
  root: string,
  record: PacketRecord,
  markdown: string,
  metadataOverrides: Record<string, unknown> = {},
): PacketRecord {
  const digest = createHash("sha256").update(markdown).digest("hex");
  const sealed: PacketRecord = { ...record, packet_sha256: digest };
  const dir = join(root, "packets", record.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, "packet.md"), markdown, "utf-8");
  const metadata = {
    packet_sha256: sealed.packet_sha256,
    role: sealed.role,
    agent_id: sealed.agent_id,
    task_id: sealed.task_id,
    attempt: sealed.attempt,
    graph_revision: sealed.graph_revision,
    ...metadataOverrides,
  };
  fs.writeFileSync(join(dir, "metadata.json"), Buffer.from(canonicalJsonBytes(metadata)), "utf-8");
  return sealed;
}

export const packetEvidenceSuiteName = "packetEvidenceIssues";

describe(packetEvidenceSuiteName, () => {
  beforeEach(() => {
    setupVirtualBrowserFS();
  });

  afterEach(() => {
    cleanupVirtualBrowserFS();
  });

  test("an untampered packet on disk matching its durable record has no issues", () => {
    const root = tempDir("packet-evidence");
    const record = writePacket(root, packet(), "# Packet body");

    expect(packetEvidenceIssues(root, { "P-1": record })).toEqual([]);
  });

  test("flags a record whose recorded paths do not follow the packet id convention", () => {
    const root = tempDir("packet-evidence-wrong");
    const record = writePacket(
      root,
      packet({ markdown_path: "packets/WRONG/packet.md" }),
      "# Body",
    );

    const issues = packetEvidenceIssues(root, { "P-1": record });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("recorded paths do not match the packet identifier");
  });

  test("flags a packet whose markdown file is missing", () => {
    const root = tempDir("packet-evidence-missing");
    const record = packet({ packet_sha256: "a".repeat(64) });

    const issues = packetEvidenceIssues(root, { "P-1": record });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("P-1");
  });

  test("flags a packet whose markdown bytes no longer match the sealed digest", () => {
    const root = tempDir("packet-evidence-tampered");
    const record = writePacket(root, packet(), "# Original body");
    fs.writeFileSync(join(root, "packets", "P-1", "packet.md"), "# Tampered body", "utf-8");

    const issues = packetEvidenceIssues(root, { "P-1": record });
    expect(issues[0]).toContain("markdown digest differs");
  });

  test("flags a packet whose metadata.json disagrees with the durable record", () => {
    const root = tempDir("packet-evidence-meta");
    const record = writePacket(root, packet(), "# Body", { agent_id: "someone-else" });

    const issues = packetEvidenceIssues(root, { "P-1": record });
    expect(issues[0]).toContain("metadata differs from durable state");
  });

  test("checks every mismatched metadata field: role, task_id, attempt, graph_revision", () => {
    for (const overrides of [
      { role: "other-role" },
      { task_id: "other-task" },
      { attempt: 99 },
      { graph_revision: 99 },
    ]) {
      const root = tempDir("packet-evidence-fields");
      const record = writePacket(root, packet(), "# Body", overrides);
      expect(packetEvidenceIssues(root, { "P-1": record })[0]).toContain(
        "metadata differs from durable state",
      );
    }
  });

  test("reports multiple packets sorted by id", () => {
    const root = tempDir("packet-evidence-multiple");
    const second = writePacket(
      root,
      packet({
        id: "P-2",
        markdown_path: "packets/P-2/packet.md",
        metadata_path: "packets/P-2/metadata.json",
      }),
      "# Body 2",
    );
    const first = packet({ packet_sha256: "b".repeat(64) });

    const issues = packetEvidenceIssues(root, { "P-2": second, "P-1": first });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("P-1");
  });

  test("no packets means no issues", () => {
    expect(packetEvidenceIssues(tempDir("packet-evidence-none"), {})).toEqual([]);
  });
});
