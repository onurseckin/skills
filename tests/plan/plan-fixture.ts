/**
 * @file plan-fixture.ts
 * In-memory test sandbox fixture and pure RAM plan generator harness for tests/plan domain
 */

import { afterEach } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PreEnhancementTaskInput } from "../../olt/scripts/src/plan/pre-enhancer.ts";

const SCRATCH_BASE = join(tmpdir(), "plan-scratch");
const rootsToClean: string[] = [];

afterEach(() => {
  for (const root of rootsToClean) {
    try {
      rmSync(root, { recursive: true, force: true });
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
 * Creates an isolated scratch sandbox directory for testing plan operations.
 * Automatically registered for cleanup in afterEach hooks.
 */
export function scratchRoot(callerPath = "plan-test", label = "test"): string {
  counter += 1;
  const fileTag = slug(callerPath);
  const labelTag = slug(label);
  const digest = shortDigest(`${fileTag}:${labelTag}:${counter}`);
  const raw = `${fileTag}-${labelTag}-${counter}-${digest}`
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "");
  const dirName = raw.slice(0, 50).replace(/-+$/, "");
  const root = join(SCRATCH_BASE, dirName);

  try {
    rmSync(root, { recursive: true, force: true });
  } catch {}

  mkdirSync(root, { recursive: true });
  rootsToClean.push(root);
  return root;
}

export function createSandboxDir(label = "sandbox"): string {
  return scratchRoot("sandbox", label);
}

export function createInMemoryPreEnhancedTask(
  overrides: Partial<PreEnhancementTaskInput> = {},
): PreEnhancementTaskInput {
  return {
    taskId: "task-in-memory-plan-01",
    label: "In-Memory Plan Task",
    writeScope: ["src/plan/engine.ts", "tests/plan/engine.test.ts"],
    dependencies: [],
    gateCommand: "bun test tests/plan/engine.test.ts",
    effort: 2,
    priority: 100,
    requirementIds: ["req-memory-01"],
    description: "In-memory test plan task descriptor",
    ...overrides,
  };
}

export function createInMemoryPlanFinding(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "F-PLAN-01",
    severity: "critical",
    observation: "Missing validation assertion",
    remediation: "Add boundary test check",
    file_paths: ["src/plan/engine.ts"],
    ...overrides,
  };
}

export function createInMemoryScopePair(): {
  scopeA: string[];
  scopeB: string[];
  disjointScope: string[];
} {
  return {
    scopeA: ["src/plan/engine.ts", "tests/plan/engine.test.ts"],
    scopeB: ["src/plan/engine.ts", "tests/plan/other.test.ts"],
    disjointScope: ["src/auth/login.ts", "tests/auth/login.test.ts"],
  };
}
