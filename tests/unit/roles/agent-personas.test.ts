import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { isAgentRole } from "../../../orchestrating-long-tasks/scripts/src/contracts/packets.ts";
import {
  MAX_REPAIR_ROUNDS,
  MIN_ADVERSARIAL_PROBES,
} from "../../../orchestrating-long-tasks/scripts/src/config/constants.ts";
import { resolveRoleContractPath } from "../../../orchestrating-long-tasks/scripts/src/packets/role-contract.ts";

const agentsRoot = join(import.meta.dir, "..", "..", "..", "orchestrating-long-tasks", "agents");
const rolesRoot = dirname(resolveRoleContractPath("planner"));

function persona(name: string): string {
  return readFileSync(join(agentsRoot, name), "utf8");
}

describe("agent personas", () => {
  test("every declared persona role is part of the canonical vocabulary", () => {
    const files = readdirSync(agentsRoot).filter((entry) => entry.endsWith(".yaml"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const declared = /^ {2}role: "([^"]+)"$/mu.exec(persona(file));
      if (!declared) continue;
      expect(isAgentRole(declared[1])).toBe(true);
    }
  });

  test("personas carry the canonical probe and repair budgets", () => {
    expect(MIN_ADVERSARIAL_PROBES).toBe(1);
    expect(MAX_REPAIR_ROUNDS).toBe(6);
    const validator = persona("validator.yaml");
    expect(validator).toContain(`min_adversarial_probes: ${MIN_ADVERSARIAL_PROBES}`);
    expect(validator).toContain(`max_repair_rounds: ${MAX_REPAIR_ROUNDS}`);
    // The probe supersedes the rejection round: a persona teaching the legacy knob teaches a
    // validator to file a defect it never observed.
    expect(validator).not.toContain("min_adversarial_rejections");
    const coordinator = persona("coordinator.yaml");
    expect(coordinator).toContain("mandatory adversarial probe");
    expect(coordinator).not.toContain("3-Round");
    expect(coordinator).not.toContain("min rejections 3");
  });

  // A vendor's dispatch tool name (e.g. Antigravity's `invoke_subagent`) is a VALUE that belongs only
  // in host-adapters.md's adapter table. Naming it as a literal call inside a persona or role contract
  // states it as the rule for every host, which is false under any host that names dispatch
  // differently — the contract must name the abstract capability and point at the adapter table.
  test("no persona or role contract hardcodes one host's dispatch call as the rule", () => {
    const yamlFiles = readdirSync(agentsRoot).filter((entry) => entry.endsWith(".yaml"));
    const mdFiles = readdirSync(rolesRoot).filter((entry) => entry.endsWith(".md"));
    const offenders: string[] = [];
    for (const file of yamlFiles)
      if (persona(file).includes("invoke_subagent(")) offenders.push(file);
    for (const file of mdFiles) {
      const text = readFileSync(join(rolesRoot, file), "utf8");
      if (text.includes("invoke_subagent(")) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
