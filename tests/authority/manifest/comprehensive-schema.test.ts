import { describe, expect, test } from "bun:test";
import { parseYaml } from "../../../olt/scripts/src/authority/manifest/index.ts";
import {
  parseUnifiedAgentManifest,
  validateUnifiedAgentManifest,
  type UnifiedAgentManifest,
} from "../../../olt/scripts/src/authority/manifest-schema.ts";

describe("Authority Manifest Comprehensive - Schema & YAML Parsing", () => {
  test("parseUnifiedAgentManifest and validateUnifiedAgentManifest complete error paths", () => {
    expect(() => parseUnifiedAgentManifest("just a string")).toThrow(
      "YAML document must be an object",
    );
    expect(() => parseUnifiedAgentManifest("- item1\n- item2")).toThrow(
      "YAML document must be an object",
    );

    const fullYaml = `
name: custom-mind
role: mind
tier: independent
provider:
  - antigravity
  - claude
tools:
  enable_subagent_tools: true
  enable_write_tools: false
interface:
  display_name: "Mind Lead"
  short_description: "Top-level supervisor"
permissions:
  may:
    - pulse:cycle
  must_not:
    - code:edit
  commands:
    - run:exec
  spawns:
    - orchestrator
invariants:
  - "Invariant 1"
domain: "core-mind"
protocol:
  cli: "bun harness.ts"
  zero_json: true
instructions: "Full instructions here"
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
dispatch_contract: "custom_dispatch_spec"
`;
    const manifest = parseUnifiedAgentManifest(fullYaml, "custom-mind.yaml");
    expect(manifest.tier).toBe("independent");
    expect(manifest.communication_contract?.forbid_native_messaging).toBe(true);
    expect(manifest.mandatory_turn1_actions).toEqual(["whoami"]);
    expect(manifest.dispatch_contract).toBe("custom_dispatch_spec");

    const validResult = validateUnifiedAgentManifest(manifest);
    expect(validResult.valid).toBe(true);
    expect(validResult.errors.length).toBe(0);

    const invalidManifest: UnifiedAgentManifest = {
      name: 123 as unknown as string,
      role: null as unknown as string,
      tier: "invalid-tier" as unknown as number,
      provider: ["valid", 456 as unknown as string],
      tools: {
        enable_subagent_tools: "not-bool" as unknown as boolean,
        enable_write_tools: 123 as unknown as boolean,
      },
      interface: {
        display_name: {} as unknown as string,
        short_description: [] as unknown as string,
      },
      permissions: {
        may: [123] as unknown as string[],
        must_not: "not-array" as unknown as string[],
        commands: [false] as unknown as string[],
        spawns: [null] as unknown as string[],
      },
      invariants: [123 as unknown as string],
      protocol: {
        cli: 999 as unknown as string,
        zero_json: "not-bool" as unknown as boolean,
      },
      instructions: 456 as unknown as string,
      communication_contract: {
        protocol: 123 as unknown as string,
        mailbox_path: 456 as unknown as string,
        lock_path: 789 as unknown as string,
        allowed_channels: [123] as unknown as string[],
        ban_raw_jsonl_reading: "not-bool" as unknown as boolean,
        forbid_native_messaging: "not-bool" as unknown as boolean,
      },
      mandatory_turn1_actions: [999 as unknown as string],
      dispatch_contract: 888 as unknown as string,
    };

    const invalidResult = validateUnifiedAgentManifest(invalidManifest);
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.errors.length).toBeGreaterThan(10);
  });

  test("parseYaml block scalar variations and advanced structures", () => {
    expect(parseYaml("")).toEqual({});
    expect(parseYaml("   \n\t  \n")).toEqual({});

    expect(parseYaml('{"jsonKey": 123}')).toEqual({ jsonKey: 123 });
    expect(parseYaml("[10, 20, 30]")).toEqual([10, 20, 30]);

    expect(parseYaml("single_scalar_value")).toBe("single_scalar_value");
    expect(parseYaml("42")).toBe(42);

    const listBlockScalar = `
items:
  - desc: |
      first line
      second line
  - name: item2
`;
    const parsedList = parseYaml(listBlockScalar) as {
      items: Array<{ desc?: string; name?: string }>;
    };
    expect(parsedList.items[0]?.desc).toContain("first line\nsecond line");
    expect(parsedList.items[1]?.name).toBe("item2");

    const listEmptyVal = `
items:
  - key1:
    nested: val
  - key2:
`;
    const parsedEmpty = parseYaml(listEmptyVal) as Record<string, unknown>;
    expect(parsedEmpty.items).toBeDefined();

    const foldedYaml = `
folded: >
  line one
  line two

  line three after blank
`;
    const parsedFolded = parseYaml(foldedYaml) as { folded: string };
    expect(parsedFolded.folded).toContain("line one line two\n\nline three after blank");

    const stripYaml = `
stripped: |-
  text without trailing newline
`;
    const parsedStrip = parseYaml(stripYaml) as { stripped: string };
    expect(parsedStrip.stripped).toBe("text without trailing newline");
  });
});
