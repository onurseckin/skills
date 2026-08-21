import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalJsonBytes,
  sha256Bytes,
} from "../../../orchestrating-long-tasks/scripts/src/core/json.ts";
import { packetLayout } from "../../../orchestrating-long-tasks/scripts/src/store/layout-packets.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function scratchRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "store-layout-packets-"));
  roots.push(root);
  return root;
}

function seedBundle(
  root: string,
  id: string,
  markdown: string,
  metadata: Record<string, unknown>,
): void {
  const bundleDir = join(root, "packets", id);
  mkdirSync(bundleDir, { recursive: true });
  writeFileSync(join(bundleDir, "packet.md"), markdown, { mode: 0o444 });
  // metadata.json must be canonical JSON (sorted keys, no whitespace) or readCanonicalObject
  // rejects it before packetMetadataDisagrees ever runs.
  writeFileSync(join(bundleDir, "metadata.json"), canonicalJsonBytes(metadata as never));
}

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    markdown_path: "packets/P-1/packet.md",
    metadata_path: "packets/P-1/metadata.json",
    status: "published",
    ...overrides,
  };
}

describe("packetLayout", () => {
  test("returns no issues when state.packets is absent or not an object", () => {
    const root = scratchRoot();
    expect(packetLayout(root, undefined)).toEqual([]);
    expect(packetLayout(root, { packets: "nope" })).toEqual([]);
  });

  test("skips a non-object declared packet entry", () => {
    const root = scratchRoot();
    expect(packetLayout(root, { packets: { "P-1": "not-an-object" } })).toEqual([]);
  });

  test("reports PACKET_ID for an id unsafe to address on disk", () => {
    const root = scratchRoot();
    const found = packetLayout(root, { packets: { "": {} } });
    expect(found).toEqual([expect.objectContaining({ code: "PACKET_ID" })]);
  });

  test("returns no issues when the record declares neither a markdown nor a metadata path", () => {
    const root = scratchRoot();
    expect(packetLayout(root, { packets: { "P-1": { status: "draft" } } })).toEqual([]);
  });

  test("reports PACKET_PATH when a declared path points outside the packet's own bundle", () => {
    const root = scratchRoot();
    const found = packetLayout(root, {
      packets: { "P-1": record({ markdown_path: "packets/P-2/packet.md" }) },
    });
    expect(found).toEqual([expect.objectContaining({ code: "PACKET_PATH" })]);
  });

  test("reports PACKET_BUNDLE_MISSING when a published packet has no bundle directory on disk", () => {
    const root = scratchRoot();
    const found = packetLayout(root, { packets: { "P-1": record() } });
    expect(found).toEqual([expect.objectContaining({ code: "PACKET_BUNDLE_MISSING" })]);
  });

  test("tolerates a missing bundle directory for a non-published packet with no issue", () => {
    const root = scratchRoot();
    const found = packetLayout(root, { packets: { "P-1": record({ status: "draft" }) } });
    expect(found).toEqual([]);
  });

  test("reports PACKET_UNREADABLE when the bundle directory exists but cannot be listed", () => {
    const root = scratchRoot();
    const bundleDir = join(root, "packets", "P-1");
    mkdirSync(bundleDir, { recursive: true });
    chmodSync(bundleDir, 0o000);
    try {
      const found = packetLayout(root, { packets: { "P-1": record() } });
      expect(found).toEqual([expect.objectContaining({ code: "PACKET_UNREADABLE" })]);
    } finally {
      chmodSync(bundleDir, 0o755);
    }
  });

  test("reports PACKET_BUNDLE_SHAPE when the bundle holds anything other than exactly packet.md and metadata.json", () => {
    const root = scratchRoot();
    const bundleDir = join(root, "packets", "P-1");
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(join(bundleDir, "packet.md"), "content", { mode: 0o444 });
    const found = packetLayout(root, { packets: { "P-1": record() } });
    expect(found.some((entry) => entry.code === "PACKET_BUNDLE_SHAPE")).toBe(true);
  });

  test("accepts a well-formed published bundle whose digest, mode and metadata all agree", () => {
    const root = scratchRoot();
    const markdown = "# packet body";
    seedBundle(root, "P-1", markdown, {
      packet_sha256: sha256Bytes(new TextEncoder().encode(markdown)),
      role: "worker",
      agent_id: "A-1",
      task_id: "T-1",
      attempt: 1,
      graph_revision: 1,
    });
    const found = packetLayout(root, {
      packets: {
        "P-1": record({
          packet_sha256: sha256Bytes(new TextEncoder().encode(markdown)),
          role: "worker",
          agent_id: "A-1",
          task_id: "T-1",
          attempt: 1,
          graph_revision: 1,
        }),
      },
    });
    expect(found).toEqual([]);
  });

  test("reports PACKET_DIGEST when the record has no recorded digest to check against", () => {
    const root = scratchRoot();
    seedBundle(root, "P-1", "content", {});
    const found = packetLayout(root, { packets: { "P-1": record() } });
    expect(found.some((entry) => entry.code === "PACKET_DIGEST")).toBe(true);
  });

  test("reports PACKET_CONTENT when the markdown digest no longer matches the recorded one", () => {
    const root = scratchRoot();
    seedBundle(root, "P-1", "content", {});
    const found = packetLayout(root, {
      packets: { "P-1": record({ packet_sha256: "a".repeat(64) }) },
    });
    expect(found.some((entry) => entry.code === "PACKET_CONTENT")).toBe(true);
  });

  test("reports PACKET_MODE when the markdown file is writable", () => {
    const root = scratchRoot();
    const markdown = "content";
    seedBundle(root, "P-1", markdown, {});
    chmodSync(join(root, "packets", "P-1", "packet.md"), 0o644);
    const found = packetLayout(root, {
      packets: {
        "P-1": record({ packet_sha256: sha256Bytes(new TextEncoder().encode(markdown)) }),
      },
    });
    expect(found.some((entry) => entry.code === "PACKET_MODE")).toBe(true);
  });

  test("reports PACKET_UNREADABLE when the markdown file cannot be read", () => {
    const root = scratchRoot();
    const bundleDir = join(root, "packets", "P-1");
    mkdirSync(bundleDir, { recursive: true });
    mkdirSync(join(bundleDir, "packet.md"));
    writeFileSync(join(bundleDir, "metadata.json"), "{}");
    const found = packetLayout(root, { packets: { "P-1": record() } });
    expect(found.some((entry) => entry.code === "PACKET_UNREADABLE")).toBe(true);
  });

  test("reports PACKET_METADATA when metadata disagrees with the declared record", () => {
    const root = scratchRoot();
    const markdown = "content";
    seedBundle(root, "P-1", markdown, { role: "worker", agent_id: "A-1" });
    const found = packetLayout(root, {
      packets: {
        "P-1": record({
          packet_sha256: sha256Bytes(new TextEncoder().encode(markdown)),
          role: "different-role",
          agent_id: "A-1",
        }),
      },
    });
    expect(found.some((entry) => entry.code === "PACKET_METADATA")).toBe(true);
  });

  test("reports PACKET_UNREADABLE when the metadata file is not readable canonical JSON", () => {
    const root = scratchRoot();
    const markdown = "content";
    const bundleDir = join(root, "packets", "P-1");
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(join(bundleDir, "packet.md"), markdown, { mode: 0o444 });
    writeFileSync(join(bundleDir, "metadata.json"), "not json");
    const found = packetLayout(root, {
      packets: {
        "P-1": record({ packet_sha256: sha256Bytes(new TextEncoder().encode(markdown)) }),
      },
    });
    expect(found.some((entry) => entry.code === "PACKET_UNREADABLE")).toBe(true);
  });

  test("reports PACKET_UNREADABLE when packets/ itself exists but is not a directory", () => {
    const root = scratchRoot();
    writeFileSync(join(root, "packets"), "not a directory");
    const found = packetLayout(root, undefined);
    expect(found).toEqual([expect.objectContaining({ code: "PACKET_UNREADABLE" })]);
  });

  test("returns no issues when packets/ does not exist and nothing is declared", () => {
    const root = scratchRoot();
    expect(packetLayout(root, undefined)).toEqual([]);
  });

  test("reports PACKET_UNDECLARED for a bundle on disk that state does not declare, ignoring dotfiles", () => {
    const root = scratchRoot();
    mkdirSync(join(root, "packets", "P-orphan"), { recursive: true });
    mkdirSync(join(root, "packets", ".hidden"), { recursive: true });
    const found = packetLayout(root, undefined);
    expect(found).toEqual([expect.objectContaining({ code: "PACKET_UNDECLARED" })]);
  });

  test("does not flag a declared packet's own bundle directory as undeclared", () => {
    const root = scratchRoot();
    const markdown = "content";
    seedBundle(root, "P-1", markdown, {});
    const found = packetLayout(root, {
      packets: {
        "P-1": record({ packet_sha256: sha256Bytes(new TextEncoder().encode(markdown)) }),
      },
    });
    expect(found.some((entry) => entry.code === "PACKET_UNDECLARED")).toBe(false);
  });
});
