import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPacketBundle,
  verifyPacketBundle,
} from "../../../olt/scripts/src/packets/packet-bundle.ts";
import type { BuiltPacket } from "../../../olt/scripts/src/packets/types.ts";

function root(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

function packet(overrides: Partial<BuiltPacket> = {}): BuiltPacket {
  return {
    markdown: "# Packet",
    metadata: { schema: "harness.packet-metadata", version: 1, id: "pkt-1" },
    ...overrides,
  };
}

describe("createPacketBundle", () => {
  test("writes the bundle once and refuses a second write for the same id", () => {
    const bundleRoot = root("packet-bundle-once-");
    const first = createPacketBundle(bundleRoot, "pkt-1", packet(), false);
    expect(first.markdownPath).toBe(join(bundleRoot, "pkt-1", "packet.md"));

    expect(() => createPacketBundle(bundleRoot, "pkt-1", packet(), false)).toThrow(
      "packet bundle already exists: pkt-1",
    );
  });

  test("allowExact returns the same paths when the bundle already matches byte-for-byte", () => {
    const bundleRoot = root("packet-bundle-exact-");
    const built = packet();
    createPacketBundle(bundleRoot, "pkt-1", built, false);
    const again = createPacketBundle(bundleRoot, "pkt-1", built, true);
    expect(again.markdownPath).toBe(join(bundleRoot, "pkt-1", "packet.md"));
  });

  test("allowExact still refuses when the existing bundle differs from the requested one", () => {
    const bundleRoot = root("packet-bundle-differs-");
    createPacketBundle(bundleRoot, "pkt-1", packet({ markdown: "# Original" }), false);
    expect(() =>
      createPacketBundle(bundleRoot, "pkt-1", packet({ markdown: "# Changed" }), true),
    ).toThrow("packet bundle already exists: pkt-1");
  });

  test("rejects a packet id that is not safe to address on disk", () => {
    const bundleRoot = root("packet-bundle-unsafe-id-");
    expect(() => createPacketBundle(bundleRoot, "../escape", packet(), false)).toThrow(
      "unsafe packet id",
    );
  });

  test("cleans up its temporary directory when the write fails partway through", () => {
    const bundleRoot = root("packet-bundle-cleanup-");
    // A non-finite number can't be canonically encoded — canonicalJsonBytes throws while
    // building metadata.json, after the temp directory already exists.
    const broken = { markdown: "# x", metadata: { value: Number.NaN } } as unknown as BuiltPacket;
    expect(() => createPacketBundle(bundleRoot, "pkt-1", broken, false)).toThrow(
      "JSON numbers must be finite",
    );
    // No leftover .pkt-1.<uuid>.tmp directory, and no partial "pkt-1" bundle either.
    expect(readdirSync(bundleRoot)).toEqual([]);
  });
});

describe("verifyPacketBundle", () => {
  test("returns the bundle paths when the on-disk bundle matches the packet exactly", () => {
    const bundleRoot = root("packet-bundle-verify-ok-");
    const built = packet();
    createPacketBundle(bundleRoot, "pkt-1", built, false);
    const verified = verifyPacketBundle(bundleRoot, "pkt-1", built);
    expect(verified.metadataPath).toBe(join(bundleRoot, "pkt-1", "metadata.json"));
  });

  test("rejects when no bundle exists on disk for the id", () => {
    const bundleRoot = root("packet-bundle-verify-missing-");
    expect(() => verifyPacketBundle(bundleRoot, "pkt-absent", packet())).toThrow(
      "packet bundle is missing or differs: pkt-absent",
    );
  });

  test("rejects when the on-disk markdown no longer matches the packet", () => {
    const bundleRoot = root("packet-bundle-verify-tampered-");
    createPacketBundle(bundleRoot, "pkt-1", packet(), false);
    const markdownPath = join(bundleRoot, "pkt-1", "packet.md");
    chmodSync(markdownPath, 0o644); // createPacketBundle wrote it read-only (0o444)
    writeFileSync(markdownPath, "# Tampered");
    expect(() => verifyPacketBundle(bundleRoot, "pkt-1", packet())).toThrow(
      "packet bundle is missing or differs: pkt-1",
    );
  });

  test("rejects when the bundle directory holds the wrong set of files", () => {
    const bundleRoot = root("packet-bundle-verify-extra-file-");
    createPacketBundle(bundleRoot, "pkt-1", packet(), false);
    writeFileSync(join(bundleRoot, "pkt-1", "extra.txt"), "surprise");
    expect(() => verifyPacketBundle(bundleRoot, "pkt-1", packet())).toThrow(
      "packet bundle is missing or differs: pkt-1",
    );
  });

  test("rejects when the bundle path is a file rather than a directory", () => {
    const bundleRoot = root("packet-bundle-verify-not-dir-");
    mkdirSync(bundleRoot, { recursive: true });
    writeFileSync(join(bundleRoot, "pkt-1"), "not a directory");
    expect(() => verifyPacketBundle(bundleRoot, "pkt-1", packet())).toThrow(
      "packet bundle is missing or differs: pkt-1",
    );
  });
});
