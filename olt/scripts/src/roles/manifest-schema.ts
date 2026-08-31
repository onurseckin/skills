import { HarnessError } from "../core/errors/index.ts";
import type {
  ManifestSchemaError,
  ManifestSchemaValidationResult,
  RoleExecutionTier,
} from "./types.ts";

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function isStringArray(val: unknown): val is readonly string[] {
  return Array.isArray(val) && val.every((item) => typeof item === "string");
}

function isValidTier(val: unknown): val is RoleExecutionTier {
  return val === 0 || val === 1 || val === 2 || val === 3 || val === "independent";
}

export function validateAgentManifestSchema(raw: unknown): ManifestSchemaValidationResult {
  const errors: ManifestSchemaError[] = [];
  const warnings: string[] = [];

  if (!isObject(raw)) {
    return {
      valid: false,
      errors: [
        { field: "root", message: "Manifest must be a non-null object", receivedValue: raw },
      ],
      warnings: [],
    };
  }

  const name = typeof raw.name === "string" ? raw.name.trim() : undefined;
  const role = typeof raw.role === "string" ? raw.role.trim() : name;
  const tier = raw.tier;

  if (!name || name.length === 0) {
    errors.push({
      field: "name",
      message: "Manifest must declare a non-empty 'name' string",
      receivedValue: raw.name,
    });
  }

  if (!isValidTier(tier)) {
    errors.push({
      field: "tier",
      message: "Manifest 'tier' must be 0, 1, 2, 3, or 'independent'",
      receivedValue: tier,
    });
  }

  if (raw.tools !== undefined) {
    if (!isObject(raw.tools)) {
      errors.push({
        field: "tools",
        message: "'tools' must be an object",
        receivedValue: raw.tools,
      });
    } else {
      if (
        raw.tools.enable_write_tools !== undefined &&
        typeof raw.tools.enable_write_tools !== "boolean"
      ) {
        errors.push({
          field: "tools.enable_write_tools",
          message: "'enable_write_tools' must be a boolean",
          receivedValue: raw.tools.enable_write_tools,
        });
      }
      if (
        raw.tools.enable_subagent_tools !== undefined &&
        typeof raw.tools.enable_subagent_tools !== "boolean"
      ) {
        errors.push({
          field: "tools.enable_subagent_tools",
          message: "'enable_subagent_tools' must be a boolean",
          receivedValue: raw.tools.enable_subagent_tools,
        });
      }
    }
  }

  if (raw.communication_contract !== undefined) {
    if (!isObject(raw.communication_contract)) {
      errors.push({
        field: "communication_contract",
        message: "'communication_contract' must be an object",
        receivedValue: raw.communication_contract,
      });
    } else {
      if (typeof raw.communication_contract.protocol !== "string") {
        errors.push({
          field: "communication_contract.protocol",
          message: "'protocol' must be a string",
          receivedValue: raw.communication_contract.protocol,
        });
      }
      if (
        raw.communication_contract.allowed_channels !== undefined &&
        !isStringArray(raw.communication_contract.allowed_channels)
      ) {
        errors.push({
          field: "communication_contract.allowed_channels",
          message: "'allowed_channels' must be an array of strings",
          receivedValue: raw.communication_contract.allowed_channels,
        });
      }
    }
  }

  if (raw.permissions !== undefined) {
    if (!isObject(raw.permissions)) {
      errors.push({
        field: "permissions",
        message: "'permissions' must be an object",
        receivedValue: raw.permissions,
      });
    } else {
      if (raw.permissions.may !== undefined && !isStringArray(raw.permissions.may)) {
        errors.push({
          field: "permissions.may",
          message: "'permissions.may' must be an array of strings",
          receivedValue: raw.permissions.may,
        });
      }
      if (raw.permissions.must_not !== undefined && !isStringArray(raw.permissions.must_not)) {
        errors.push({
          field: "permissions.must_not",
          message: "'permissions.must_not' must be an array of strings",
          receivedValue: raw.permissions.must_not,
        });
      }
      if (raw.permissions.commands !== undefined && !isStringArray(raw.permissions.commands)) {
        errors.push({
          field: "permissions.commands",
          message: "'permissions.commands' must be an array of strings",
          receivedValue: raw.permissions.commands,
        });
      }
      if (raw.permissions.spawns !== undefined && !isStringArray(raw.permissions.spawns)) {
        errors.push({
          field: "permissions.spawns",
          message: "'permissions.spawns' must be an array of strings",
          receivedValue: raw.permissions.spawns,
        });
      }
    }
  }

  if (raw.invariants !== undefined && !isStringArray(raw.invariants)) {
    errors.push({
      field: "invariants",
      message: "'invariants' must be an array of strings",
      receivedValue: raw.invariants,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    role,
    tier: isValidTier(tier) ? tier : undefined,
  };
}

export function validateRoleContractSchema(raw: unknown): ManifestSchemaValidationResult {
  const errors: ManifestSchemaError[] = [];
  const warnings: string[] = [];

  if (!isObject(raw)) {
    return {
      valid: false,
      errors: [
        { field: "root", message: "Role contract must be a non-null object", receivedValue: raw },
      ],
      warnings: [],
    };
  }

  const role = typeof raw.role === "string" ? raw.role.trim() : undefined;
  const tier = raw.tier;

  if (!role || role.length === 0) {
    errors.push({
      field: "role",
      message: "Role contract must declare a non-empty 'role' string",
      receivedValue: raw.role,
    });
  }

  if (!isValidTier(tier)) {
    errors.push({
      field: "tier",
      message: "Role contract 'tier' must be 0, 1, 2, 3, or 'independent'",
      receivedValue: tier,
    });
  }

  if (raw.may !== undefined && !isStringArray(raw.may)) {
    errors.push({
      field: "may",
      message: "'may' must be an array of strings",
      receivedValue: raw.may,
    });
  }

  if (raw.must_not !== undefined && !isStringArray(raw.must_not)) {
    errors.push({
      field: "must_not",
      message: "'must_not' must be an array of strings",
      receivedValue: raw.must_not,
    });
  }

  if (raw.commands !== undefined && !isStringArray(raw.commands)) {
    errors.push({
      field: "commands",
      message: "'commands' must be an array of strings",
      receivedValue: raw.commands,
    });
  }

  if (raw.spawns !== undefined && !isStringArray(raw.spawns)) {
    errors.push({
      field: "spawns",
      message: "'spawns' must be an array of strings",
      receivedValue: raw.spawns,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    role,
    tier: isValidTier(tier) ? tier : undefined,
  };
}

export function assertValidManifest(raw: unknown): asserts raw is Record<string, unknown> {
  const result = validateAgentManifestSchema(raw);
  if (!result.valid) {
    const detail = result.errors.map((e) => `${e.field}: ${e.message}`).join("; ");
    throw new HarnessError("INVALID_ARGUMENT", `Manifest schema validation failed: ${detail}`);
  }
}
