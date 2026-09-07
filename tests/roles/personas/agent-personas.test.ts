import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { isAgentRole } from "../../../olt/scripts/src/core/contracts/index.ts";
import { resolveRoleContractPath } from "../../../olt/scripts/src/packets/role-contract.ts";
import { cleanupVirtualRolesFS, getVirtualRolesFS, setupVirtualRolesFS } from "../fixture.ts";

const agentsRoot = join(import.meta.dir, "..", "..", "..", "olt", "agents");
const rolesRoot = dirname(resolveRoleContractPath("planner"));

function persona(name: string): string {
  const vfs = getVirtualRolesFS();
  const raw = vfs.readFileSync(join(agentsRoot, name), "utf8");
  return typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
}

describe("agent personas", () => {
  beforeEach(() => {
    setupVirtualRolesFS();
  });

  afterEach(() => {
    cleanupVirtualRolesFS();
  });

  test("every declared persona role is part of the canonical vocabulary", () => {
    const vfs = getVirtualRolesFS();
    const files = (vfs.readdirSync(agentsRoot) as string[]).filter((entry) =>
      entry.endsWith(".yaml"),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const declared = /^ {2}role: "([^"]+)"$/mu.exec(persona(file));
      if (!declared) continue;
      expect(isAgentRole(declared[1])).toBe(true);
    }
  });

  test("personas carry the canonical probe and repair budgets", () => {
    const validator = persona("validator.yaml");
    expect(validator).toContain("min_adversarial_probes: 1");
    expect(validator).toContain("max_adversarial_pushes: 20");
    expect(validator).toContain("cognitive_pushes: 5");
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
    const vfs = getVirtualRolesFS();
    const yamlFiles = (vfs.readdirSync(agentsRoot) as string[]).filter((entry) =>
      entry.endsWith(".yaml"),
    );
    const mdFiles = (
      vfs.existsSync(rolesRoot) ? (vfs.readdirSync(rolesRoot) as string[]) : []
    ).filter((entry) => {
      const full = join(rolesRoot, entry);
      return entry.endsWith(".md") && vfs.statSync(full).isFile();
    });
    const offenders: string[] = [];
    for (const file of yamlFiles)
      if (persona(file).includes("invoke_subagent(")) offenders.push(file);
    for (const file of mdFiles) {
      const text = vfs.readFileSync(join(rolesRoot, file), "utf8") as string;
      if (text.includes("invoke_subagent(")) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  test("validator personas strictly enforce cognitive vs mechanic separation", () => {
    const validator = persona("validator.yaml");
    expect(validator).toContain("Strict Command-Running Ban");
    expect(validator).not.toContain("- run:exec");

    const mechanic = persona("ui-headless-validator.yaml");
    expect(mechanic).toContain("run:exec");
  });
});
