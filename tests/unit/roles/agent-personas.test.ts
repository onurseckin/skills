import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isAgentRole } from "../../../orchestrating-long-tasks/scripts/src/contracts/packets.ts";
import {
  MAX_REPAIR_ROUNDS,
  MIN_ADVERSARIAL_PROBES,
} from "../../../orchestrating-long-tasks/scripts/src/config/constants.ts";

const agentsRoot = join(import.meta.dir, "..", "..", "..", "orchestrating-long-tasks", "agents");

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
});
