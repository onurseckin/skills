import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRoleContract } from "../../../olt/scripts/src/packets/role-contract.ts";
import { isAgentRole } from "../../../olt/scripts/src/core/contracts/index.ts";
import {
  MIND_STRATEGIC_ALTITUDE,
  verifyMindRoleStrategicInvariants,
} from "../../../olt/scripts/src/mind/lifecycle/purpose/index.ts";

describe("mind role contract & strategic purpose codification", () => {
  test("mind role is registered with tier 0", () => {
    expect(isAgentRole("mind")).toBe(true);
    const contract = loadRoleContract("mind");
    expect(contract.tier).toBe(0);
  });

  test("mind contract codifies strategic purpose: Strategic Brain at 30,000 feet", () => {
    const contract = loadRoleContract("mind");
    expect(contract.text).toContain("Strategic Brain at 30,000 feet");
    expect(contract.text).toContain(MIND_STRATEGIC_ALTITUDE);

    const maySection = contract.may.join("\n");
    expect(maySection).toContain("Strategic Brain at 30,000 feet");
  });

  test("mind contract strictly enforces the 3 Hard Zeros (zero source code edits, zero unit test execution, zero critic jobs)", () => {
    const contract = loadRoleContract("mind");
    const mustNotSection = contract.must_not.join("\n");

    // 1. Zero source code edits
    expect(mustNotSection).toContain("zero source code edits");
    expect(mustNotSection).toContain(
      "Write, edit, stage, revert, format or delete any repository file or source code",
    );

    // 2. Zero unit test execution
    expect(mustNotSection).toContain("zero unit test execution");
    expect(mustNotSection).toContain(
      "Run, execute, or debug unit tests, integration tests, or test suites directly",
    );

    // 3. Zero critic jobs
    expect(mustNotSection).toContain("zero critic jobs");
    expect(mustNotSection).toContain(
      "Execute critic/review jobs, linting/formatting passes, or line-level pull request critique directly",
    );

    // In prose
    expect(contract.text).toContain(
      "The Three Hard Zeros (Zero Source Edits, Zero Unit Test Execution, Zero Critic Jobs)",
    );
  });

  test("mind contract mandates proactive bandwidth utilization during long subordinate execution windows (2+ hours)", () => {
    const contract = loadRoleContract("mind");
    const maySection = contract.may.join("\n");

    // Verify 2+ hours window proactive utilization
    expect(maySection).toContain("2+ hours");
    expect(maySection).toContain("macro-level DAG diagnostics");
    expect(maySection).toContain("backlog grooming");
    expect(maySection).toContain("candidate admission");
    expect(maySection).toContain("proactive roadmap planning for future fleets");

    // Verify prose details
    expect(contract.text).toContain(
      "Proactive Bandwidth Utilization During Subordinate Execution Windows (2+ Hours)",
    );
    expect(contract.text).toContain("Macro-level DAG diagnostics");
    expect(contract.text).toContain("Backlog grooming");
    expect(contract.text).toContain("Candidate admission");
    expect(contract.text).toContain("Proactive roadmap planning for future fleets");
  });

  test("mind agent persona (mind.yaml) specifies strategic brain invariants and prohibitions matching roles/mind.md", () => {
    const agentYamlPath = join(import.meta.dir, "..", "..", "..", "olt", "agents", "mind.yaml");
    const yamlContent = readFileSync(agentYamlPath, "utf-8");

    // Verify declared mind_invariants
    expect(yamlContent).toContain("SUPERVISOR_ZERO_CODE_EDITS");
    expect(yamlContent).toContain("SUPERVISOR_ZERO_TEST_RUNS");
    expect(yamlContent).toContain("INFINITE_MIND_CADENCE");

    // Verify persona laws
    expect(yamlContent).toContain("Strategic Brain at 30,000 Feet");
    expect(yamlContent).toContain(
      "Proactive Bandwidth Utilization During Subordinate Execution Windows",
    );
    expect(yamlContent).toContain("2+ hours");
  });

  test("mind contract passes verifyMindRoleStrategicInvariants validation", () => {
    const contract = loadRoleContract("mind");
    const validation = verifyMindRoleStrategicInvariants(contract.text);

    expect(validation.isValid).toBe(true);
    expect(validation.altitudeCompliant).toBe(true);
    expect(validation.zeroEditsCompliant).toBe(true);
    expect(validation.zeroUnitTestsCompliant).toBe(true);
    expect(validation.zeroCriticCompliant).toBe(true);
    expect(validation.proactiveBandwidthCompliant).toBe(true);
    expect(validation.violations).toEqual([]);
  });
});
