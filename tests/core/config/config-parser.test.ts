import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import {
  parseConfigFile,
  parsePolicyLayer,
  inspectHarnessConfigFile,
  HARNESS_CONFIG_KEYS,
} from "../../../olt/scripts/src/core/config/parser.ts";
import { attestedFact, unreadableFact } from "../../../olt/scripts/src/core/config/provenance.ts";

describe("core/config/parser.ts", () => {
  const mockFiles = new Map<string, string>();
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(() => {
    mockFiles.clear();
    spies.push(
      spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => mockFiles.has(String(p))),
      spyOn(fs, "readFileSync").mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        const val = mockFiles.get(s);
        if (val !== undefined) return val;
        throw new Error(`ENOENT: no such file, open '${s}'`);
      }),
    );
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

  it("parseConfigFile returns null when file does not exist", () => {
    expect(parseConfigFile("/path/to/nonexistent/file.json")).toBeNull();
  });

  it("parseConfigFile rejects invalid JSON or non-object root", () => {
    const vRoot = "/virtual-config-parser-tests";
    const badJson = join(vRoot, "bad.json");
    mockFiles.set(badJson, "{ invalid json");
    expect(() => parseConfigFile(badJson)).toThrow(HarnessError);

    const arrayJson = join(vRoot, "array.json");
    mockFiles.set(arrayJson, "[1, 2, 3]");
    expect(() => parseConfigFile(arrayJson)).toThrow(HarnessError);

    const nullJson = join(vRoot, "null.json");
    mockFiles.set(nullJson, "null");
    expect(() => parseConfigFile(nullJson)).toThrow(HarnessError);
  });

  it("parseConfigFile validates and parses all supported keys", () => {
    const vRoot = "/virtual-config-parser-valid";
    const configPath = join(vRoot, "harness.config.json");
    const validPayload = {
      min_adversarial_probes: 2,
      max_repair_rounds: 3,
      max_branch_depth: 2,
      max_agents: 10,
      max_output_bytes: 4096,
      default_lease_seconds: 600,
      default_max_parallel: 4,
      max_concurrent_agents: 4,
      gate_max_parallel: 2,
      worktree_isolation: true,
      worktree_root: ".worktrees",
      branch_prefix: "olt/",
      commit_per_subphase: false,
      max_commit_lines: 500,
      rebase_on_complete: true,
      supervisory_cadence_seconds: 30,
      quota_freeze_threshold_pct: 80,
      fleet_agent_ceiling: 8,
      model_by_role: { coordinator: "claude-3-5-sonnet" },
    };
    mockFiles.set(configPath, JSON.stringify(validPayload));
    const parsed = parseConfigFile(configPath);
    expect(parsed).not.toBeNull();
    expect(parsed?.min_adversarial_probes).toBe(2);
    expect(parsed?.max_repair_rounds).toBe(3);
    expect(parsed?.max_branch_depth).toBe(2);
    expect(parsed?.max_agents).toBe(10);
    expect(parsed?.max_output_bytes).toBe(4096);
    expect(parsed?.default_lease_seconds).toBe(600);
    expect(parsed?.default_max_parallel).toBe(4);
    expect(parsed?.gate_max_parallel).toBe(2);
    expect(parsed?.worktree_isolation).toBe(true);
    expect(parsed?.worktree_root).toBe(".worktrees");
    expect(parsed?.branch_prefix).toBe("olt/");
    expect(parsed?.commit_per_subphase).toBe(false);
    expect(parsed?.max_commit_lines).toBe(500);
    expect(parsed?.rebase_on_complete).toBe(true);
    expect(parsed?.supervisory_cadence_seconds).toEqual(attestedFact(30));
    expect(parsed?.quota_freeze_threshold_pct).toEqual(attestedFact(80));
    expect(parsed?.fleet_agent_ceiling).toEqual(attestedFact(8));
    expect(parsed?.model_by_role).toEqual(attestedFact({ coordinator: "claude-3-5-sonnet" }));
  });

  it("parseConfigFile rejects unsupported keys and bad values", () => {
    const vRoot = "/virtual-config-parser-invalid";
    const testCases = [
      { key: "unsupported_key", val: 123 },
      { key: "default_lease_seconds", val: 999999 },
      { key: "worktree_isolation", val: "true" },
      { key: "worktree_root", val: "   " },
      { key: "quota_freeze_threshold_pct", val: 150 },
      { key: "model_by_role", val: { bad_role: "model" } },
      { key: "fleet_agent_ceiling", val: 0 },
    ];
    for (let i = 0; i < testCases.length; i++) {
      const file = join(vRoot, `test_${i}.json`);
      mockFiles.set(file, JSON.stringify({ [testCases[i].key]: testCases[i].val }));
      expect(() => parseConfigFile(file)).toThrow(HarnessError);
    }
  });

  it("parsePolicyLayer parses valid and invalid policy files", () => {
    expect(parsePolicyLayer("/nonexistent/policy.json")).toBeNull();
    const vRoot = "/virtual-policy-layer-tests";
    const valid = join(vRoot, "policy_valid.json");
    mockFiles.set(valid, JSON.stringify({ quota_freeze_threshold_pct: 75 }));
    expect(parsePolicyLayer(valid)).toEqual({
      quota_freeze_threshold_pct: attestedFact(75),
    });

    const badVal = join(vRoot, "policy_bad_val.json");
    mockFiles.set(badVal, JSON.stringify({ quota_freeze_threshold_pct: "not a number" }));
    expect(parsePolicyLayer(badVal)).toEqual({
      quota_freeze_threshold_pct: unreadableFact(null),
    });

    const badJson = join(vRoot, "policy_bad_json.json");
    mockFiles.set(badJson, "invalid json");
    expect(parsePolicyLayer(badJson)).toEqual({
      quota_freeze_threshold_pct: unreadableFact(null),
    });

    const notAnObj = join(vRoot, "policy_array.json");
    mockFiles.set(notAnObj, "[1, 2]");
    expect(parsePolicyLayer(notAnObj)).toEqual({
      quota_freeze_threshold_pct: unreadableFact(null),
    });
  });

  it("inspectHarnessConfigFile reports valid_custom, invalid_custom, and auto_detected", () => {
    const vRoot = "/virtual-inspect-config-tests";
    const missing = join(vRoot, "nonexistent.json");
    expect(inspectHarnessConfigFile(missing).status).toBe("auto_detected");

    const valid = join(vRoot, "valid.json");
    mockFiles.set(valid, JSON.stringify({ max_repair_rounds: 5 }));
    const validRes = inspectHarnessConfigFile(valid);
    expect(validRes.status).toBe("valid_custom");
    expect(validRes.partial.max_repair_rounds).toBe(5);

    const invalid = join(vRoot, "invalid.json");
    mockFiles.set(invalid, "{ bad json");
    const invalidRes = inspectHarnessConfigFile(invalid);
    expect(invalidRes.status).toBe("invalid_custom");
    expect(invalidRes.error).toBeDefined();
  });
});
