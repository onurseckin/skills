import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { IntegrityIssue } from "../../core/contracts/index.ts";
import { readBoundedBytes, sha256Bytes } from "../../core/json.ts";
import { MAX_BLOB_BYTES, blobContentDigest, blobRelativePath, listBlobs } from "./blobs.ts";
import { CAPTURES_FILE, readCaptures, type CaptureRecord } from "./captures.ts";
import { commandLayout } from "./layout-commands.ts";
import { SHA256_PATTERN } from "./constants.ts";
import { issue } from "./issues.ts";
import { isDeclaredCapsuleEntry } from "./layout.ts";
import { isRecord, type JsonRecord } from "./layout-json.ts";
import { packetLayout } from "./layout-packets.ts";
import { reportsLayout } from "./layout-reports.ts";

function readState(runRoot: string): JsonRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(runRoot, "state.json"), "utf-8"));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function verifyCapsuleLayout(runRoot: string): IntegrityIssue[] {
  const state = readState(runRoot);
  return [
    ...blobNaming(runRoot),
    ...captureReferences(runRoot),
    ...packetLayout(runRoot, state),
    ...commandLayout(runRoot, state),
    ...reportsLayout(runRoot, state),
  ];
}

export function verifyCapsuleDeep(runRoot: string): IntegrityIssue[] {
  return [...undeclaredEntries(runRoot), ...verifyBlobContents(runRoot)];
}

export function undeclaredEntries(runRoot: string): IntegrityIssue[] {
  let names: string[];
  try {
    names = readdirSync(runRoot);
  } catch (error) {
    return [issue("LAYOUT_UNREADABLE", `capsule root is unreadable: ${String(error)}`)];
  }
  const found: IntegrityIssue[] = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    if (isDeclaredCapsuleEntry(name)) continue;
    found.push(
      issue("LAYOUT_UNDECLARED", `capsule holds an undeclared entry: ${name}`, join(runRoot, name)),
    );
  }
  return found;
}

function blobNaming(runRoot: string): IntegrityIssue[] {
  const root = join(runRoot, "blobs");
  if (!existsSync(root)) return [];
  const found: IntegrityIssue[] = [];
  let shards: string[];
  try {
    shards = readdirSync(root);
  } catch (error) {
    return [issue("BLOB_UNREADABLE", `blobs/ is unreadable: ${String(error)}`, root)];
  }
  for (const shard of shards) {
    if (shard.startsWith(".")) continue;
    const shardPath = join(root, shard);
    let entries: string[];
    try {
      if (!lstatSync(shardPath).isDirectory()) {
        found.push(issue("BLOB_LAYOUT", `blobs/${shard} is not a shard directory`, shardPath));
        continue;
      }
      entries = readdirSync(shardPath);
    } catch (error) {
      found.push(issue("BLOB_UNREADABLE", `blobs/${shard} is unreadable: ${String(error)}`));
      continue;
    }
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const path = join(shardPath, entry);
      if (!SHA256_PATTERN.test(entry)) {
        found.push(
          issue("BLOB_NAME", `blob is not named by a SHA-256: blobs/${shard}/${entry}`, path),
        );
        continue;
      }
      if (!entry.startsWith(shard))
        found.push(
          issue("BLOB_SHARD", `blob sits in the wrong shard: blobs/${shard}/${entry}`, path),
        );
      try {
        const metadata = lstatSync(path);
        if (!metadata.isFile() || metadata.isSymbolicLink())
          found.push(
            issue("BLOB_KIND", `blob is not a regular file: blobs/${shard}/${entry}`, path),
          );
        else if ((metadata.mode & 0o222) !== 0)
          found.push(issue("BLOB_MODE", `blob is writable: blobs/${shard}/${entry}`, path));
      } catch (error) {
        found.push(issue("BLOB_UNREADABLE", `blob is unreadable: ${String(error)}`, path));
      }
    }
  }
  return found;
}

function sameInode(left: string, right: string): boolean {
  try {
    const a = statSync(left);
    const b = statSync(right);
    return a.dev === b.dev && a.ino === b.ino;
  } catch {
    return false;
  }
}

function captureViewDivergenceIssues(
  capture: CaptureRecord,
  blobPath: string,
  viewPath: string,
): IntegrityIssue[] {
  if (capture.storage === "hardlink") {
    return sameInode(blobPath, viewPath)
      ? []
      : [
          issue(
            "CAPTURE_VIEW_DIVERGED",
            `capture ${capture.name} view is no longer linked to its blob`,
            capture.path,
          ),
        ];
  }
  if (capture.storage === "copy") {
    try {
      const bytes = readBoundedBytes(viewPath, MAX_BLOB_BYTES);
      return sha256Bytes(bytes) === capture.sha256
        ? []
        : [
            issue(
              "CAPTURE_VIEW_DIVERGED",
              `capture ${capture.name} view no longer matches its recorded content`,
              capture.path,
            ),
          ];
    } catch (error) {
      return [
        issue(
          "CAPTURE_UNREADABLE",
          `capture ${capture.name} view is unreadable: ${String(error)}`,
          capture.path,
        ),
      ];
    }
  }
  return [
    issue(
      "CAPTURE_STORAGE",
      `capture ${capture.name} has an unrecognized storage mode`,
      capture.path,
    ),
  ];
}

function captureReferences(runRoot: string): IntegrityIssue[] {
  const found: IntegrityIssue[] = [];
  const seenNames = new Set<string>();
  for (const capture of readCaptures(runRoot)) {
    if (!SHA256_PATTERN.test(capture.sha256)) {
      found.push(
        issue("CAPTURE_DIGEST", `capture ${capture.name} has no valid digest`, CAPTURES_FILE),
      );
      continue;
    }
    if (capture.blob_path !== blobRelativePath(capture.sha256))
      found.push(
        issue(
          "CAPTURE_BLOB_PATH",
          `capture ${capture.name} points outside its content address`,
          capture.blob_path,
        ),
      );
    const blobPath = join(runRoot, capture.blob_path);
    const viewPath = join(runRoot, capture.path);
    const blobPresent = existsSync(blobPath);
    const viewPresent = existsSync(viewPath);
    if (!blobPresent)
      found.push(
        issue(
          "CAPTURE_BLOB_MISSING",
          `capture ${capture.name} has no stored bytes`,
          capture.blob_path,
        ),
      );
    if (!viewPresent)
      found.push(
        issue("CAPTURE_VIEW_MISSING", `capture ${capture.name} has no readable name`, capture.path),
      );
    if (blobPresent && viewPresent)
      found.push(...captureViewDivergenceIssues(capture, blobPath, viewPath));
    if (seenNames.has(capture.path))
      found.push(issue("CAPTURE_NAME_REUSED", `two captures claim ${capture.path}`, capture.path));
    seenNames.add(capture.path);
  }
  return found;
}

export function verifyBlobContents(runRoot: string): IntegrityIssue[] {
  const found: IntegrityIssue[] = [];
  for (const blob of listBlobs(runRoot)) {
    const digest = blobContentDigest(runRoot, blob.sha256);
    if (digest === undefined) {
      found.push(issue("BLOB_UNREADABLE", `blob ${blob.sha256} is unreadable`, blob.path));
      continue;
    }
    if (digest !== blob.sha256)
      found.push(
        issue("BLOB_CONTENT", `blob ${blob.sha256} no longer matches its content`, blob.path),
      );
  }
  return found;
}
