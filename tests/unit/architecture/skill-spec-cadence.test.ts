import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const skillPath = join(repoRoot, "orchestrating-long-tasks/SKILL.md");

describe("SKILL.md architectural invariants and cadence specification", () => {
  const content = readFileSync(skillPath, "utf8");

  test("specifies 3-minute watchdog scheduler cadence", () => {
    expect(content).toContain("Mandatory 3-Minute Supervisory Scheduler");
    expect(content).toContain("*/3 * * * *");
    expect(content).toContain("Missing Supervisory Schedule / 3-Minute Watchdog");
    // Ensure 5-minute supervisory scheduler is no longer the active rule
    expect(content).not.toContain("Mandatory 5-Minute Supervisory Scheduler");
    expect(content).not.toContain("*/5 * * * *");
  });

  test("enforces repository root .capsules/ invariant and strict Zero /tmp Ban", () => {
    expect(content).toContain("Zero `/tmp` Ban");
    expect(content).toContain("<repo-root>/.capsules/");
    expect(content).toContain("Temporary Directory Leakage (Zero /tmp Ban)");
    expect(content).toContain("never `/tmp` or `.tmp/`");
    expect(content).toContain("reside exclusively in `.capsules/`");
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
