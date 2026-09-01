/**
 * @file coverage-fixtures.ts
 * In-memory test sandbox fixture and pure RAM mock generators for tests/coverage-sweep domain
 */

import { afterEach } from "bun:test";
import { createHash } from "node:crypto";
import { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import type { GitSpawn } from "../../../olt/scripts/src/workflow/worktree/git.ts";
import type { ProvisionWorktreesInput } from "../../../olt/scripts/src/workflow/worktree/provision.ts";

export const coverageVirtualFs = new VirtualMemoryFS();
const SCRATCH_BASE = "/virtual/coverage-sweep-scratch";
const rootsToClean: string[] = [];

afterEach(() => {
  for (const root of rootsToClean) {
    try {
      coverageVirtualFs.rmSync(root, { recursive: true, force: true });
    } catch {}
  }
  rootsToClean.length = 0;
});

function slug(value: string): string {
  const cleaned = value
    .replace(/\.+/g, "-")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const trimmed = cleaned.slice(0, 20).replace(/-+$/, "");
  return trimmed.length > 0 ? trimmed : "root";
}

function shortDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

let counter = 0;

/**
 * Creates an isolated in-memory scratch sandbox directory for testing coverage-sweep operations.
 * Automatically registered for cleanup in afterEach hooks.
 */
export function scratchRoot(callerPath = "coverage-sweep-test", label = "test"): string {
  counter += 1;
  const fileTag = slug(callerPath);
  const labelTag = slug(label);
  const digest = shortDigest(`${fileTag}:${labelTag}:${counter}`);
  const raw = `${fileTag}-${labelTag}-${counter}-${digest}`
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "");
  const dirName = raw.slice(0, 50).replace(/-+$/, "");
  const root = `${SCRATCH_BASE}/${dirName}`;

  try {
    coverageVirtualFs.rmSync(root, { recursive: true, force: true });
  } catch {}

  coverageVirtualFs.mkdirSync(root, { recursive: true });
  rootsToClean.push(root);
  return root;
}

export function createSandboxDir(label = "sandbox"): string {
  return scratchRoot("sandbox", label);
}

export function createMockGitSpawn(result: {
  status?: number | null;
  stdout?: string | undefined;
  stderr?: string | undefined;
  error?: Error | undefined;
}): GitSpawn {
  return () => ({
    status: result.status ?? 0,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
  });
}

export function createSampleCoverageTableRow(): string {
  return "  src/lib/index.ts | 95.50 | 97.20 | 1-5";
}

export function createSampleProvisionInput(
  overrides: Partial<ProvisionWorktreesInput> = {},
): ProvisionWorktreesInput {
  return {
    runRoot: "/tmp/run-root",
    repoRoot: "/tmp/repo-root",
    runId: "run-123",
    actor: "coordinator",
    topology: { waves: [], decisions: [], max_parallel: 1, revision: 1 },
    tasksById: new Map(),
    config: {
      worktree_isolation: false,
      branch_prefix: "harness/",
    },
    ...overrides,
  };
}
