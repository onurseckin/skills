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

describe("packetLayout - content and directory validation", () => {
  test("reports PACKET_MODE when the markdown file is writable", () => {
    const root = scratchRoot("reports-packet-mode-when-the-markdown-file-is-writ");
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
    const vfs = getVirtualStoreFS();
    const root = scratchRoot("reports-packet-unreadable-when-the-markdown-file-c");
    const bundleDir = join(root, "packets", "P-1");
    vfs.mkdirSync(bundleDir, { recursive: true });
    vfs.mkdirSync(join(bundleDir, "packet.md"));
    vfs.writeFileSync(join(bundleDir, "metadata.json"), "{}");
    const found = packetLayout(root, { packets: { "P-1": record() } });
    expect(found.some((entry) => entry.code === "PACKET_UNREADABLE")).toBe(true);
  });

  test("reports PACKET_METADATA when metadata disagrees with the declared record", () => {
    const root = scratchRoot("reports-packet-metadata-when-metadata-disagrees-wi");
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
    const vfs = getVirtualStoreFS();
    const root = scratchRoot("reports-packet-unreadable-when-the-metadata-file-i");
    const markdown = "content";
    const bundleDir = join(root, "packets", "P-1");
    vfs.mkdirSync(bundleDir, { recursive: true });
    vfs.writeFileSync(join(bundleDir, "packet.md"), markdown);
    chmodSync(join(bundleDir, "packet.md"), 0o444);
    vfs.writeFileSync(join(bundleDir, "metadata.json"), "not json");
    const found = packetLayout(root, {
      packets: {
        "P-1": record({ packet_sha256: sha256Bytes(new TextEncoder().encode(markdown)) }),
      },
    });
    expect(found.some((entry) => entry.code === "PACKET_UNREADABLE")).toBe(true);
  });

  test("reports PACKET_UNREADABLE when packets/ itself exists but is not a directory", () => {
    const vfs = getVirtualStoreFS();
    const root = scratchRoot("reports-packet-unreadable-when-packets-itself-exis");
    vfs.writeFileSync(join(root, "packets"), "not a directory");
    const found = packetLayout(root, undefined);
    expect(found).toEqual([expect.objectContaining({ code: "PACKET_UNREADABLE" })]);
  });

  test("returns no issues when packets/ does not exist and nothing is declared", () => {
    const root = scratchRoot("returns-no-issues-when-packets-does-not-exist-and-");
    expect(packetLayout(root, undefined)).toEqual([]);
  });

  test("reports PACKET_UNDECLARED for a bundle on disk that state does not declare, ignoring dotfiles", () => {
    const vfs = getVirtualStoreFS();
    const root = scratchRoot("reports-packet-undeclared-for-a-bundle-on-disk-tha");
    vfs.mkdirSync(join(root, "packets", "P-orphan"), { recursive: true });
    vfs.mkdirSync(join(root, "packets", ".hidden"), { recursive: true });
    const found = packetLayout(root, undefined);
    expect(found).toEqual([expect.objectContaining({ code: "PACKET_UNDECLARED" })]);
  });

  test("does not flag a declared packet's own bundle directory as undeclared", () => {
    const root = scratchRoot("does-not-flag-a-declared-packet-s-own-bundle-direc");
    const markdown = "content";
    seedBundle(root, "P-1", markdown, {});
    const found = packetLayout(root, {
      packets: {
        "P-1": record({ packet_sha256: sha256Bytes(new TextEncoder().encode(markdown)) }),
      },
    });
    expect(found.some((entry) => entry.code === "PACKET_UNDECLARED")).toBe(false);
  });

  test("reports PACKET_BUNDLE_SHAPE when extra stray files or directories exist inside the bundle", () => {
    const vfs = getVirtualStoreFS();
    const root = scratchRoot("extra-stray-files-in-bundle");
    const markdown = "# packet body";
    seedBundle(root, "P-1", markdown, {
      packet_sha256: sha256Bytes(new TextEncoder().encode(markdown)),
    });

    vfs.writeFileSync(join(root, "packets", "P-1", "notes.txt"), "stray notes");
    vfs.mkdirSync(join(root, "packets", "P-1", "drafts"), { recursive: true });

    const found = packetLayout(root, {
      packets: {
        "P-1": record({
          packet_sha256: sha256Bytes(new TextEncoder().encode(markdown)),
        }),
      },
    });
    expect(found.some((entry) => entry.code === "PACKET_BUNDLE_SHAPE")).toBe(true);
  });

  test("reports PACKET_UNREADABLE when metadata.json has non-canonical formatting with whitespace and indentation", () => {
    const vfs = getVirtualStoreFS();
    const root = scratchRoot("non-canonical-metadata-formatting");
    const markdown = "content";
    const bundleDir = join(root, "packets", "P-1");
    vfs.mkdirSync(bundleDir, { recursive: true });
    vfs.writeFileSync(join(bundleDir, "packet.md"), markdown);
    chmodSync(join(bundleDir, "packet.md"), 0o444);

    const formattedJson = JSON.stringify(
      {
        packet_sha256: sha256Bytes(new TextEncoder().encode(markdown)),
        role: "worker",
      },
      null,
      2,
    );
    vfs.writeFileSync(join(bundleDir, "metadata.json"), formattedJson);

    const found = packetLayout(root, {
      packets: {
        "P-1": record({ packet_sha256: sha256Bytes(new TextEncoder().encode(markdown)) }),
      },
    });
    expect(found.some((entry) => entry.code === "PACKET_UNREADABLE")).toBe(true);
  });
});
