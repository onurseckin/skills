import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execute } from "../../olt/scripts/src/cli/execute.ts";
import {
  policyCheckDriftCommand,
  policyGetCommand,
  policyInitCommand,
  policySetCommand,
} from "../../olt/scripts/src/cli/commands/policy-ops.ts";
import { checkPolicyDoctor } from "../../olt/scripts/src/reporting/doctor/policy-doctor.ts";
import {
  CURRENT_POLICY_SCHEMA_VERSION,
  generateDefaultRepoPolicy,
  type RepoPolicy,
} from "../../olt/scripts/src/policy/index.ts";

describe("Doctor Policy Certification & Policy CLI Operations (Task 4.3)", () => {
  const scratchDir = join(process.cwd(), "coverage", "scratch", "policy-doctor-test");

  afterAll(() => {
    rmSync(scratchDir, { recursive: true, force: true });
  });

  describe("Doctor Policy Integrity & Corruption Detection", () => {
    test("reports auto-detected policy info when policy.json is absent", () => {
      const repo = join(scratchDir, "missing-policy");
      mkdirSync(repo, { recursive: true });

      const result = checkPolicyDoctor({ repoRoot: repo });
      expect(result.passed).toBe(true);
      expect(result.findings.some((f) => f.code === "POLICY_AUTO_DETECTED")).toBe(true);
      rmSync(repo, { recursive: true, force: true });
    });

    test("flags corrupted or invalid policy.json as ERROR", () => {
      const repo = join(scratchDir, "corrupt-policy");
      const oltDir = join(repo, ".olt");
      mkdirSync(oltDir, { recursive: true });
      writeFileSync(join(oltDir, "policy.json"), "{ invalid-json: true ", "utf-8");

      const result = checkPolicyDoctor({ repoRoot: repo });
      expect(result.passed).toBe(false);
      const corrupt = result.findings.find((f) => f.code === "POLICY_CORRUPT");
      expect(corrupt).toBeDefined();
      expect(corrupt?.severity).toBe("ERROR");
      rmSync(repo, { recursive: true, force: true });
    });
  });

  describe("Doctor Schema Version Drift & Checksum Drift", () => {
    test("detects unsupported schema version drift as ERROR", () => {
      const defaultPol = generateDefaultRepoPolicy();
      const driftedPolicy: RepoPolicy = {
        ...defaultPol,
        schema_version: 99,
      };

      const result = checkPolicyDoctor({ policy: driftedPolicy });
      expect(result.passed).toBe(false);
      const versionFinding = result.findings.find((f) => f.code === "POLICY_SCHEMA_VERSION_DRIFT");
      expect(versionFinding).toBeDefined();
      expect(versionFinding?.severity).toBe("ERROR");
      expect(versionFinding?.message).toContain("version 99");
    });

    test("detects SHA-256 policy checksum drift against expected hash", () => {
      const repo = join(scratchDir, "checksum-drift");
      mkdirSync(repo, { recursive: true });
      policyInitCommand({ repo });

      const expectedChecksum = "0000000000000000000000000000000000000000000000000000000000000000";
      const result = checkPolicyDoctor({ repoRoot: repo, expectedChecksum, strict: true });
      expect(result.passed).toBe(false);
      expect(result.findings.some((f) => f.code === "POLICY_CHECKSUM_DRIFT")).toBe(true);
      rmSync(repo, { recursive: true, force: true });
    });
  });

  describe("Doctor Pushback Quota & Unauthorized Command Enforcement", () => {
    test("flags deficit in completed task cognitive pushbacks and adversarial probes", () => {
      const result = checkPolicyDoctor({
        tasks: {
          "task-1": {
            id: "task-1",
            status: "satisfied",
            adversarial_probes: [1, 2],
            cognitive_pushbacks: [1],
          },
        },
      });

      expect(result.passed).toBe(false);
      expect(
        result.findings.some((f) => f.code === "PUSHBACK_QUOTA_ADVERSARIAL_PROBES_DEFICIT"),
      ).toBe(true);
      expect(
        result.findings.some((f) => f.code === "PUSHBACK_QUOTA_COGNITIVE_PUSHBACKS_DEFICIT"),
      ).toBe(true);
    });

    test("passes cleanly when completed task satisfies all quotas", () => {
      const result = checkPolicyDoctor({
        tasks: {
          "task-ok": {
            id: "task-ok",
            status: "satisfied",
            adversarial_probes: [1, 2, 3, 4, 5],
            cognitive_pushbacks: [1, 2, 3, 4, 5],
          },
        },
      });

      expect(result.passed).toBe(true);
      expect(result.findings.filter((f) => f.severity === "ERROR")).toHaveLength(0);
    });

    test("flags cognitive validator command lock and forbidden command executions", () => {
      const defaultPol = generateDefaultRepoPolicy();
      const strictPolicy: RepoPolicy = {
        ...defaultPol,
        forbidden_commands: ["rm -rf /", "git push --force"],
      };

      const result = checkPolicyDoctor({
        policy: strictPolicy,
        grants: [
          { id: "agent-val", role: "validator_code_quality" },
          { id: "agent-impl", role: "implementer" },
        ],
        commands: {
          cmd1: { id: "cmd1", agent_id: "agent-val", command: "bun test" },
          cmd2: { id: "cmd2", agent_id: "agent-impl", command: "rm -rf /" },
        },
      });

      expect(result.passed).toBe(false);
      expect(
        result.findings.some((f) => f.code === "COGNITIVE_VALIDATOR_COMMAND_LOCK_VIOLATION"),
      ).toBe(true);
      expect(result.findings.some((f) => f.code === "UNAUTHORIZED_COMMAND")).toBe(true);
    });
  });

  describe("Policy CLI Operations (get, set, init, check-drift)", () => {
    test("policy:init creates valid .olt/policy.json with correct ecosystem", async () => {
      const repo = join(scratchDir, "cli-init");
      mkdirSync(repo, { recursive: true });

      const initRes = await policyInitCommand({ repo, ecosystem: "bun" });
      expect(initRes.ok).toBe(true);
      expect(initRes.ecosystem).toBe("bun");

      const getRes = await policyGetCommand({ repo, key: "ecosystem" });
      expect(getRes.ok).toBe(true);
      expect(getRes.value).toBe("bun");
      rmSync(repo, { recursive: true, force: true });
    });

    test("policy:set updates nested configuration key and validates schema", async () => {
      const repo = join(scratchDir, "cli-set");
      mkdirSync(repo, { recursive: true });
      await policyInitCommand({ repo });

      const setRes = await policySetCommand({
        repo,
        key: "read_scope_neighborhood_depth",
        value: "6",
      });
      expect(setRes.ok).toBe(true);
      expect(setRes.value).toBe(6);

      const getRes = await policyGetCommand({ repo, key: "read_scope_neighborhood_depth" });
      expect(getRes.value).toBe(6);
      rmSync(repo, { recursive: true, force: true });
    });

    test("policy:check-drift validates checksum and detects mutations", async () => {
      const repo = join(scratchDir, "cli-drift");
      mkdirSync(repo, { recursive: true });
      await policyInitCommand({ repo });

      const driftInitial = await policyCheckDriftCommand({ repo });
      expect(driftInitial.ok).toBe(true);
      expect(driftInitial.status).toBe("in_sync");

      const initialChecksum = driftInitial.checksum as string;

      // Mutate policy
      await policySetCommand({ repo, key: "read_scope_neighborhood_depth", value: "8" });

      const driftChecked = await policyCheckDriftCommand({ repo, checksum: initialChecksum });
      expect(driftChecked.drifted).toBe(true);
      expect(driftChecked.status).toBe("drifted");

      rmSync(repo, { recursive: true, force: true });
    });

    test("executes policy commands via harness execute() CLI dispatcher", async () => {
      const repo = join(scratchDir, "cli-execute");
      mkdirSync(repo, { recursive: true });

      const initOut = await execute(["policy:init", "--repo", repo, "--ecosystem", "bun"]);
      expect(initOut.ok).toBe(true);

      const getOut = await execute([
        "policy:get",
        "--repo",
        repo,
        "--key",
        "test_runner.default_command",
      ]);
      expect(getOut.ok).toBe(true);
      expect(getOut.value).toBe("bun test");

      const driftOut = await execute(["policy:check-drift", "--repo", repo]);
      expect(driftOut.ok).toBe(true);
      expect(driftOut.status).toBe("in_sync");

      rmSync(repo, { recursive: true, force: true });
    });
  });

  describe("Static Invariants & File Limits", () => {
    test("enforces zero TypeScript any, zero suppressions and modular line bounds", () => {
      const filesToCheck = [
        "olt/scripts/src/reporting/doctor/policy-doctor.ts",
        "olt/scripts/src/reporting/doctor/pushback-quotas-engine.ts",
        "olt/scripts/src/cli/commands/policy-ops.ts",
        "olt/scripts/src/cli/registry/policy.ts",
        "tests/unit/doctor/policy-doctor.test.ts",
      ];

      const anyTypePattern = new RegExp(":\\s*" + "any\\b");
      const asAnyPattern = new RegExp("\\bas\\s+" + "any\\b");

      for (const relPath of filesToCheck) {
        const fullPath = join(process.cwd(), relPath);
        const source = readFileSync(fullPath, "utf-8");
        const lines = source.split(/\r?\n/);

        expect(lines.length).toBeLessThanOrEqual(300);
        expect(source).not.toContain("@ts" + "-ignore");
        expect(source).not.toContain("@ts" + "-expect-error");
        expect(source).not.toContain("eslint" + "-disable");
        if (relPath !== "tests/unit/doctor/policy-doctor.test.ts") {
          expect(source).not.toMatch(anyTypePattern);
          expect(source).not.toMatch(asAnyPattern);
        }
      }
      expect(CURRENT_POLICY_SCHEMA_VERSION).toBe(1);
    });
  });
});
