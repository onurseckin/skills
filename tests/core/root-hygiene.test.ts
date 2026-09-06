import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RootDirectoryHygieneGuard } from "../../olt/scripts/src/authority/guards/index.ts";
import { VerbatimRoleInjector } from "../../olt/scripts/src/authority/verbatim-role-injector.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import { resolvePolicyPath } from "../../olt/scripts/src/core/index.ts";
import { resolveAgentsDirectory } from "../../olt/scripts/src/reporting/doctor/agent-canonical-engine.ts";

describe("Root Directory Hygiene Invariants (.olt vs olt)", () => {
  it("resolves policy path strictly to .olt/policy.json in consumer repos", () => {
    const testDir = join(
      tmpdir(),
      `test-hygiene-policy-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    try {
      mkdirSync(testDir, { recursive: true });
      const policyPath = resolvePolicyPath(testDir);
      expect(policyPath).toBe(join(testDir, ".olt", "policy.json"));
      expect(policyPath.includes("/olt/")).toBe(false);
    } finally {
      rmSync(testDir, { force: true, recursive: true });
    }
  });

  it("prefers .olt/agents over olt/agents in consumer repos", () => {
    const testDir = join(
      tmpdir(),
      `test-hygiene-agents-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    try {
      const dotOltAgents = join(testDir, ".olt", "agents");
      mkdirSync(dotOltAgents, { recursive: true });

      const resolved = resolveAgentsDirectory(testDir);
      expect(resolved).toBe(dotOltAgents);
    } finally {
      rmSync(testDir, { force: true, recursive: true });
    }
  });

  it("resolves manifest path from .olt/agents when present", () => {
    const testDir = join(
      tmpdir(),
      `test-hygiene-manifest-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    try {
      const dotOltAgents = join(testDir, ".olt", "agents");
      mkdirSync(dotOltAgents, { recursive: true });
      const manifestPath = join(dotOltAgents, "implementer.yaml");
      writeFileSync(manifestPath, "role: implementer\ntier: 3\n");

      const resolved = VerbatimRoleInjector.resolveManifestPath(testDir, "implementer");
      expect(resolved).toBe(manifestPath);
      expect(resolved.includes("/.olt/agents/")).toBe(true);
    } finally {
      rmSync(testDir, { force: true, recursive: true });
    }
  });

  it("blocks writing unapproved runtime artifacts in root or unhidden olt directory", () => {
    const testDir = join(
      tmpdir(),
      `test-hygiene-guard-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    try {
      mkdirSync(testDir, { recursive: true });

      // Unhidden olt/ defects or runtime files must be rejected
      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath(
          testDir,
          join(testDir, "olt", "defects.jsonl"),
        );
      }).toThrow(HarnessError);

      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath(testDir, join(testDir, "fix-script.ts"));
      }).toThrow(HarnessError);

      // Allowed .olt paths must succeed
      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath(
          testDir,
          join(testDir, ".olt", "scratch", "fix.ts"),
        );
      }).not.toThrow();

      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath(
          testDir,
          join(testDir, ".olt", "capsules", "run-1", "state.json"),
        );
      }).not.toThrow();
    } finally {
      rmSync(testDir, { force: true, recursive: true });
    }
  });
});
