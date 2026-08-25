import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const skillPath = join(repoRoot, "olt/SKILL.md");

describe("SKILL.md architectural invariants and cadence specification", () => {
  const content = readFileSync(skillPath, "utf8");

  test("specifies a dynamically resolved watchdog scheduler cadence, never a value fixed in the doc", () => {
    expect(content).toContain("Mandatory Supervisory Scheduler & Algorithmic DAG Optimization");
    expect(content).toContain("resolveSupervisoryCadence");
    expect(content).toContain("Missing Supervisory Schedule / Watchdog");

    expect(content).not.toContain("*/3 * * * *");
    expect(content).not.toContain("*/5 * * * *");
    expect(content).not.toContain("Mandatory 3-Minute Supervisory Scheduler");
    expect(content).not.toContain("Mandatory 5-Minute Supervisory Scheduler");
  });

  test("enforces repository root .olt/capsules/ invariant and strict Zero System /tmp Ban", () => {
    expect(content).toContain("Zero System /tmp Ban");
    expect(content).toContain("<repo-root>/.olt/capsules/");
    expect(content).toContain("Temporary Directory Leakage (Zero System /tmp Ban)");
    expect(content).toContain("never the system temp dir");
    expect(content).toContain("reside in `<repo-root>/.olt/capsules/`");
  });

  test("documents Main-Thread Containment Invariant and thread authority identification", () => {
    expect(content).toContain("Main-Thread Containment Invariant");
    expect(content).toContain("whoami");
    expect(content).toContain("thread:identify");
    expect(content).toContain("Main-Thread Fallback & Context Flooding");
    expect(content).toContain("The main thread MUST NEVER directly implement code");
  });

  test("documents True Visual Directed Acyclic Graph (DAG) requirements", () => {
    expect(content).toContain("True Visual Directed Acyclic Graph (DAG) Formatting");
    expect(content).toContain("ASCII/Unicode boxed format");
    expect(content).toContain("[● ACTIVE]");
    expect(content).toContain("[✓ DONE]");
    expect(content).toContain("[○ READY]");
    expect(content).toContain("Prose-Only or List-Only DAG Reports");
  });
});
