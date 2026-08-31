import { describe, expect, test } from "bun:test";
import { parseYaml } from "../../../olt/scripts/src/authority/manifest/index.ts";

describe("Authority Manifest Parser - Advanced YAML Structures", () => {
  test("parses block sequences and flow arrays", () => {
    const yaml = `
block_list:
  - item 1
  - item 2
  - "item 3"
flow_list: [alpha, beta, gamma]
empty_flow: []
`;
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect(parsed.block_list).toEqual(["item 1", "item 2", "item 3"]);
    expect(parsed.flow_list).toEqual(["alpha", "beta", "gamma"]);
    expect(parsed.empty_flow).toEqual([]);
  });

  test("parses nested block objects and flow mappings", () => {
    const yaml = `
interface:
  display_name: "Test Agent"
  tier: 2
  tools:
    enable_subagent_tools: true
    enable_write_tools: false
flow_obj: { key1: "val1", key2: 123 }
`;
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    const iface = parsed.interface as Record<string, unknown>;
    expect(iface.display_name).toBe("Test Agent");
    expect(iface.tier).toBe(2);
    const tools = iface.tools as Record<string, unknown>;
    expect(tools.enable_subagent_tools).toBe(true);
    expect(tools.enable_write_tools).toBe(false);
    expect(parsed.flow_obj).toEqual({ key1: "val1", key2: 123 });
  });

  test("parses multiline block scalars with | and >", () => {
    const yaml = `
literal_block: |
  Line 1
  Line 2
  Line 3
folded_block: >
  This is a
  folded sentence.
`;
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect(typeof parsed.literal_block).toBe("string");
    expect(parsed.literal_block as string).toContain("Line 1\nLine 2\nLine 3");
    expect(typeof parsed.folded_block).toBe("string");
    expect(parsed.folded_block as string).toContain("This is a folded sentence.");
  });
});
