import { expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { writeAttemptStarted } from "../../../../olt/scripts/src/engine/runner/execution/attempt-intent.ts";
import { createCommandSigningCapability } from "../../../../olt/scripts/src/engine/runner/execution/attempt-disposition-capability.ts";
import { scratchRoot } from "../../../support/scratch-root.ts";

test("fsyncs the command directory entry before a started marker can precede spawn", () => {
  const root = scratchRoot(import.meta.path, "attempt-directory-durable");
  const commandRoot = join(root, "commands", "C-durable");
  const attemptRoot = join(commandRoot, "attempt-1");
  mkdirSync(attemptRoot, { recursive: true });
  let synced: string | undefined;

  const record = writeAttemptStarted(
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
  expect(record.command_id).toBe("C-durable");
});

test("writeAttemptStarted works with default fsyncDirectory parameter", () => {
  const root = scratchRoot(import.meta.path, "attempt-default-sync");
  const commandRoot = join(root, "commands", "C-default");
  const attemptRoot = join(commandRoot, "attempt-1");
  mkdirSync(attemptRoot, { recursive: true });

  const record = writeAttemptStarted(
    attemptRoot,
    "C-default",
    1,
    "2026-08-14T00:00:00.000Z",
    "ownership-token",
    createCommandSigningCapability(),
  );

  expect(record.command_id).toBe("C-default");
  expect(record.status).toBe("running");
});
