import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import { AGENT_ROLES, isAgentRole } from "../../../olt/scripts/src/core/contracts/index.ts";
import {
  loadRoleContract,
  loadValidatorDomainContract,
  resolveRoleContractPath,
  VALIDATOR_DOMAINS,
} from "../../../olt/scripts/src/packets/role-contract.ts";

const rolesRoot = dirname(resolveRoleContractPath("planner"));

// B12.2: a validator domain variant is not a canonical AgentRole — it declares `role: validator`
// plus `domain:`, so every workflow check keyed on the literal role string "validator" (packet
// isolation, token authorization, task:review acceptance) keeps working unchanged. Its filename
// therefore does not match a member of AGENT_ROLES the way every other role document's does.
const domainFiles = VALIDATOR_DOMAINS.map((domain) => `validator-${domain}`).sort();

describe("canonical role documents", () => {
  test("agents/ holds unified manifests for all canonical roles", () => {
    const documented = readdirSync(rolesRoot)
      .filter((entry) => entry.endsWith(".yaml") || entry.endsWith(".yml"))
      .map((entry) => entry.replace(/\.(yaml|yml)$/, ""))
      .filter((entry) => isAgentRole(entry))
      .sort();
    expect(documented).toEqual([...AGENT_ROLES].sort());
  });

  test("every validator domain document declares role validator and its own domain", () => {
    for (const domain of VALIDATOR_DOMAINS) {
      const domainContract = loadValidatorDomainContract(domain);
      expect(domainContract.role).toBe("validator");
      expect(domainContract.domain).toBe(domain);
      expect(domainContract.tier).toBeGreaterThanOrEqual(1);
      expect(domainContract.tier).toBeLessThanOrEqual(3);
      expect(domainContract.may.length).toBeGreaterThan(0);
      expect(domainContract.must_not.length).toBeGreaterThan(0);
      expect(domainContract.commands).not.toContain("run:exec");
      expect(domainContract.spawns).toEqual(["sub-validator"]);
      expect(domainContract.sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(domainContract.checklist?.domain).toBe(domain);
      expect(domainContract.checklist?.items.length).toBeGreaterThan(0);
    }
  });

  test("a validator domain contract's digest changes if its checklist changes and not otherwise", () => {
    const a = loadValidatorDomainContract("code-quality");
    const b = loadValidatorDomainContract("code-quality");
    expect(a.sha256).toBe(b.sha256);
    // Every domain's combined digest is distinct — nobody accidentally shares a checklist file.
    const digests = new Set(VALIDATOR_DOMAINS.map((d) => loadValidatorDomainContract(d).sha256));
    expect(digests.size).toBe(VALIDATOR_DOMAINS.length);
  });

  test("the standing checklist text is embedded verbatim in the domain contract's packet text", () => {
    for (const domain of VALIDATOR_DOMAINS) {
      const contract = loadValidatorDomainContract(domain);
      for (const item of contract.checklist!.items) {
        expect(contract.text).toContain(item.id);
        expect(contract.text).toContain(item.rule);
      }
    }
  });

  test("every role document declares a nonempty capability contract", () => {
    for (const role of AGENT_ROLES) {
      const contract = loadRoleContract(role);
      expect(contract.role).toBe(role);
      expect(contract.tier).toBeGreaterThanOrEqual(0);
      expect(contract.tier).toBeLessThanOrEqual(3);
      expect(contract.may.length).toBeGreaterThan(0);
      expect(contract.must_not.length).toBeGreaterThan(0);
      expect(contract.commands.length).toBeGreaterThan(0);
      if (role === "validator") {
        expect(contract.commands).not.toContain("run:exec");
      }
      expect(contract.sha256).toMatch(/^[0-9a-f]{64}$/u);
      for (const entry of [...contract.may, ...contract.must_not, ...contract.commands])
        expect(entry.trim()).toBe(entry);
    }
  });

  test("commands are named without flag syntax so they cannot drift from the manifest", () => {
    for (const role of AGENT_ROLES)
      for (const command of loadRoleContract(role).commands)
        expect(command).toMatch(/^[a-z][a-z-]*(?::[a-z][a-z-]*)*$/u);
  });

  test("spawns name canonical roles and match the documented branch topology", () => {
    const spawns = new Map(
      AGENT_ROLES.map((role) => [role, loadRoleContract(role).spawns] as const),
    );
    for (const [role, spawned] of spawns) {
      for (const child of spawned) {
        expect(isAgentRole(child)).toBe(true);
        expect(child).not.toBe(role);
      }
    }
    expect(spawns.get("implementer")).toEqual(["sub-implementer", "sub-investigator"]);
    expect(spawns.get("validator")).toEqual(["sub-validator"]);
    for (const role of ["sub-implementer", "sub-validator", "sub-investigator"] as const)
      expect(spawns.get(role)).toEqual([]);
  });

  test("sub-investigator is read-only and the drivers never edit the repository", () => {
    const investigator = loadRoleContract("sub-investigator");
    expect(investigator.must_not.join("\n")).toContain(
      "Create, edit, stage, revert, format, or delete any repository file",
    );
    expect(loadRoleContract("coordinator").must_not.join("\n")).toContain(
      "Write, edit, stage, revert, format, or delete any repository file",
    );
  });

  test("validator and completeness-critic contracts enforce mechanical anti-boundary-leak rules and repairer delegation", () => {
    const validatorContract = loadRoleContract("validator");
    const validatorMustNot = validatorContract.must_not.join("\n").toLowerCase();
    expect(validatorMustNot).toContain("anti-boundary-leak rule");
    expect(validatorMustNot).toContain("task:reject");
    expect(validatorMustNot).toContain("assigned repairer");
    expect(validatorContract.text).toContain("Anti-Boundary-Leak Rule");
    expect(validatorContract.text).toContain("task:assign-repairer");

    const criticContract = loadRoleContract("completeness-critic");
    const criticMustNot = criticContract.must_not.join("\n").toLowerCase();
    expect(criticMustNot).toContain("anti-boundary-leak rule");
    expect(criticMustNot).toContain("critic:reject");
    expect(criticMustNot).toContain("assigned repairer");
    expect(criticContract.text).toContain("Anti-Boundary-Leak Rule");
    expect(criticContract.text).toContain("task:assign-repairer");
  });
});
