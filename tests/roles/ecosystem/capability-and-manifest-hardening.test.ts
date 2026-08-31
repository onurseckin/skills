import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  CANONICAL_ROLE_CAPABILITIES,
  assertValidManifest,
  canonicalizePersonaInput,
  computePersonaSignatureHash,
  evaluateWatchdogRoleBoundary,
  getRoleCapabilities,
  hashManifestSpec,
  hashRoleContract,
  isCodeWritePermitted,
  isCommandPermitted,
  isSubagentSpawnPermitted,
  validateAgentManifestSchema,
  validateRoleContractSchema,
  verifyPersonaIntegrity,
} from "../../../olt/scripts/src/roles/index.ts";

describe("Domain 16: Roles, Personas & Manifest Auditing Hardening", () => {
  describe("1. Role Capability Matrix & Watchdog Boundary Enforcement", () => {
    test("verifies canonical capability declarations across standard tiers", () => {
      expect(CANONICAL_ROLE_CAPABILITIES.mind.tier).toBe(0);
      expect(CANONICAL_ROLE_CAPABILITIES.mind.canWriteCode).toBe(false);
      expect(CANONICAL_ROLE_CAPABILITIES.mind.canSpawnSubagents).toBe(true);

      expect(CANONICAL_ROLE_CAPABILITIES.orchestrator.tier).toBe(1);
      expect(CANONICAL_ROLE_CAPABILITIES.orchestrator.canWriteCode).toBe(false);

      expect(CANONICAL_ROLE_CAPABILITIES.coordinator.tier).toBe(2);
      expect(CANONICAL_ROLE_CAPABILITIES.coordinator.canWriteCode).toBe(false);

      expect(CANONICAL_ROLE_CAPABILITIES.implementer.tier).toBe(3);
      expect(CANONICAL_ROLE_CAPABILITIES.implementer.canWriteCode).toBe(true);
      expect(CANONICAL_ROLE_CAPABILITIES.implementer.canClaimLeases).toBe(true);

      expect(CANONICAL_ROLE_CAPABILITIES.validator.tier).toBe(3);
      expect(CANONICAL_ROLE_CAPABILITIES.validator.canWriteCode).toBe(false);
      expect(CANONICAL_ROLE_CAPABILITIES.validator.canExecuteCommands).toBe(false);
      expect(CANONICAL_ROLE_CAPABILITIES.validator.canClaimLeases).toBe(false);
    });

    test("resolves dynamic role capabilities accurately with fallback heuristics", () => {
      const dynamicValidator = getRoleCapabilities("validator-custom-domain");
      expect(dynamicValidator.profile).toBe("adversarial");
      expect(dynamicValidator.canWriteCode).toBe(false);
      expect(dynamicValidator.canExecuteCommands).toBe(false);

      const dynamicSupervisor = getRoleCapabilities("coordinator-custom");
      expect(dynamicSupervisor.canWriteCode).toBe(false);
      expect(dynamicSupervisor.canSpawnSubagents).toBe(true);
    });

    test("evaluates permission checks correctly", () => {
      expect(isCodeWritePermitted("implementer")).toBe(true);
      expect(isCodeWritePermitted("repairer")).toBe(true);
      expect(isCodeWritePermitted("validator")).toBe(false);
      expect(isCodeWritePermitted("coordinator")).toBe(false);

      expect(isSubagentSpawnPermitted("mind", "orchestrator")).toBe(true);
      expect(isSubagentSpawnPermitted("orchestrator", "coordinator")).toBe(true);
      expect(isSubagentSpawnPermitted("orchestrator", "implementer")).toBe(false);
      expect(isSubagentSpawnPermitted("validator")).toBe(false);

      expect(isCommandPermitted("implementer", "bun test *")).toBe(true);
      expect(isCommandPermitted("validator", "run:exec")).toBe(false);
    });

    test("watchdog enforces role boundaries and flags violations", () => {
      const coordWrite = evaluateWatchdogRoleBoundary("coordinator", "code_write", "src/auth.ts");
      expect(coordWrite.allowed).toBe(false);
      expect(coordWrite.violation?.ruleId).toBe("watchdog:role-boundary:zero-code-edits");

      const valCmd = evaluateWatchdogRoleBoundary("validator", "command_exec", "run:exec");
      expect(valCmd.allowed).toBe(false);
      expect(valCmd.violation?.ruleId).toBe("watchdog:role-boundary:forbidden-command");

      const valLease = evaluateWatchdogRoleBoundary("validator", "lease_claim", "task-1");
      expect(valLease.allowed).toBe(false);
      expect(valLease.violation?.ruleId).toBe("watchdog:role-boundary:lease-prohibited");

      const implWrite = evaluateWatchdogRoleBoundary("implementer", "code_write", "src/auth.ts");
      expect(implWrite.allowed).toBe(true);
      expect(implWrite.violation).toBeUndefined();
    });
  });

  describe("2. Deterministic Persona Signature Hashing & Integrity Verification", () => {
    test("computes identical hashes regardless of key insertion order or array permutation", () => {
      const inputA = {
        name: "implementer",
        role: "implementer",
        tier: 3 as const,
        may: ["edit files in scope", "run tests"],
        mustNot: ["break invariants", "suppress lints"],
        commands: ["bun harness.ts task:claim", "bun harness.ts task:submit"],
        spawns: ["sub-implementer", "sub-validator"],
        invariants: ["ZERO_ANY_INVARIANT", "ZERO_SUPPRESSIONS_INVARIANT"],
      };

      const inputB = {
        name: "implementer",
        role: "implementer",
        tier: 3 as const,
        invariants: ["ZERO_SUPPRESSIONS_INVARIANT", "ZERO_ANY_INVARIANT"],
        spawns: ["sub-validator", "sub-implementer"],
        commands: ["bun harness.ts task:submit", "bun harness.ts task:claim"],
        mustNot: ["suppress lints", "break invariants"],
        may: ["run tests", "edit files in scope"],
      };

      const hashA = computePersonaSignatureHash(inputA);
      const hashB = computePersonaSignatureHash(inputB);

      expect(hashA.signatureHash).toBe(hashB.signatureHash);
      expect(canonicalizePersonaInput(inputA)).toBe(canonicalizePersonaInput(inputB));
    });

    test("verifies persona integrity against valid and tampered hashes", () => {
      const input = {
        name: "validator",
        role: "validator",
        tier: 3 as const,
        may: ["inspect read-only files"],
        mustNot: ["execute write commands"],
        commands: [],
        spawns: [],
        invariants: ["ANTI_BOUNDARY_LEAK"],
      };

      const digest = computePersonaSignatureHash(input);
      const validReport = verifyPersonaIntegrity(input, digest.signatureHash);
      expect(validReport.valid).toBe(true);
      expect(validReport.mismatches.length).toBe(0);

      const tamperedReport = verifyPersonaIntegrity(
        input,
        "0000000000000000000000000000000000000000000000000000000000000000",
      );
      expect(tamperedReport.valid).toBe(false);
      expect(tamperedReport.mismatches.length).toBe(1);
    });

    test("helper hash functions generate consistent SHA-256 digests", () => {
      const contractHash = hashRoleContract(
        "planner",
        2,
        ["plan:brainstorm"],
        ["edit_file"],
        ["bun harness.ts plan:*"],
        [],
      );
      expect(contractHash).toHaveLength(64);

      const manifestHash = hashManifestSpec(
        "planner",
        "planner",
        2,
        ["plan:brainstorm"],
        ["edit_file"],
        ["bun harness.ts plan:*"],
        [],
        ["MANDATORY_BRAINSTORM_BEFORE_COMPILE"],
      );
      expect(manifestHash).toHaveLength(64);
    });
  });

  describe("3. Manifest & Role Contract Schema Validation", () => {
    test("validates well-formed agent manifest schema", () => {
      const validManifest = {
        name: "implementer",
        role: "implementer",
        tier: 3,
        tools: {
          enable_write_tools: true,
          enable_subagent_tools: true,
        },
        communication_contract: {
          protocol: "mailbox_ipc",
          allowed_channels: ["msg:send", "msg:recv"],
        },
        permissions: {
          may: ["code edits"],
          must_not: ["suppressions"],
        },
        invariants: ["ZERO_ANY_INVARIANT"],
      };

      const res = validateAgentManifestSchema(validManifest);
      expect(res.valid).toBe(true);
      expect(res.errors.length).toBe(0);
      expect(() => assertValidManifest(validManifest)).not.toThrow();
    });

    test("rejects malformed manifest objects with detailed diagnostics", () => {
      const malformedManifest = {
        name: "",
        tier: "invalid_tier",
        tools: {
          enable_write_tools: "not_a_boolean",
        },
        communication_contract: {
          protocol: 123,
          allowed_channels: [456],
        },
      };

      const res = validateAgentManifestSchema(malformedManifest);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.field === "name")).toBe(true);
      expect(res.errors.some((e) => e.field === "tier")).toBe(true);
      expect(res.errors.some((e) => e.field === "tools.enable_write_tools")).toBe(true);
      expect(res.errors.some((e) => e.field === "communication_contract.protocol")).toBe(true);

      expect(() => assertValidManifest(malformedManifest)).toThrow(HarnessError);
    });

    test("validates role contract schema and detects invalid fields", () => {
      const validContract = {
        role: "validator",
        tier: 3,
        may: ["audit"],
        must_not: ["write"],
        commands: [],
        spawns: [],
      };

      const res = validateRoleContractSchema(validContract);
      expect(res.valid).toBe(true);
      expect(res.errors.length).toBe(0);

      const invalidContract = {
        role: "",
        tier: 99,
        may: "not_an_array",
      };

      const invalidRes = validateRoleContractSchema(invalidContract);
      expect(invalidRes.valid).toBe(false);
      expect(invalidRes.errors.some((e) => e.field === "role")).toBe(true);
      expect(invalidRes.errors.some((e) => e.field === "tier")).toBe(true);
    });
  });
});
