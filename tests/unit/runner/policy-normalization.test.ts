import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_COMMAND_RETRIES,
  normalizeCommandOptions,
  policyRecord,
  policyRecordIssues,
} from "../../../olt/scripts/src/engine/runner/policy.ts";
import type { CommandOptions } from "../../../olt/scripts/src/capture/runners/types.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repoRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "policy-normalization-"));
  roots.push(root);
  return root;
}

function baseOptions(cwd: string, runRoot: string): CommandOptions {
  return {
    argv: ["echo", "hi"],
    cwd,
    commandDir: join(runRoot, "commands"),
    runRoot,
    actor: "validator",
  };
}

describe("normalizeCommandOptions bounded fields", () => {
  test("rejects a non-positive-integer duration field", async () => {
    const cwd = await repoRoot();
    await expect(
      normalizeCommandOptions({ ...baseOptions(cwd, cwd), wallTimeoutMs: 0 }),
    ).rejects.toThrow("wallTimeoutMs must be a positive integer no greater than");
  });

  test("rejects a duration field above its maximum", async () => {
    const cwd = await repoRoot();
    await expect(
      normalizeCommandOptions({ ...baseOptions(cwd, cwd), graceMs: 60_001 }),
    ).rejects.toThrow("graceMs must be a positive integer no greater than");
  });

  test("rejects a non-integer duration field", async () => {
    const cwd = await repoRoot();
    await expect(
      normalizeCommandOptions({ ...baseOptions(cwd, cwd), idleTimeoutMs: 1.5 }),
    ).rejects.toThrow("idleTimeoutMs must be a positive integer no greater than");
  });

  test("rejects a negative retries count", async () => {
    const cwd = await repoRoot();
    await expect(
      normalizeCommandOptions({ ...baseOptions(cwd, cwd), retries: -1 }),
    ).rejects.toThrow(`retries must be an integer from 0 to ${MAX_COMMAND_RETRIES}`);
  });

  test("rejects a retries count above the maximum", async () => {
    const cwd = await repoRoot();
    await expect(
      normalizeCommandOptions({ ...baseOptions(cwd, cwd), retries: MAX_COMMAND_RETRIES + 1 }),
    ).rejects.toThrow(`retries must be an integer from 0 to ${MAX_COMMAND_RETRIES}`);
  });

  test("rejects a cwd that is outside the given repositoryRoot", async () => {
    const repositoryRoot = await repoRoot();
    const outsideCwd = await mkdtemp(join(tmpdir(), "policy-outside-cwd-"));
    roots.push(outsideCwd);
    await expect(
      normalizeCommandOptions({
        ...baseOptions(outsideCwd, repositoryRoot),
        repositoryRoot,
      }),
    ).rejects.toThrow("cwd must be within repositoryRoot");
  });

  test("rejects a commandDir that is not a child of the given runRoot", async () => {
    const cwd = await repoRoot();
    const runRoot = await repoRoot();
    const siblingCommandDir = await mkdtemp(join(tmpdir(), "policy-sibling-command-dir-"));
    roots.push(siblingCommandDir);
    await expect(
      normalizeCommandOptions({ ...baseOptions(cwd, runRoot), commandDir: siblingCommandDir }),
    ).rejects.toThrow("commandDir must be a child of runRoot");
  });

  test("accepts explicit values at exactly their maximum bound", async () => {
    const cwd = await repoRoot();
    const normalized = await normalizeCommandOptions({
      ...baseOptions(cwd, cwd),
      graceMs: 60_000,
      retries: MAX_COMMAND_RETRIES,
    });
    expect(normalized.graceMs).toBe(60_000);
    expect(normalized.retries).toBe(MAX_COMMAND_RETRIES);
  });
});

describe("policyRecord and policyRecordIssues", () => {
  test("round-trips a normalized policy without issues", async () => {
    const cwd = await repoRoot();
    const normalized = await normalizeCommandOptions(baseOptions(cwd, cwd));
    const record = policyRecord(normalized);
    expect(policyRecordIssues(record)).toEqual([]);
  });

  test("flags a bound that exceeds its maximum", async () => {
    const cwd = await repoRoot();
    const normalized = await normalizeCommandOptions(baseOptions(cwd, cwd));
    const record = { ...policyRecord(normalized), wall_timeout_ms: 999_999_999_999 };
    expect(policyRecordIssues(record)).toContain("command policy contains an invalid bound");
  });

  test("flags an invalid retry policy", async () => {
    const cwd = await repoRoot();
    const normalized = await normalizeCommandOptions(baseOptions(cwd, cwd));
    const record = { ...policyRecord(normalized), max_retries: MAX_COMMAND_RETRIES + 1 };
    expect(policyRecordIssues(record)).toContain("command retry policy is invalid");
  });

  test("flags a non-boolean idempotency flag", async () => {
    const cwd = await repoRoot();
    const normalized = await normalizeCommandOptions(baseOptions(cwd, cwd));
    const record = { ...policyRecord(normalized), idempotent: "yes" as unknown as boolean };
    expect(policyRecordIssues(record)).toContain("command idempotency policy is invalid");
  });
});
