import { describe, expect, it } from "bun:test";
import {
  assertValidManifest,
  validateAgentManifestSchema,
  validateRoleContractSchema,
} from "../../olt/scripts/src/roles/manifest-schema.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";

describe("Agent & Role Manifest Schema Validation", () => {
  describe("validateAgentManifestSchema", () => {
    it("rejects non-object root payloads", () => {
      const invalidInputs = [null, undefined, "not-an-object", 123, true, [1, 2, 3]];
      for (const input of invalidInputs) {
        const result = validateAgentManifestSchema(input);
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]?.field).toBe("root");
        expect(result.errors[0]?.message).toContain("non-null object");
      }
    });

    it("rejects manifests missing name and valid tier", () => {
      const result = validateAgentManifestSchema({});
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "name")).toBe(true);
      expect(result.errors.some((e) => e.field === "tier")).toBe(true);
    });

    it("rejects empty or whitespace-only name and invalid tier values", () => {
      const result = validateAgentManifestSchema({
        name: "   ",
        tier: 99,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "name")).toBe(true);
      expect(result.errors.some((e) => e.field === "tier")).toBe(true);
      expect(result.tier).toBeUndefined();
    });

    it("accepts all valid tier types and defaults role to name", () => {
      const validTiers = [0, 1, 2, 3, "independent"] as const;
      for (const tier of validTiers) {
        const result = validateAgentManifestSchema({
          name: "agent-x",
          tier,
        });
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(result.role).toBe("agent-x");
        expect(result.tier).toBe(tier);
      }
    });

    it("uses trimmed explicit role when provided", () => {
      const result = validateAgentManifestSchema({
        name: "mind-lead",
        role: "  mind  ",
        tier: 0,
      });
      expect(result.valid).toBe(true);
      expect(result.role).toBe("mind");
      expect(result.tier).toBe(0);
    });

    it("validates tools field types and flags", () => {
      expect(validateAgentManifestSchema({ name: "agent", tier: 1, tools: "invalid" }).valid).toBe(
        false,
      );

      expect(
        validateAgentManifestSchema({
          name: "agent",
          tier: 1,
          tools: { enable_write_tools: "yes" },
        }).valid,
      ).toBe(false);

      expect(
        validateAgentManifestSchema({
          name: "agent",
          tier: 1,
          tools: { enable_subagent_tools: 123 },
        }).valid,
      ).toBe(false);

      const validResult = validateAgentManifestSchema({
        name: "agent",
        tier: 1,
        tools: { enable_write_tools: true, enable_subagent_tools: false },
      });
      expect(validResult.valid).toBe(true);
    });

    it("validates communication_contract protocol and allowed_channels", () => {
      expect(
        validateAgentManifestSchema({
          name: "agent",
          tier: 1,
          communication_contract: "not-obj",
        }).valid,
      ).toBe(false);

      expect(
        validateAgentManifestSchema({
          name: "agent",
          tier: 1,
          communication_contract: { protocol: 123 },
        }).valid,
      ).toBe(false);

      expect(
        validateAgentManifestSchema({
          name: "agent",
          tier: 1,
          communication_contract: { protocol: "mailbox", allowed_channels: [123] },
        }).valid,
      ).toBe(false);

      const validResult = validateAgentManifestSchema({
        name: "agent",
        tier: 1,
        communication_contract: {
          protocol: "mailbox_ipc",
          allowed_channels: ["msg:send", "msg:recv"],
        },
      });
      expect(validResult.valid).toBe(true);
    });

    it("validates permissions sub-fields (may, must_not, commands, spawns)", () => {
      expect(
        validateAgentManifestSchema({ name: "agent", tier: 1, permissions: "invalid" }).valid,
      ).toBe(false);

      expect(
        validateAgentManifestSchema({ name: "agent", tier: 1, permissions: { may: "edit" } }).valid,
      ).toBe(false);

      expect(
        validateAgentManifestSchema({
          name: "agent",
          tier: 1,
          permissions: { must_not: [123] },
        }).valid,
      ).toBe(false);

      expect(
        validateAgentManifestSchema({
          name: "agent",
          tier: 1,
          permissions: { commands: [false] },
        }).valid,
      ).toBe(false);

      expect(
        validateAgentManifestSchema({
          name: "agent",
          tier: 1,
          permissions: { spawns: "none" },
        }).valid,
      ).toBe(false);

      const validResult = validateAgentManifestSchema({
        name: "agent",
        tier: 1,
        permissions: {
          may: ["read_file"],
          must_not: ["write_file"],
          commands: ["status"],
          spawns: ["worker"],
        },
      });
      expect(validResult.valid).toBe(true);
    });

    it("validates invariants string array", () => {
      expect(
        validateAgentManifestSchema({ name: "agent", tier: 1, invariants: "not-array" }).valid,
      ).toBe(false);

      expect(validateAgentManifestSchema({ name: "agent", tier: 1, invariants: [123] }).valid).toBe(
        false,
      );

      const validResult = validateAgentManifestSchema({
        name: "agent",
        tier: 1,
        invariants: ["ZERO_CODE_EDITS", "STRICT_TIER_HIERARCHY"],
      });
      expect(validResult.valid).toBe(true);
    });
  });

  describe("validateRoleContractSchema", () => {
    it("rejects non-object role contract payloads", () => {
      const invalidInputs = [null, undefined, 42, "role", []];
      for (const input of invalidInputs) {
        const result = validateRoleContractSchema(input);
        expect(result.valid).toBe(false);
        expect(result.errors[0]?.field).toBe("root");
        expect(result.errors[0]?.message).toContain("non-null object");
      }
    });

    it("rejects role contracts missing role or valid tier", () => {
      const result = validateRoleContractSchema({ role: "", tier: "invalid" });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "role")).toBe(true);
      expect(result.errors.some((e) => e.field === "tier")).toBe(true);
    });

    it("validates role contract permissions arrays (may, must_not, commands, spawns)", () => {
      const validContract = {
        role: "implementer",
        tier: 3 as const,
        may: ["edit_file", "write_file"],
        must_not: ["claim_supervisory_role"],
        commands: ["test", "build"],
        spawns: [],
      };
      expect(validateRoleContractSchema(validContract).valid).toBe(true);

      expect(validateRoleContractSchema({ ...validContract, may: [123] }).valid).toBe(false);
      expect(validateRoleContractSchema({ ...validContract, must_not: "none" }).valid).toBe(false);
      expect(validateRoleContractSchema({ ...validContract, commands: [null] }).valid).toBe(false);
      expect(validateRoleContractSchema({ ...validContract, spawns: "orchestrator" }).valid).toBe(
        false,
      );
    });
  });

  describe("assertValidManifest", () => {
    it("passes assertion for valid manifests", () => {
      const valid = {
        name: "coordinator",
        role: "coordinator",
        tier: 2,
        tools: { enable_subagent_tools: true },
        permissions: { may: ["dispatch"] },
      };
      expect(() => assertValidManifest(valid)).not.toThrow();
    });

    it("throws HarnessError on invalid manifest schema", () => {
      const invalid = {
        name: "",
        tier: 99,
      };
      expect(() => assertValidManifest(invalid)).toThrow(HarnessError);
      expect(() => assertValidManifest(invalid)).toThrow(/Manifest schema validation failed/);
    });
  });
});
