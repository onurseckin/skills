import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  awakenTier0Governance,
  createTier0AgentGrants,
  initializeGovernance,
} from "../../../olt/scripts/src/mind/governance/tier0-awakening.ts";

describe("Tier 0 Awakening & Repo Governance Suite (tier0-awakening.ts)", () => {
  let testDir: string;
  let runDir: string;

  beforeEach(() => {
    const id = `tier0-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    testDir = join(tmpdir(), `${id}-repo`);
    runDir = join(testDir, ".runs", "run-1");
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, ".git"), { recursive: true });
    mkdirSync(runDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  describe("createTier0AgentGrants", () => {
    it("creates standard 3-agent grant set with default and custom options", () => {
      const def = createTier0AgentGrants("mind-alpha");
      expect(def).toHaveLength(3);
      expect(def[0]).toMatchObject({ id: "mind-alpha", role: "mind", host: "initialization" });
      expect(def[1]).toMatchObject({ id: "mind-alpha-mind-auditor", role: "mind-auditor" });
      expect(def[2]).toMatchObject({ id: "mind-alpha-skill-auditor", role: "skill-auditor" });

      const custom = createTier0AgentGrants("mind-beta", {
        host: "custom-host",
        now: "2026-09-01T12:00:00.000Z",
      });
      expect(custom).toHaveLength(3);
      expect(custom[0].host).toBe("custom-host");
      expect(custom[0].granted_at).toBe("2026-09-01T12:00:00.000Z");
    });
  });

  describe("initializeGovernance", () => {
    it("bootstraps .olt, policy, backlogs, and session grant on fresh repo", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ name: "pkg", scripts: { test: "bun test" } }),
      );
      writeFileSync(join(testDir, "bun.lockb"), "");

      const status = initializeGovernance({
        repoRoot: testDir,
        runRoot: runDir,
        mindId: "mind-init-test",
      });

      expect(status.ready).toBe(true);
      expect(existsSync(status.olt_dir)).toBe(true);
      expect(existsSync(status.policy_path)).toBe(true);
      expect(existsSync(status.backlog_path)).toBe(true);
      expect(existsSync(status.defects_path)).toBe(true);
      expect(existsSync(status.session_path)).toBe(true);
      const session = JSON.parse(readFileSync(status.session_path, "utf8"));
      expect(session.agent_id).toBe("mind-init-test");
    });

    it("preserves existing session, policy, and backlogs when already initialized", () => {
      const oltDir = join(testDir, ".olt");
      mkdirSync(oltDir, { recursive: true });
      const policy = {
        schema_version: 1,
        ecosystem: "node",
        test_runner: { default_command: "bun test" },
        allowed_commands: ["bun"],
      };
      writeFileSync(join(oltDir, "policy.json"), JSON.stringify(policy));
      writeFileSync(join(oltDir, "backlog.jsonl"), '{"id":"t1"}\n');
      writeFileSync(join(oltDir, "defects.jsonl"), '{"id":"d1"}\n');
      writeFileSync(join(testDir, ".session.json"), JSON.stringify({ agent_id: "pre-existing" }));

      const status = initializeGovernance({
        repoRoot: testDir,
        runRoot: runDir,
        mindId: "mind-secondary",
      });

      expect(status.ready).toBe(true);
      expect(readFileSync(status.backlog_path, "utf8")).toBe('{"id":"t1"}\n');
      expect(readFileSync(status.defects_path, "utf8")).toBe('{"id":"d1"}\n');
      expect(JSON.parse(readFileSync(status.session_path, "utf8")).agent_id).toBe("pre-existing");
    });
  });

  describe("awakenTier0Governance", () => {
    it("awakens tier 0 with testCommands=false (fast path) and syncs agent ledger", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ name: "app", scripts: { test: "bun test" } }),
      );
      writeFileSync(join(testDir, "bun.lockb"), "");

      const res = awakenTier0Governance({
        repoRoot: testDir,
        runRoot: runDir,
        mindId: "mind-fast",
        testCommands: false,
      });

      expect(res.status).toBe("awakened");
      expect(res.ready).toBe(true);
      expect(res.awakenedAgents).toHaveLength(3);
      expect(res.empiricalReport.verifiedCommands).toEqual([]);

      const ledgerPath = join(runDir, "agents.jsonl");
      expect(existsSync(ledgerPath)).toBe(true);
      const lines = readFileSync(ledgerPath, "utf8").trim().split("\n");
      expect(lines).toHaveLength(3);
      expect(lines.map((l) => JSON.parse(l).id)).toEqual([
        "mind-fast",
        "mind-fast-mind-auditor",
        "mind-fast-skill-auditor",
      ]);
    });

    it("supports overrideEcosystem option and empirical command testing", () => {
      writeFileSync(join(testDir, "requirements.txt"), "pytest\n");

      const res = awakenTier0Governance({
        repoRoot: testDir,
        runRoot: runDir,
        mindId: "mind-py",
        overrideEcosystem: "python",
        testCommands: true,
      });

      expect(res.status).toBe("awakened");
      expect(res.policy.ecosystem).toBe("python");
      expect(res.governance.ready).toBe(true);
    });

    it("skips syncAgentLedger when runRoot is empty string", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ name: "app", scripts: { test: "bun test" } }),
      );

      const res = awakenTier0Governance({
        repoRoot: testDir,
        runRoot: "",
        mindId: "mind-norun",
        testCommands: false,
      });

      expect(res.status).toBe("awakened");
      expect(res.ready).toBe(true);
    });

    it("recovers gracefully from existing populated or malformed agents.jsonl", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ name: "app", scripts: { test: "bun test" } }),
      );
      const initialJsonl =
        '{"id":"existing-agent","role":"worker"}\n\n{invalid json}\n{"id":"mind-merge","role":"mind"}\n';
      writeFileSync(join(runDir, "agents.jsonl"), initialJsonl);

      const res = awakenTier0Governance({
        repoRoot: testDir,
        runRoot: runDir,
        mindId: "mind-merge",
        testCommands: false,
      });

      expect(res.ready).toBe(true);
      const lines = readFileSync(join(runDir, "agents.jsonl"), "utf8").trim().split("\n");
      const ids = lines.map((l) => JSON.parse(l).id);
      expect(ids).toContain("existing-agent");
      expect(ids).toContain("mind-merge");
      expect(ids).toContain("mind-merge-mind-auditor");
      expect(ids).toContain("mind-merge-skill-auditor");
    });
  });

  describe("Advisory locking & safe atomic writes edge cases", () => {
    it("cleans up stale lock file (>10s old) and acquires lock", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ name: "app", scripts: { test: "bun test" } }),
      );
      const lockPath = join(runDir, ".agents.lock");
      writeFileSync(lockPath, `99999:${Date.now() - 30000}`);

      const res = awakenTier0Governance({
        repoRoot: testDir,
        runRoot: runDir,
        mindId: "mind-stale-lock",
        testCommands: false,
      });

      expect(res.ready).toBe(true);
      expect(existsSync(join(runDir, "agents.jsonl"))).toBe(true);
    });

    it("cleans up lock file owned by dead process PID and acquires lock", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ name: "app", scripts: { test: "bun test" } }),
      );
      const lockPath = join(runDir, ".agents.lock");
      writeFileSync(lockPath, `99999999:${Date.now()}`);

      const res = awakenTier0Governance({
        repoRoot: testDir,
        runRoot: runDir,
        mindId: "mind-dead-pid",
        testCommands: false,
      });

      expect(res.ready).toBe(true);
    });

    it("handles read error in advisory lock check and retries cleanly", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ name: "app", scripts: { test: "bun test" } }),
      );
      const lockPath = join(runDir, ".agents.lock");
      writeFileSync(lockPath, "not-a-valid-pid-ts");

      const res = awakenTier0Governance({
        repoRoot: testDir,
        runRoot: runDir,
        mindId: "mind-bad-lock",
        testCommands: false,
      });
      expect(res.ready).toBe(true);
    });

    it("falls back to direct writeFileSync when renameSync fails in safeAtomicWrite", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ name: "app", scripts: { test: "bun test" } }),
      );

      const originalRename = fs.renameSync;
      const renameSpy = spyOn(fs, "renameSync").mockImplementation((oldPath, newPath) => {
        if (String(oldPath).includes("agents.jsonl.tmp.")) {
          throw new Error("Simulated rename failure");
        }
        return originalRename(oldPath, newPath);
      });

      try {
        const res = awakenTier0Governance({
          repoRoot: testDir,
          runRoot: runDir,
          mindId: "mind-rename-fallback",
          testCommands: false,
        });
        expect(res.ready).toBe(true);
        expect(existsSync(join(runDir, "agents.jsonl"))).toBe(true);
      } finally {
        renameSpy.mockRestore();
      }
    });

    it("catches errors silently if syncAgentLedger throws inside awakenTier0Governance", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ name: "app", scripts: { test: "bun test" } }),
      );

      const badRunDir = join(testDir, "bad-run-file");
      writeFileSync(badRunDir, "not a directory");

      const res = awakenTier0Governance({
        repoRoot: testDir,
        runRoot: badRunDir,
        mindId: "mind-err-run",
        testCommands: false,
      });

      expect(res.status).toBe("awakened");
      expect(res.ready).toBe(true);
    });
  });
});
