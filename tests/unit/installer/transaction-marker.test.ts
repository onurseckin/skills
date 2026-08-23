import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJsonBytes } from "../../../olt/scripts/src/core/json.ts";
import type { JsonValue } from "../../../olt/scripts/src/core/contracts/json.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import {
  createMarker,
  markerPath,
  MARKER_SCHEMA,
  readMarker,
  type TransactionMarker,
} from "../../../olt/scripts/src/installer/transaction-marker.ts";
import { SKILL_NAME } from "../../../olt/scripts/src/installer/constants.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

const validDigest = "c".repeat(64);

function baseMarker(
  destination: string,
  overrides: Partial<TransactionMarker> = {},
): TransactionMarker {
  return {
    schema: MARKER_SCHEMA,
    pid: 4242,
    lock_device: "12",
    lock_inode: "34",
    destination,
    temporary: `${destination}.tmp-${randomUUID()}`,
    backup: `${destination}.old-${randomUUID()}`,
    backup_quarantine: `${destination}.delete-${randomUUID()}`,
    old_device: null,
    old_inode: null,
    source_sha256: validDigest,
    stage: "prepared",
    ...overrides,
  };
}

describe("markerPath", () => {
  test("builds a dotfile name scoped to the skill inside the parent directory", () => {
    expect(markerPath("/some/parent")).toBe(
      join("/some/parent", `.${SKILL_NAME}.install-transaction.json`),
    );
  });
});

describe("createMarker + readMarker round trip", () => {
  test("writes a marker that reads back with identical field values", () => {
    const root = scratchRoot(import.meta.path, "round-trip");
    const destination = join(root, "dest");
    const path = markerPath(root);
    const marker = baseMarker(destination);
    createMarker(path, marker);
    expect(existsSync(path)).toBe(true);
    expect(readMarker(path, destination)).toEqual(marker);
  });

  test("createMarker refuses to overwrite an existing marker file", () => {
    const root = scratchRoot(import.meta.path, "no-overwrite");
    const destination = join(root, "dest");
    const path = markerPath(root);
    createMarker(path, baseMarker(destination));
    expect(() => createMarker(path, baseMarker(destination))).toThrow();
  });

  test("round trips every documented transaction stage", () => {
    const stages: TransactionMarker["stage"][] = [
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
      const root = scratchRoot(import.meta.path, `stage-${stage}`);
      const destination = join(root, "dest");
      const path = markerPath(root);
      const marker = baseMarker(destination, { stage });
      createMarker(path, marker);
      expect(readMarker(path, destination).stage).toBe(stage);
    }
  });

  test("round trips a marker recording a real prior installation's device and inode", () => {
    const root = scratchRoot(import.meta.path, "old-identity-present");
    const destination = join(root, "dest");
    const path = markerPath(root);
    const marker = baseMarker(destination, { old_device: "5", old_inode: "6" });
    createMarker(path, marker);
    expect(readMarker(path, destination)).toEqual(marker);
  });
});

describe("readMarker validation", () => {
  function writeRaw(root: string, value: Record<string, JsonValue>): string {
    const path = markerPath(root);
    writeFileSync(path, canonicalJsonBytes(value));
    return path;
  }

  test("throws for a schema mismatch", () => {
    const root = scratchRoot(import.meta.path, "bad-schema");
    const destination = join(root, "dest");
    const path = writeRaw(root, { ...baseMarker(destination), schema: "wrong" });
    expect(() => readMarker(path, destination)).toThrow(HarnessError);
  });

  test("throws when pid is not a safe integer", () => {
    const root = scratchRoot(import.meta.path, "bad-pid-type");
    const destination = join(root, "dest");
    const path = writeRaw(root, { ...baseMarker(destination), pid: 1.5 });
    expect(() => readMarker(path, destination)).toThrow(HarnessError);
  });

  test("throws when pid is not positive", () => {
    const root = scratchRoot(import.meta.path, "bad-pid-value");
    const destination = join(root, "dest");
    const path = writeRaw(root, { ...baseMarker(destination), pid: 0 });
    expect(() => readMarker(path, destination)).toThrow(HarnessError);
  });

  test("throws when lock_device is not a numeric string", () => {
    const root = scratchRoot(import.meta.path, "bad-lock-device");
    const destination = join(root, "dest");
    const path = writeRaw(root, { ...baseMarker(destination), lock_device: "not-a-number" });
    expect(() => readMarker(path, destination)).toThrow(HarnessError);
  });

  test("throws when lock_inode is not a numeric string", () => {
    const root = scratchRoot(import.meta.path, "bad-lock-inode");
    const destination = join(root, "dest");
    const path = writeRaw(root, { ...baseMarker(destination), lock_inode: "nope" });
    expect(() => readMarker(path, destination)).toThrow(HarnessError);
  });

  test("throws when destination does not match the caller's expected destination", () => {
    const root = scratchRoot(import.meta.path, "bad-destination");
    const destination = join(root, "dest");
    const path = writeRaw(root, baseMarker(destination));
    expect(() => readMarker(path, join(root, "different-dest"))).toThrow(HarnessError);
  });

  test("throws when temporary is not in the same directory as destination", () => {
    const root = scratchRoot(import.meta.path, "bad-temp-dir");
    const destination = join(root, "dest");
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere);
    const path = writeRaw(root, {
      ...baseMarker(destination),
      temporary: join(elsewhere, `dest.tmp-${randomUUID()}`),
    });
    expect(() => readMarker(path, destination)).toThrow(HarnessError);
  });

  test("throws when temporary does not match the tmp- candidate pattern", () => {
    const root = scratchRoot(import.meta.path, "bad-temp-pattern");
    const destination = join(root, "dest");
    const path = writeRaw(root, {
      ...baseMarker(destination),
      temporary: `${destination}.tmp-short`,
    });
    expect(() => readMarker(path, destination)).toThrow(HarnessError);
  });

  test("throws when backup does not match the old- candidate pattern", () => {
    const root = scratchRoot(import.meta.path, "bad-backup-pattern");
    const destination = join(root, "dest");
    const path = writeRaw(root, { ...baseMarker(destination), backup: `${destination}.old-short` });
    expect(() => readMarker(path, destination)).toThrow(HarnessError);
  });

  test("throws when backup_quarantine does not match the delete- candidate pattern", () => {
    const root = scratchRoot(import.meta.path, "bad-quarantine-pattern");
    const destination = join(root, "dest");
    const path = writeRaw(root, {
      ...baseMarker(destination),
      backup_quarantine: `${destination}.delete-short`,
    });
    expect(() => readMarker(path, destination)).toThrow(HarnessError);
  });

  test("throws when old_device is set but old_inode is null", () => {
    const root = scratchRoot(import.meta.path, "bad-old-identity-mixed");
    const destination = join(root, "dest");
    const path = writeRaw(root, { ...baseMarker(destination), old_device: "1", old_inode: null });
    expect(() => readMarker(path, destination)).toThrow(HarnessError);
  });

  test("throws when old_device is a non-numeric string", () => {
    const root = scratchRoot(import.meta.path, "bad-old-device-format");
    const destination = join(root, "dest");
    const path = writeRaw(root, {
      ...baseMarker(destination),
      old_device: "abc",
      old_inode: "1",
    });
    expect(() => readMarker(path, destination)).toThrow(HarnessError);
  });

  test("throws when source_sha256 is not a 64-hex-character digest", () => {
    const root = scratchRoot(import.meta.path, "bad-digest");
    const destination = join(root, "dest");
    const path = writeRaw(root, { ...baseMarker(destination), source_sha256: "too-short" });
    expect(() => readMarker(path, destination)).toThrow(HarnessError);
  });

  test("throws when stage is not one of the recognized stages", () => {
    const root = scratchRoot(import.meta.path, "bad-stage");
    const destination = join(root, "dest");
    const path = writeRaw(root, { ...baseMarker(destination), stage: "not-a-real-stage" });
    expect(() => readMarker(path, destination)).toThrow(HarnessError);
  });
});
