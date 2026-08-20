import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { IntegrityIssue } from "../contracts/capsule.ts";
import { blobContentDigest, blobRelativePath, listBlobs } from "./blobs.ts";
import { CAPTURES_FILE, readCaptures } from "./captures.ts";
import { SHA256_PATTERN } from "./constants.ts";
import { issue } from "./issues.ts";
import { isDeclaredCapsuleEntry } from "./layout.ts";

/**
 * Integrity beyond the four files the chain binds directly.
 *
 * The chain proves the prompt, the manifest, the event log and the projection. Everything else the
 * run wrote — blobs, the readable names that point at them, the capture ledger — was unverified and
 * silently tolerated if altered, which is as much an integrity gap as a duplicated one. These
 * checks are structural and cheap enough to run on every load.
 */
export function verifyCapsuleLayout(runRoot: string): IntegrityIssue[] {
  return [...blobNaming(runRoot), ...captureReferences(runRoot)];
}

/**
 * The checks a load does not pay for: every stored byte re-hashed, and every entry at the capsule
 * root matched against the declared layout. Both are reported rather than enforced on load — a
 * stray file someone dropped into a capsule is worth telling an operator about, but it is not a
 * reason to refuse to read the run.
 */
export function verifyCapsuleDeep(runRoot: string): IntegrityIssue[] {
  return [...undeclaredEntries(runRoot), ...verifyBlobContents(runRoot)];
}

/** Anything at the capsule root the layout does not declare is unexplained, so it is reported. */
export function undeclaredEntries(runRoot: string): IntegrityIssue[] {
  let names: string[];
  try {
    names = readdirSync(runRoot);
  } catch (error) {
    return [issue("LAYOUT_UNREADABLE", `capsule root is unreadable: ${String(error)}`)];
  }
  const found: IntegrityIssue[] = [];
  for (const name of names) {
    // A dot-prefixed name is an in-flight temporary from an atomic write, not a capsule entry.
    if (name.startsWith(".")) continue;
    if (isDeclaredCapsuleEntry(name)) continue;
    found.push(
      issue("LAYOUT_UNDECLARED", `capsule holds an undeclared entry: ${name}`, join(runRoot, name)),
    );
  }
  return found;
}

/** A blob's file name is its content identity, so a name that is not a digest proves nothing. */
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

/** Every recorded capture must still point at bytes that exist, and at the name it claims. */
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
    if (!existsSync(join(runRoot, capture.blob_path)))
      found.push(
        issue(
          "CAPTURE_BLOB_MISSING",
          `capture ${capture.name} has no stored bytes`,
          capture.blob_path,
        ),
      );
    if (!existsSync(join(runRoot, capture.path)))
      found.push(
        issue("CAPTURE_VIEW_MISSING", `capture ${capture.name} has no readable name`, capture.path),
      );
    if (seenNames.has(capture.path))
      found.push(issue("CAPTURE_NAME_REUSED", `two captures claim ${capture.path}`, capture.path));
    seenNames.add(capture.path);
  }
  return found;
}

/**
 * Re-reads every stored blob and checks it still hashes to its own name. Separate from the load
 * path because it costs a full read of every captured byte, which is exactly what a capsule holds
 * most of.
 */
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
