import { describe, expect, test } from "bun:test";
import { loadRoleContract } from "../../../olt/scripts/src/authority/manifest/index.ts";
import { parseUnifiedAgentManifest } from "../../../olt/scripts/src/authority/manifest-schema.ts";

describe("Authority Manifest Parser - Error Handling & Fallbacks", () => {
  test("throws on invalid YAML or non-object documents", () => {
    expect(() => parseUnifiedAgentManifest("just a plain string")).toThrow(
      "YAML document must be an object",
    );
    expect(() => parseUnifiedAgentManifest("- item1\n- item2")).toThrow(
      "YAML document must be an object",
    );
  });

  test("generates synthetic fallback contract for missing roles", () => {
    const synthetic = loadRoleContract("custom-mock-role");
    expect(synthetic.role).toBe("custom-mock-role");
    expect(synthetic.tier).toBe(3);
    expect(synthetic.may.length).toBeGreaterThan(0);
    expect(synthetic.mustNot.length).toBeGreaterThan(0);
  });
});
