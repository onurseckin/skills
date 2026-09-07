import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { canonicalJsonBytes, sha256Bytes } from "../../../../olt/scripts/src/core/json.ts";
import { packetLayout } from "../../../../olt/scripts/src/engine/store/layout/layout-packets.ts";
import {
  chmodSync,
  cleanupVirtualStoreFS,
  getVirtualStoreFS,
  scratchRoot as makeScratchRoot,
  setupVirtualStoreFS,
} from "../../store-fixture.ts";

beforeEach(() => {
  setupVirtualStoreFS();
});

afterEach(() => {
  cleanupVirtualStoreFS();
});

function scratchRoot(label: string): string {
  return makeScratchRoot(import.meta.path, label);
}

function seedBundle(
  root: string,
  id: string,
  markdown: string,
  metadata: Record<string, unknown>,
): void {
  const vfs = getVirtualStoreFS();
  const bundleDir = join(root, "packets", id);
  vfs.mkdirSync(bundleDir, { recursive: true });
  vfs.writeFileSync(join(bundleDir, "packet.md"), markdown);
  chmodSync(join(bundleDir, "packet.md"), 0o444);
  vfs.writeFileSync(join(bundleDir, "metadata.json"), canonicalJsonBytes(metadata as never));
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
    const root = scratchRoot("returns-no-issues-when-state-packets-is-absent-or-");
    expect(packetLayout(root, undefined)).toEqual([]);
    expect(packetLayout(root, { packets: "nope" })).toEqual([]);
  });

  test("skips a non-object declared packet entry", () => {
    const root = scratchRoot("skips-a-non-object-declared-packet-entry");
    expect(packetLayout(root, { packets: { "P-1": "not-an-object" } })).toEqual([]);
  });

  test("reports PACKET_ID for an id unsafe to address on disk", () => {
    const root = scratchRoot("reports-packet-id-for-an-id-unsafe-to-address-on-d");
    const found = packetLayout(root, { packets: { "": {} } });
    expect(found).toEqual([expect.objectContaining({ code: "PACKET_ID" })]);
  });

  test("returns no issues when the record declares neither a markdown nor a metadata path", () => {
    const root = scratchRoot("returns-no-issues-when-the-record-declares-neither");
    expect(packetLayout(root, { packets: { "P-1": { status: "draft" } } })).toEqual([]);
  });

  test("reports PACKET_PATH when a declared path points outside the packet's own bundle", () => {
    const root = scratchRoot("reports-packet-path-when-a-declared-path-points-ou");
    const found = packetLayout(root, {
      packets: { "P-1": record({ markdown_path: "packets/P-2/packet.md" }) },
    });
    expect(found).toEqual([expect.objectContaining({ code: "PACKET_PATH" })]);
  });

  test("reports PACKET_BUNDLE_MISSING when a published packet has no bundle directory on disk", () => {
    const root = scratchRoot("reports-packet-bundle-missing-when-a-published-pac");
    const found = packetLayout(root, { packets: { "P-1": record() } });
    expect(found).toEqual([expect.objectContaining({ code: "PACKET_BUNDLE_MISSING" })]);
  });

  test("tolerates a missing bundle directory for a non-published packet with no issue", () => {
    const root = scratchRoot("tolerates-a-missing-bundle-directory-for-a-non-pub");
    const found = packetLayout(root, { packets: { "P-1": record({ status: "draft" }) } });
    expect(found).toEqual([]);
  });

  test("reports PACKET_UNREADABLE when the bundle directory exists but cannot be listed", () => {
    const vfs = getVirtualStoreFS();
    const root = scratchRoot("reports-packet-unreadable-when-the-bundle-director");
    const bundleDir = join(root, "packets", "P-1");
    vfs.mkdirSync(bundleDir, { recursive: true });
    chmodSync(bundleDir, 0o000);
    try {
      const found = packetLayout(root, { packets: { "P-1": record() } });
      expect(found).toEqual([expect.objectContaining({ code: "PACKET_UNREADABLE" })]);
    } finally {
      chmodSync(bundleDir, 0o755);
    }
  });

  test("reports PACKET_BUNDLE_SHAPE when the bundle holds anything other than exactly packet.md and metadata.json", () => {
    const vfs = getVirtualStoreFS();
    const root = scratchRoot("reports-packet-bundle-shape-when-the-bundle-holds-");
    const bundleDir = join(root, "packets", "P-1");
    vfs.mkdirSync(bundleDir, { recursive: true });
    vfs.writeFileSync(join(bundleDir, "packet.md"), "content");
    chmodSync(join(bundleDir, "packet.md"), 0o444);
    const found = packetLayout(root, { packets: { "P-1": record() } });
    expect(found.some((entry) => entry.code === "PACKET_BUNDLE_SHAPE")).toBe(true);
  });

  test("accepts a well-formed published bundle whose digest, mode and metadata all agree", () => {
    const root = scratchRoot("accepts-a-well-formed-published-bundle-whose-diges");
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
    const root = scratchRoot("reports-packet-digest-when-the-record-has-no-recor");
    seedBundle(root, "P-1", "content", {});
    const found = packetLayout(root, { packets: { "P-1": record() } });
    expect(found.some((entry) => entry.code === "PACKET_DIGEST")).toBe(true);
  });

  test("reports PACKET_CONTENT when the markdown digest no longer matches the recorded one", () => {
    const root = scratchRoot("reports-packet-content-when-the-markdown-digest-no");
    seedBundle(root, "P-1", "content", {});
    const found = packetLayout(root, {
      packets: { "P-1": record({ packet_sha256: "a".repeat(64) }) },
    });
    expect(found.some((entry) => entry.code === "PACKET_CONTENT")).toBe(true);
  });
});
