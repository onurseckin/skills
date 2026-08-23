import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeAttemptStarted } from "../../../olt/scripts/src/engine/runner/attempt-intent.ts";
import { createCommandSigningCapability } from "../../../olt/scripts/src/engine/runner/attempt-disposition-capability.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("fsyncs the command directory entry before a started marker can precede spawn", async () => {
  const root = await mkdtemp(join(tmpdir(), "attempt-directory-durable-"));
  roots.push(root);
  const commandRoot = join(root, "commands", "C-durable");
  const attemptRoot = join(commandRoot, "attempt-1");
  await mkdir(attemptRoot, { recursive: true });
  let synced: string | undefined;

  writeAttemptStarted(
    attemptRoot,
    "C-durable",
    1,
    "2026-08-14T00:00:00.000Z",
    "ownership-token",
    createCommandSigningCapability(),
    (path) => {
      synced = path;
    },
  );

  expect(synced).toBe(commandRoot);
});
