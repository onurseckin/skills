import { describe, expect, test } from "bun:test";
import {
  auditPermissionHealth,
  type RepoPolicy,
} from "../../../olt/scripts/src/policy/permission-health.ts";
import type { UnifiedAgentManifest } from "../../../olt/scripts/src/authority/manifest-schema.ts";

describe("auditPermissionHealth & Manifest Proof Invariants", () => {
  const basePolicy: RepoPolicy = {
    allowed_commands: ["bun test", "git status"],
  };

  const createManifest = (overrides: Partial<UnifiedAgentManifest> = {}): UnifiedAgentManifest => ({
    name: "test-agent",
    role: "implementer",
    tier: 3,
    provider: ["generic"],
    tools: {
      enable_subagent_tools: false,
      enable_write_tools: true,
    },
    interface: {
      display_name: "Test Agent",
      short_description: "Implements tasks",
    },
    permissions: {
      may: ["edit files"],
      must_not: ["whole-repo test suites", "git commit"],
      commands: ["bun test"],
      spawns: [],
    },
    invariants: ["file-scoped testing invariant"],
    protocol: {
      cli: "bun harness.ts",
      zero_json: true,
    },
    instructions: "Follow directives",
    ...overrides,
  });

  test("Proof 1: Detects Disjoint Set Invariant violations (allowed_commands ∩ forbidden_commands != ∅)", () => {
    const invalidManifest = createManifest({
      permissions: {
        may: [],
        must_not: ["bun test"],
        commands: ["bun test"],
        spawns: [],
      },
    });

    const result = auditPermissionHealth(invalidManifest, basePolicy);
    expect(result.healthy).toBe(false);
    expect(
      result.errors.some((e) => e.includes("Proof 1 Failed: Disjoint Set Invariant violated")),
    ).toBe(true);
  });

  test("Proof 2: Detects unregistered commands outside the capabilities whitelist", () => {
    const invalidManifest = createManifest({
      permissions: {
        may: [],
        must_not: [],
        commands: ["completely_unknown_cli_command_xyz"],
        spawns: [],
      },
    });

    const result = auditPermissionHealth(invalidManifest, basePolicy);
    expect(result.healthy).toBe(false);
    expect(
      result.errors.some((e) =>
        e.includes("Proof 2 Failed: Command 'completely_unknown_cli_command_xyz' not found"),
      ),
    ).toBe(true);
  });

  test("Proof 3: Cognitive Validator confinement enforces 0 commands and enable_write_tools === false", () => {
    const invalidValidator = createManifest({
      role: "validator",
      tools: {
        enable_subagent_tools: false,
        enable_write_tools: true,
      },
      permissions: {
        may: [],
        must_not: [],
        commands: ["bun test"],
        spawns: [],
      },
    });

    const result = auditPermissionHealth(invalidValidator, basePolicy);
    expect(result.healthy).toBe(false);
    expect(
      result.errors.some((e) =>
        e.includes(
          "Proof 3 Failed: Cognitive Validator 'validator' must have tools.enable_write_tools === false",
        ),
      ),
    ).toBe(true);
    expect(
      result.errors.some((e) =>
        e.includes(
          "Proof 3 Failed: Cognitive Validator 'validator' must have 0 command privileges",
        ),
      ),
    ).toBe(true);

    const validValidator = createManifest({
      role: "ui-validator",
      tools: {
        enable_subagent_tools: false,
        enable_write_tools: false,
      },
      permissions: {
        may: [],
        must_not: [],
        commands: [],
        spawns: [],
      },
    });

    const validResult = auditPermissionHealth(validValidator, basePolicy);
    expect(validResult.healthy).toBe(true);
  });

  test("Proof 3: Supervisor confinement enforces enable_write_tools === false and must_not file edits", () => {
    const invalidSupervisor = createManifest({
      role: "coordinator",
      tools: {
        enable_subagent_tools: true,
        enable_write_tools: true,
      },
      permissions: {
        may: [],
        must_not: [],
        commands: ["git status"],
        spawns: [],
      },
    });

    const result = auditPermissionHealth(invalidSupervisor, basePolicy);
    expect(result.healthy).toBe(false);
    expect(
      result.errors.some((e) =>
        e.includes(
          "Proof 3 Failed: Supervisor role 'coordinator' must have tools.enable_write_tools === false",
        ),
      ),
    ).toBe(true);
    expect(
      result.errors.some((e) =>
        e.includes(
          "Proof 3 Failed: Supervisor role 'coordinator' must have prohibitions against file edits in must_not",
        ),
      ),
    ).toBe(true);

    const validMind = createManifest({
      role: "mind",
      tools: {
        enable_subagent_tools: true,
        enable_write_tools: false,
      },
      permissions: {
        may: [],
        must_not: ["write repository code", "file edit"],
        commands: ["whoami"],
        spawns: ["orchestrator"],
      },
    });

    const validResult = auditPermissionHealth(validMind, basePolicy);
    expect(validResult.healthy).toBe(true);
  });

  test("Proof 3: Implementer and Worker require whole-repo test prohibitions and file-scoped invariants", () => {
    const invalidWorker = createManifest({
      role: "worker",
      permissions: {
        may: [],
        must_not: [],
        commands: ["bun test"],
        spawns: [],
      },
      invariants: [],
    });

    const result = auditPermissionHealth(invalidWorker, basePolicy);
    expect(result.healthy).toBe(false);
    expect(
      result.errors.some((e) =>
        e.includes(
          "Proof 3 Failed: Implementer 'worker' must have whole-repo test suites prohibited",
        ),
      ),
    ).toBe(true);
    expect(
      result.errors.some((e) =>
        e.includes("Proof 3 Failed: Implementer 'worker' must have file-scoped test invariants"),
      ),
    ).toBe(true);

    const validImplementer = createManifest({
      role: "sub-implementer",
      permissions: {
        may: [],
        must_not: ["full suite test runs"],
        commands: ["bun test"],
        spawns: [],
      },
      invariants: ["file scoped tests only"],
    });

    const validResult = auditPermissionHealth(validImplementer, basePolicy);
    expect(validResult.healthy).toBe(true);
  });

  test("Proof 4: Spawning Authority DAG validates non-empty string spawn targets", () => {
    const invalidSpawns = createManifest({
      permissions: {
        may: [],
        must_not: ["whole repo"],
        commands: ["bun test"],
        spawns: ["   ", ""],
      },
    });

    const result = auditPermissionHealth(invalidSpawns, basePolicy);
    expect(result.healthy).toBe(false);
    expect(
      result.errors.some((e) =>
        e.includes("Proof 4 Failed: Invalid spawn target in permissions.spawns"),
      ),
    ).toBe(true);
  });
});
