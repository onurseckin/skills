import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createMarker,
  markerPath,
  MARKER_SCHEMA,
  readMarker,
  type TransactionMarker,
  type TransactionStage,
} from "../../orchestrating-long-tasks/scripts/src/installer/transaction-marker.ts";
import { canonicalJsonBytes } from "../../orchestrating-long-tasks/scripts/src/core/json.ts";
import type { JsonObject } from "../../orchestrating-long-tasks/scripts/src/contracts/json.ts";
import { cleanInstallerFixtures, installerFixture } from "../unit/installer/helpers.ts";

afterEach(cleanInstallerFixtures);

describe("installer transaction marker", () => {
  const uuid = randomUUID();

  function sampleMarker(
    destination: string,
    overrides: Partial<TransactionMarker> = {},
  ): TransactionMarker {
    return {
      schema: MARKER_SCHEMA,
      pid: process.pid,
      lock_device: "12345",
      lock_inode: "67890",
      destination,
      temporary: `${destination}.tmp-${uuid}`,
      backup: `${destination}.old-${uuid}`,
      backup_quarantine: `${destination}.delete-${uuid}`,
      old_device: null,
      old_inode: null,
      source_sha256: "a".repeat(64),
      stage: "prepared",
      ...overrides,
    };
  }

  test("markerPath constructs the hidden marker filename", async () => {
    const { root } = await installerFixture();
    expect(markerPath(root)).toBe(join(root, ".orchestrating-long-tasks.install-transaction.json"));
  });

  test("createMarker and readMarker work with null old identity across all stages", async () => {
    const { root } = await installerFixture();
    const destination = join(root, "dest");
    const mPath = markerPath(root);

    const stages: TransactionStage[] = [
      "prepared",
      "old-move-intent",
      "old-moved",
      "publish-intent",
      "published",
      "backup-delete-intent",
      "backup-quarantined",
      "committed",
    ];

    for (const stage of stages) {
      const marker = sampleMarker(destination, { stage });
      const currentPath = `${mPath}-${stage}`;
      createMarker(currentPath, marker);
      const read = readMarker(currentPath, destination);
      expect(read).toEqual(marker);
    }
  });

  test("readMarker accepts numeric string old identity", async () => {
    const { root } = await installerFixture();
    const destination = join(root, "dest");
    const mPath = join(root, "old-identity-marker.json");

    const marker = sampleMarker(destination, {
      old_device: "999",
      old_inode: "888",
    });
    createMarker(mPath, marker);
    expect(readMarker(mPath, destination)).toEqual(marker);
  });

  test("createMarker fails if file already exists", async () => {
    const { root } = await installerFixture();
    const destination = join(root, "dest");
    const mPath = markerPath(root);
    const marker = sampleMarker(destination);

    createMarker(mPath, marker);
    expect(() => createMarker(mPath, marker)).toThrow();
  });

  test("readMarker rejects invalid marker schemas and fields", async () => {
    const { root } = await installerFixture();
    const destination = join(root, "dest");
    const mPath = join(root, "test-invalid.json");

    const checkInvalid = async (invalidObj: JsonObject) => {
      await writeFile(mPath, canonicalJsonBytes(invalidObj));
      expect(() => readMarker(mPath, destination)).toThrow(/invalid installer transaction marker/);
    };

    const valid = sampleMarker(destination);

    await checkInvalid({ ...valid, schema: "wrong-schema" });
    await checkInvalid({ ...valid, pid: -1 });
    await checkInvalid({ ...valid, pid: 0 });
    await checkInvalid({ ...valid, lock_device: "not-a-number" });
    await checkInvalid({ ...valid, lock_inode: "not-a-number" });
    await checkInvalid({ ...valid, destination: "/other/destination" });
    await checkInvalid({ ...valid, temporary: `${destination}.wrong-name` });
    await checkInvalid({ ...valid, temporary: `/other/path.tmp-${uuid}` });
    await checkInvalid({ ...valid, backup: `${destination}.wrong-name` });
    await checkInvalid({ ...valid, backup_quarantine: `${destination}.wrong-name` });
    await checkInvalid({ ...valid, old_device: "123", old_inode: null });
    await checkInvalid({ ...valid, old_device: null, old_inode: "123" });
    await checkInvalid({ ...valid, old_device: "abc", old_inode: "123" });
    await checkInvalid({ ...valid, source_sha256: "short" });
    await checkInvalid({ ...valid, source_sha256: "z".repeat(64) });
    await checkInvalid({ ...valid, stage: "invalid-stage" });
  });
});
