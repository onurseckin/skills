import { closeSync, constants, fsyncSync, openSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fsyncDirectory } from "../core/durable-write.ts";
import { canonicalJsonBytes, readCanonicalObject } from "../core/json.ts";
import type { JsonObject } from "../core/contracts/index.ts";
import { HarnessError } from "../core/errors/index.ts";
import { SKILL_NAME } from "./constants.ts";

export const MARKER_SCHEMA = "harness-install-transaction/v3";
export type TransactionStage =
  | "prepared"
  | "old-move-intent"
  | "old-moved"
  | "publish-intent"
  | "published"
  | "backup-delete-intent"
  | "backup-quarantined"
  | "committed";

export interface TransactionMarker extends JsonObject {
  schema: typeof MARKER_SCHEMA;
  pid: number;
  lock_device: string;
  lock_inode: string;
  destination: string;
  temporary: string;
  backup: string;
  backup_quarantine: string;
  old_device: string | null;
  old_inode: string | null;
  source_sha256: string;
  stage: TransactionStage;
}

export function markerPath(parent: string): string {
  return join(parent, `.${SKILL_NAME}.install-transaction.json`);
}

function isCandidate(path: string, destination: string, kind: "tmp" | "old" | "delete"): boolean {
  if (dirname(path) !== dirname(destination)) return false;
  const escaped = basename(destination).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^${escaped}\\.${kind}-[0-9a-f-]{36}$`, "u").test(basename(path));
}

export function readMarker(path: string, destination: string): TransactionMarker {
  const value = readCanonicalObject(path, "installer transaction", {
    maxBytes: 8 * 1024,
    maxDepth: 4,
  });
  const stages = new Set<unknown>([
    "prepared",
    "old-move-intent",
    "old-moved",
    "publish-intent",
    "published",
    "backup-delete-intent",
    "backup-quarantined",
    "committed",
  ]);
  if (
    value.schema !== MARKER_SCHEMA ||
    !Number.isSafeInteger(value.pid) ||
    (value.pid as number) <= 0 ||
    typeof value.lock_device !== "string" ||
    !/^\d+$/u.test(value.lock_device) ||
    typeof value.lock_inode !== "string" ||
    !/^\d+$/u.test(value.lock_inode) ||
    value.destination !== destination ||
    typeof value.temporary !== "string" ||
    !isCandidate(value.temporary, destination, "tmp") ||
    typeof value.backup !== "string" ||
    !isCandidate(value.backup, destination, "old") ||
    typeof value.backup_quarantine !== "string" ||
    !isCandidate(value.backup_quarantine, destination, "delete") ||
    !(
      (value.old_device === null && value.old_inode === null) ||
      (typeof value.old_device === "string" &&
        /^\d+$/u.test(value.old_device) &&
        typeof value.old_inode === "string" &&
        /^\d+$/u.test(value.old_inode))
    ) ||
    typeof value.source_sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(value.source_sha256) ||
    !stages.has(value.stage)
  ) {
    throw new HarnessError("INVALID_STATE", "invalid installer transaction marker");
  }
  return value as TransactionMarker;
}

export function createMarker(path: string, marker: TransactionMarker): void {
  const data = canonicalJsonBytes(marker);
  const descriptor = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    let offset = 0;
    while (offset < data.byteLength)
      offset += writeSync(descriptor, data, offset, data.byteLength - offset);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  fsyncDirectory(dirname(path));
}
