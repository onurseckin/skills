import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { COMMAND_REGISTRY } from "../../../olt/scripts/src/cli/registry/index.ts";

const skillRoot = join(import.meta.dir, "../../../olt");
const skillPath = join(skillRoot, "SKILL.md");
const mindRolePath = join(skillRoot, "roles/mind.md");
const coordinatorRolePath = join(skillRoot, "roles/coordinator.md");
const orchestratorRolePath = join(skillRoot, "roles/orchestrator.md");
const hostAdaptersPath = join(skillRoot, "references/host-adapters.md");

describe("Mandatory Supervisory Scheduler Invariant & Rule 16 Contract", () => {
  test("SKILL.md defines Rule 16 with mandatory supervisory scheduler requirement", () => {
    expect(existsSync(skillPath)).toBe(true);
    const content = readFileSync(skillPath, "utf8");

    expect(content).toContain(
      "16. Mandatory 3-Minute Supervisory Scheduler & Algorithmic DAG Optimization",
    );
    expect(content).toMatch(/(3-minute|3m)/);
    expect(content).toContain("schedule");
    expect(content).toContain("dag:view");
  });

  test("SKILL.md stays within line budget (<= 150 lines)", () => {
    const content = readFileSync(skillPath, "utf8");
    const lines = content.split("\n");
    expect(lines.length).toBeLessThanOrEqual(150);
  });

  test("roles/mind.md mandates 5-minute supervisory schedule and dag:view inspection", () => {
    expect(existsSync(mindRolePath)).toBe(true);
    const content = readFileSync(mindRolePath, "utf8");

    expect(content).toContain("5-minute");
    expect(content).toContain("dag:view");
    expect(content).toContain("schedule");
    expect(content).toContain("commands:");
    expect(content).toMatch(/-\s+dag:view/);
  });

  test("roles/coordinator.md mandates 5-minute supervisory schedule and dag:view inspection", () => {
    expect(existsSync(coordinatorRolePath)).toBe(true);
    const content = readFileSync(coordinatorRolePath, "utf8");

    expect(content).toContain("5-minute");
    expect(content).toContain("dag:view");
    expect(content).toContain("commands:");
    expect(content).toMatch(/-\s+dag:view/);
    expect(content).toContain("Zero Main-Thread Implementation");
  });

  test("roles/orchestrator.md mandates 5-minute supervisory schedule and dag:view inspection", () => {
    expect(existsSync(orchestratorRolePath)).toBe(true);
    const content = readFileSync(orchestratorRolePath, "utf8");

    expect(content).toContain("5-minute");
    expect(content).toContain("dag:view");
    expect(content).toContain("commands:");
    expect(content).toMatch(/-\s+dag:view/);
  });

  test("references/host-adapters.md documents Section 5.6 for Mandatory 5-Minute Supervisory Scheduler", () => {
    expect(existsSync(hostAdaptersPath)).toBe(true);
    const content = readFileSync(hostAdaptersPath, "utf8");

    expect(content).toContain(
      "Mandatory 5-Minute Supervisory Scheduler & Live ASCII DAG Optimization",
    );
    expect(content).toContain("5-minute");
    expect(content).toContain("dag:view");
    expect(content).toContain("schedule");
  });

  test("SKILL.md defines Rule 17 on Infinite Mind Cadence, No Agent Termination, and Background Finalization", () => {
    const content = readFileSync(skillPath, "utf8");
    expect(content).toContain(
      "17. Infinite Mind Cadence, No Agent-Driven Termination & Background Finalization Isolation",
    );
    expect(content).toContain("Tier 1 Background Orchestrator");
    expect(content).toContain("main interactive thread");
  });

  test("references/host-adapters.md documents Section 5.8 for Infinite Cadence & Background Finalization", () => {
    const content = readFileSync(hostAdaptersPath, "utf8");
    expect(content).toContain(
      "5.8 Infinite Mind Cadence, Zero Agent-Driven Termination & Background Finalization Isolation",
    );
    expect(content).toContain("Tier 1 Background Orchestrator");
  });

  test("dag:view command is registered in COMMAND_REGISTRY with correct aliases", () => {
    const dagSpec = COMMAND_REGISTRY.find((spec) => spec.name === "dag:view");
    expect(dagSpec).toBeDefined();
    expect(dagSpec?.domain).toBe("plan");
    expect(dagSpec?.aliases).toContain("graph:ascii");
    expect(dagSpec?.aliases).toContain("status:dag");
  });

  test("zero TypeScript any and zero suppressions across scheduler and DAG source and test files", () => {
    const filesToCheck = [
      join(skillRoot, "scripts/src/cli/commands/dag-view.ts"),
      join(skillRoot, "scripts/src/cli/registry/plan.ts"),
      join(import.meta.dir, "../cli/dag-view.test.ts"),
      __filename,
    ];

    const anyAnnotation = new RegExp(":" + " any" + "\\b");
    const anyCast = new RegExp("as" + " any" + "\\b");
    const anyGeneric = new RegExp("<" + "any" + ">");
    const tsIgnore = "@" + "ts-ignore";
    const tsExpectError = "@" + "ts-expect-error";
    const tsNoCheck = "@" + "ts-nocheck";
    const suppressionDirectiveA = "eslint" + "-disable";
    const suppressionDirectiveB = "oxlint" + "-disable";

    for (const filePath of filesToCheck) {
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, "utf8");

      expect(content).not.toMatch(anyAnnotation);
      expect(content).not.toMatch(anyCast);
      expect(content).not.toMatch(anyGeneric);
      expect(content.includes(tsIgnore)).toBe(false);
      expect(content.includes(tsExpectError)).toBe(false);
      expect(content.includes(tsNoCheck)).toBe(false);
      expect(content.includes(suppressionDirectiveA)).toBe(false);
      expect(content.includes(suppressionDirectiveB)).toBe(false);
    }
  });
});
