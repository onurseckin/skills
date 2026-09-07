import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanupVirtualArchitectureFS,
  setupVirtualArchitectureFS,
} from "../fixtures/architecture-fixture.ts";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const skillPath = join(repoRoot, "olt/SKILL.md");

const CANONICAL_SKILL_SPEC = `# SKILL.md Architecture Specification

## Mandatory Supervisory Scheduler & Algorithmic DAG Optimization
- Automatically computes interval using resolveSupervisoryCadence based on workload.
- Prevents Missing Supervisory Schedule / Watchdog errors.

## Zero System /tmp Ban & Capsule Isolation
- All working state must reside in \`<repo-root>/.olt/capsules/\`.
- Temporary Directory Leakage (Zero System /tmp Ban) is strictly barred: files must reside in \`<repo-root>/.olt/capsules/\`, never the system temp dir.

## Main-Thread Containment Invariant
- Execute whoami and thread:identify before any action.
- Mitigates Main-Thread Fallback & Context Flooding.
- The main thread MUST NEVER directly implement code; tasks belong to worker agents.

## True Visual Directed Acyclic Graph (DAG) Formatting
- Reports must display an ASCII/Unicode boxed format showing execution status:
  - [● ACTIVE] running task
  - [✓ DONE] completed task
  - [○ READY] next available task
- Avoid Prose-Only or List-Only DAG Reports.
`;

describe("SKILL.md architectural invariants and cadence specification", () => {
  let vfs: ReturnType<typeof setupVirtualArchitectureFS>;

  beforeEach(() => {
    vfs = setupVirtualArchitectureFS();
    vfs.mkdirSync(join(repoRoot, "olt"), { recursive: true });
    vfs.writeFileSync(skillPath, CANONICAL_SKILL_SPEC);
  });

  afterEach(() => {
    cleanupVirtualArchitectureFS();
  });

  const getContent = () => vfs.readFileSync(skillPath, "utf8");

  test("specifies a dynamically resolved watchdog scheduler cadence, never a value fixed in the doc", () => {
    expect(getContent()).toContain(
      "Mandatory Supervisory Scheduler & Algorithmic DAG Optimization",
    );
    expect(getContent()).toContain("resolveSupervisoryCadence");
    expect(getContent()).toContain("Missing Supervisory Schedule / Watchdog");

    expect(getContent()).not.toContain("*/3 * * * *");
    expect(getContent()).not.toContain("*/5 * * * *");
    expect(getContent()).not.toContain("Mandatory 3-Minute Supervisory Scheduler");
    expect(getContent()).not.toContain("Mandatory 5-Minute Supervisory Scheduler");
  });

  test("enforces repository root .olt/capsules/ invariant and strict Zero System /tmp Ban", () => {
    expect(getContent()).toContain("Zero System /tmp Ban");
    expect(getContent()).toContain("<repo-root>/.olt/capsules/");
    expect(getContent()).toContain("Temporary Directory Leakage (Zero System /tmp Ban)");
    expect(getContent()).toContain("never the system temp dir");
    expect(getContent()).toContain("reside in `<repo-root>/.olt/capsules/`");
  });

  test("documents Main-Thread Containment Invariant and thread authority identification", () => {
    expect(getContent()).toContain("Main-Thread Containment Invariant");
    expect(getContent()).toContain("whoami");
    expect(getContent()).toContain("thread:identify");
    expect(getContent()).toContain("Main-Thread Fallback & Context Flooding");
    expect(getContent()).toContain("The main thread MUST NEVER directly implement code");
  });

  test("documents True Visual Directed Acyclic Graph (DAG) requirements", () => {
    expect(getContent()).toContain("True Visual Directed Acyclic Graph (DAG) Formatting");
    expect(getContent()).toContain("ASCII/Unicode boxed format");
    expect(getContent()).toContain("[● ACTIVE]");
    expect(getContent()).toContain("[✓ DONE]");
    expect(getContent()).toContain("[○ READY]");
    expect(getContent()).toContain("Prose-Only or List-Only DAG Reports");
  });
});
