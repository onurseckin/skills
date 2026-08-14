import { rm } from "node:fs/promises";
import { dirname } from "node:path";
import { fsyncDirectory } from "../core/durable-write.ts";
import { assertPathIdentity, pathIdentity, type PathIdentity } from "./path-safety.ts";

export async function removeJournaledPath(
  path: string,
  expected: PathIdentity,
  label: string,
): Promise<void> {
  if ((await pathIdentity(path)) === null) return;
  await assertPathIdentity(path, expected, label);
  await rm(path, { recursive: true });
  fsyncDirectory(dirname(path));
}
