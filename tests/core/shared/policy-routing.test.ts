import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface DefectRoutingConfig {
  readonly skill_home_repo_root: string;
  readonly global_skill_dir: string;
  readonly dual_write_enabled: boolean;
}

export interface PolicyWithDefectRouting {
  readonly schema_version: number;
  readonly ecosystem: string;
  readonly package_manager?: string;
  readonly skill_home_repo_root?: string;
  readonly defect_routing?: DefectRoutingConfig;
  readonly [key: string]: unknown;
}

export function isDefectRoutingConfig(candidate: unknown): candidate is DefectRoutingConfig {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return false;
  }
  const obj = candidate as Record<string, unknown>;
  return (
    typeof obj["skill_home_repo_root"] === "string" &&
    obj["skill_home_repo_root"].trim().length > 0 &&
    typeof obj["global_skill_dir"] === "string" &&
    obj["global_skill_dir"].trim().length > 0 &&
    typeof obj["dual_write_enabled"] === "boolean"
  );
}

export function getDefaultDefectRoutingConfig(): DefectRoutingConfig {
  return {
    skill_home_repo_root: "/Users/onurseckinsenoglu/repos/skills",
    global_skill_dir: "~/.agents/skills/olt",
    dual_write_enabled: true,
  };
}

export function resolveDefectRoutingFromCandidates(
  candidatePaths: readonly string[],
): DefectRoutingConfig | null {
  for (const candidatePath of candidatePaths) {
    if (!existsSync(candidatePath)) continue;
    try {
      const content = readFileSync(candidatePath, "utf-8");
      const parsed = JSON.parse(content) as PolicyWithDefectRouting;
      if (parsed.defect_routing && isDefectRoutingConfig(parsed.defect_routing)) {
        return parsed.defect_routing;
      }
    } catch {
      // Ignore parse errors and check next candidate
    }
  }
  return null;
}

describe("Policy Defect Routing Configuration", () => {
  const repoRoot = resolve(import.meta.dir, "../../../");
  const oltPolicyPath = resolve(repoRoot, "olt/policy.json");
  const dotOltPolicyPath = resolve(repoRoot, ".olt/policy.json");

  describe("olt/policy.json configuration", () => {
    it("exists and contains valid JSON", () => {
      expect(existsSync(oltPolicyPath)).toBe(true);
      const content = readFileSync(oltPolicyPath, "utf-8");
      const parsed: unknown = JSON.parse(content);
      expect(typeof parsed).toBe("object");
      expect(parsed).not.toBeNull();
    });

    it("defines valid defect_routing structure and canonical values", () => {
      const content = readFileSync(oltPolicyPath, "utf-8");
      const parsed = JSON.parse(content) as PolicyWithDefectRouting;

      expect(parsed.defect_routing).toBeDefined();
      expect(isDefectRoutingConfig(parsed.defect_routing)).toBe(true);

      const routing = parsed.defect_routing as DefectRoutingConfig;
      expect(routing.skill_home_repo_root).toBe("/Users/onurseckinsenoglu/repos/skills");
      expect(routing.global_skill_dir).toBe("~/.agents/skills/olt");
      expect(routing.dual_write_enabled).toBe(true);
    });

    it("preserves root-level policy schema invariants", () => {
      const content = readFileSync(oltPolicyPath, "utf-8");
      const parsed = JSON.parse(content) as PolicyWithDefectRouting;

      expect(parsed.schema_version).toBe(1);
      expect(parsed.ecosystem).toBe("bun");
      expect(parsed.package_manager).toBe("bun");
      expect(parsed.skill_home_repo_root).toBe("/Users/onurseckinsenoglu/repos/skills");
    });
  });

  describe("Candidate policy resolution with fallback", () => {
    it("resolves active policy defect_routing from candidate chain", () => {
      const candidates = [dotOltPolicyPath, oltPolicyPath];
      const resolved = resolveDefectRoutingFromCandidates(candidates);

      expect(resolved).not.toBeNull();
      expect(resolved?.skill_home_repo_root).toBe("/Users/onurseckinsenoglu/repos/skills");
      expect(resolved?.global_skill_dir).toBe("~/.agents/skills/olt");
      expect(resolved?.dual_write_enabled).toBe(true);
    });

    it("validates defect_routing in .olt/policy.json when present", () => {
      if (existsSync(dotOltPolicyPath)) {
        const content = readFileSync(dotOltPolicyPath, "utf-8");
        const parsed = JSON.parse(content) as PolicyWithDefectRouting;
        if (parsed.defect_routing !== undefined) {
          expect(isDefectRoutingConfig(parsed.defect_routing)).toBe(true);
          expect(parsed.defect_routing.skill_home_repo_root).toBe(
            "/Users/onurseckinsenoglu/repos/skills",
          );
          expect(parsed.defect_routing.global_skill_dir).toBe("~/.agents/skills/olt");
          expect(parsed.defect_routing.dual_write_enabled).toBe(true);
        }
      }
    });
  });

  describe("DefectRoutingConfig validation and defaults", () => {
    it("validates compliant defect routing structures", () => {
      const validConfig: unknown = {
        skill_home_repo_root: "/custom/path/skills",
        global_skill_dir: "/custom/global/dir",
        dual_write_enabled: false,
      };
      expect(isDefectRoutingConfig(validConfig)).toBe(true);
    });

    it("rejects non-object or incomplete configurations", () => {
      expect(isDefectRoutingConfig(null)).toBe(false);
      expect(isDefectRoutingConfig("string")).toBe(false);
      expect(isDefectRoutingConfig([])).toBe(false);
      expect(isDefectRoutingConfig({})).toBe(false);
      expect(
        isDefectRoutingConfig({
          skill_home_repo_root: "/path",
          global_skill_dir: "/global",
        }),
      ).toBe(false);
      expect(
        isDefectRoutingConfig({
          skill_home_repo_root: "",
          global_skill_dir: "/global",
          dual_write_enabled: true,
        }),
      ).toBe(false);
      expect(
        isDefectRoutingConfig({
          skill_home_repo_root: "/path",
          global_skill_dir: 123,
          dual_write_enabled: true,
        }),
      ).toBe(false);
      expect(
        isDefectRoutingConfig({
          skill_home_repo_root: "/path",
          global_skill_dir: "/global",
          dual_write_enabled: "true",
        }),
      ).toBe(false);
    });

    it("provides canonical default configuration", () => {
      const defaults = getDefaultDefectRoutingConfig();
      expect(defaults.skill_home_repo_root).toBe("/Users/onurseckinsenoglu/repos/skills");
      expect(defaults.global_skill_dir).toBe("~/.agents/skills/olt");
      expect(defaults.dual_write_enabled).toBe(true);
      expect(isDefectRoutingConfig(defaults)).toBe(true);
    });
  });
});
