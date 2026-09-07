import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  parseUnifiedAgentManifest,
  validateUnifiedAgentManifest,
  type UnifiedAgentManifest,
} from "../../../olt/scripts/src/authority/manifest-schema.ts";
import {
  cleanupVirtualAuthorityFS,
  setupVirtualAuthorityFS,
} from "../fixture.ts";

describe("Authority Manifest Parser - Schema Validation", () => {
  beforeEach(() => {
    setupVirtualAuthorityFS();
  });

  afterEach(() => {
    cleanupVirtualAuthorityFS();
  });

  test("validates valid minimal unified agent manifest", () => {
    const yaml = `
name: "implementer"
role: "implementer"
tier: 3
permissions:
  may:
    - edit_code
  must_not:
    - break_repo
`;
    const manifest = parseUnifiedAgentManifest(yaml, "implementer.yaml");
    const result = validateUnifiedAgentManifest(manifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("validates communication contract and turn1 actions", () => {
    const yaml = `
name: "coordinator"
role: "coordinator"
tier: 2
permissions:
  may: [task:delegate]
  must_not: [task:implement]
communication_contract:
  protocol: "mailbox_ipc"
  mailbox_path: ".olt/mailboxes/{agent_id}/"
  lock_path: ".olt/locks/{agent_id}.lock"
  allowed_channels:
    - "msg:send"
  ban_raw_jsonl_reading: true
  forbid_native_messaging: true
mandatory_turn1_actions:
  - "whoami"
`;
    const manifest = parseUnifiedAgentManifest(yaml, "coordinator.yaml");
    const result = validateUnifiedAgentManifest(manifest);
    expect(result.valid).toBe(true);
    expect(manifest.communication_contract?.protocol).toBe("mailbox_ipc");
    expect(manifest.mandatory_turn1_actions).toEqual(["whoami"]);
  });

  test("detects missing or invalid required fields", () => {
    const badManifest: UnifiedAgentManifest = {
      name: "",
      role: "",
      tier: 99 as unknown as number,
      permissions: {
        may: "invalid" as unknown as string[],
        must_not: [],
      },
    };
    const result = validateUnifiedAgentManifest(badManifest);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("detects invalid tier type, non-array permissions, and invalid protocol", () => {
    const invalidManifest = {
      name: "test-agent",
      role: "test-agent",
      tier: "invalid_tier" as unknown as number,
      provider: ["generic"],
      tools: { enable_subagent_tools: true, enable_write_tools: true },
      interface: { display_name: "Agent", short_description: "Desc" },
      permissions: {
        may: null as unknown as string[],
        must_not: [123 as unknown as string],
        spawns: [],
      },
      invariants: "not-an-array" as unknown as string[],
      protocol: { cli: 123 as unknown as string, zero_json: true },
      instructions: "Test instructions",
      communication_contract: {
        protocol: 123 as unknown as string,
        mailbox_path: ".olt/mailboxes/test",
        lock_path: ".olt/locks/test.lock",
        allowed_channels: ["msg:send"],
      } as unknown,
    } as unknown as UnifiedAgentManifest;

    const result = validateUnifiedAgentManifest(invalidManifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("tier"))).toBe(true);
    expect(result.errors.some((e) => e.includes("permissions.may"))).toBe(true);
    expect(result.errors.some((e) => e.includes("permissions.must_not"))).toBe(true);
    expect(result.errors.some((e) => e.includes("invariants"))).toBe(true);
    expect(result.errors.some((e) => e.includes("protocol.cli"))).toBe(true);
    expect(result.errors.some((e) => e.includes("communication_contract.protocol"))).toBe(true);
  });
});

