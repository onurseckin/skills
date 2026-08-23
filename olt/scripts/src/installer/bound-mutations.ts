import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fsyncDirectory } from "../core/durable-write.ts";
import { HarnessError } from "../core/errors/harness-error.ts";
import {
  assertPathIdentity,
  pathIdentity,
  sameIdentity,
  type PathIdentity,
} from "./path-safety.ts";
import { exchangePaths, renameNoReplace } from "./native-rename.ts";

export interface BoundMutationHooks {
  beforeRename?(): Promise<void> | void;
  beforeExchange?(): Promise<void> | void;
}

function syncParents(source: string, destination: string): void {
  fsyncDirectory(dirname(source));
  if (dirname(destination) !== dirname(source)) fsyncDirectory(dirname(destination));
}

async function restoreUnexpected(
  source: string,
  destination: string,
  moved: PathIdentity | null,
): Promise<void> {
  if (!moved || (await pathIdentity(source)) !== null) return;
  await assertPathIdentity(destination, moved, "unexpected moved path");
  renameNoReplace(destination, source, "unexpected path restoration");
  syncParents(destination, source);
}

export async function moveBoundPath(
  source: string,
  destination: string,
  expected: PathIdentity,
  label: string,
  hooks: BoundMutationHooks = {},
): Promise<void> {
  await hooks.beforeRename?.();
  renameNoReplace(source, destination, label);
  syncParents(source, destination);
  const moved = await pathIdentity(destination);
  if (!sameIdentity(moved, expected)) {
    await restoreUnexpected(source, destination, moved);
    throw new HarnessError("INVALID_STATE", `${label} changed identity before mutation`);
  }
}

export async function removeBoundPath(
  path: string,
  expected: PathIdentity,
  label: string,
  hooks: BoundMutationHooks = {},
): Promise<void> {
  const quarantine = join(dirname(path), `.${basename(path)}.remove-${randomUUID()}`);
  await moveBoundPath(path, quarantine, expected, label, hooks);
  await assertPathIdentity(quarantine, expected, `${label} quarantine`);
  await rm(quarantine, { recursive: true });
  fsyncDirectory(dirname(path));
}

export async function replaceBoundPath(
  path: string,
  expected: PathIdentity,
  replacement: string,
  replacementIdentity: PathIdentity,
  label: string,
  hooks: BoundMutationHooks = {},
): Promise<void> {
  await hooks.beforeExchange?.();
  exchangePaths(path, replacement, `${label} exchange`);
  syncParents(path, replacement);
  const installed = await pathIdentity(path);
  const displaced = await pathIdentity(replacement);
  if (!sameIdentity(installed, replacementIdentity) || !sameIdentity(displaced, expected)) {
    await assertPathIdentity(path, installed, `${label} exchanged destination`);
    await assertPathIdentity(replacement, displaced, `${label} exchanged replacement`);
    exchangePaths(path, replacement, `${label} failed exchange restoration`);
    syncParents(path, replacement);
    throw new HarnessError("INVALID_STATE", `${label} changed identity before exchange`);
  }
  await removeBoundPath(replacement, expected, `${label} superseded value`);
}
