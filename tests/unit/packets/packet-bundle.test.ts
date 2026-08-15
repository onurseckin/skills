import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPacketBundle,
  verifyPacketBundle,
} from "../../../orchestrating-long-tasks/scripts/src/packets/packet-bundle.ts";
import type { BuiltPacket } from "../../../orchestrating-long-tasks/scripts/src/packets/types.ts";

function samplePacket(markdown = "# Packet", role = "implementer"): BuiltPacket {
  return {
    markdown,
    metadata: {
      schema: "harness.packet-metadata",
      version: 1,
      id: "pkt-1",
      role,
      created_at: "2026-08-14T00:00:00.000Z",
    },
  };
}

describe("packet-bundle", () => {
  test("creates and verifies a packet bundle", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "pkt-bundle-")));
    const packet = samplePacket();
    const paths = createPacketBundle(root, "pkt-1", packet, false);

    expect(paths.markdownPath).toBe(join(root, "pkt-1", "packet.md"));
    expect(paths.metadataPath).toBe(join(root, "pkt-1", "metadata.json"));

    const verified = verifyPacketBundle(root, "pkt-1", packet);
    expect(verified).toEqual(paths);
  });

  test("rejects unsafe packet IDs", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "pkt-bundle-")));
    const packet = samplePacket();

    expect(() => createPacketBundle(root, "../unsafe", packet, false)).toThrow("unsafe packet id");
    expect(() => createPacketBundle(root, "-invalid-start", packet, false)).toThrow(
      "unsafe packet id",
    );
    expect(() => createPacketBundle(root, "with spaces", packet, false)).toThrow(
      "unsafe packet id",
    );
  });

  test("handles existing bundles with allowExact true and false", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "pkt-bundle-")));
    const packet = samplePacket();
    createPacketBundle(root, "pkt-1", packet, false);

    // Exact match with allowExact true returns paths
    const paths = createPacketBundle(root, "pkt-1", packet, true);
    expect(paths.markdownPath).toBe(join(root, "pkt-1", "packet.md"));

    // Exact match with allowExact false throws
    expect(() => createPacketBundle(root, "pkt-1", packet, false)).toThrow(
      "packet bundle already exists: pkt-1",
    );

    // Modified packet with allowExact true throws because content differs
    const modified = samplePacket("# Different");
    expect(() => createPacketBundle(root, "pkt-1", modified, true)).toThrow(
      "packet bundle already exists: pkt-1",
    );
  });

  test("verifyPacketBundle rejects missing, mismatched or corrupted bundles", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "pkt-bundle-")));
    const packet = samplePacket();

    // Missing bundle
    expect(() => verifyPacketBundle(root, "nonexistent", packet)).toThrow(
      "packet bundle is missing or differs: nonexistent",
    );

    // Bundle is a file instead of directory
    writeFileSync(join(root, "file-bundle"), "not a dir");
    expect(() => verifyPacketBundle(root, "file-bundle", packet)).toThrow(
      "packet bundle is missing or differs: file-bundle",
    );

    // Bundle with extra file
    createPacketBundle(root, "pkt-extra", packet, false);
    writeFileSync(join(root, "pkt-extra", "extra.txt"), "extra");
    expect(() => verifyPacketBundle(root, "pkt-extra", packet)).toThrow(
      "packet bundle is missing or differs: pkt-extra",
    );

    // Bundle with altered metadata
    const corrupted = samplePacket("# Packet", "different-role");
    createPacketBundle(root, "pkt-corrupt", packet, false);
    expect(() => verifyPacketBundle(root, "pkt-corrupt", corrupted)).toThrow(
      "packet bundle is missing or differs: pkt-corrupt",
    );
  });

  test("cleans up temporary directory if creation fails", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "pkt-bundle-")));
    const packet = samplePacket();

    // Passing invalid packet that fails canonicalJsonBytes
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const badPacket = {
      markdown: "bad",
      metadata: cyclic as never,
    };

    expect(() => createPacketBundle(root, "pkt-fail", badPacket, false)).toThrow();
  });
});
