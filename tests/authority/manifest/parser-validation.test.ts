import { describe, expect, test } from "bun:test";
import {
  parseUnifiedAgentManifest,
  validateUnifiedAgentManifest,
  type UnifiedAgentManifest,
} from "../../../olt/scripts/src/authority/manifest-schema.ts";

describe("Authority Manifest Parser - Schema Validation", () => {
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
});
