import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { join } from "node:path";
import {
  awakenTier0Governance,
  createTier0AgentGrants,
  initializeGovernance,
} from "../../../olt/scripts/src/mind/governance/tier0-awakening.ts";
import {
  enableInMemorySessionStore,
  disableInMemorySessionStore,
} from "../../../olt/scripts/src/authority/session/paths.ts";
import {
  enableInMemoryAgentMetadata,
  disableInMemoryAgentMetadata,
} from "../../../olt/scripts/src/runtime/session.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Tier 0 Awakening & Repo Governance Suite (tier0-awakening.ts)", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  let testDir: string;
  let runDir: string;

  const writePkg = (name = "app") => {
    vfs.writeFileSync(
      join(testDir, "package.json"),
      JSON.stringify({ name, scripts: { test: "bun test" } }),
    );
  };

  beforeEach(() => {
    enableInMemorySessionStore();
    enableInMemoryAgentMetadata();
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    const id = `tier0-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    testDir = `/virtual/${id}-repo`;
    runDir = join(testDir, ".runs", "run-1");
    vfs.mkdirSync(testDir, { recursive: true });
    vfs.mkdirSync(join(testDir, ".git"), { recursive: true });
    vfs.mkdirSync(runDir, { recursive: true });
    vfs.chdir(testDir);
  });

  afterEach(() => {
    disableInMemorySessionStore();
    disableInMemoryAgentMetadata();
    session.cleanup();
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
      writePkg("pkg");
      vfs.writeFileSync(join(testDir, "bun.lockb"), "");

      const status = initializeGovernance({
        repoRoot: testDir,
        runRoot: runDir,
        mindId: "mind-init-test",
      });

      expect(status.ready).toBe(true);
      expect(vfs.existsSync(status.olt_dir)).toBe(true);
      expect(vfs.existsSync(status.policy_path)).toBe(true);
      expect(vfs.existsSync(status.backlog_path)).toBe(true);
      expect(vfs.existsSync(status.defects_path)).toBe(true);
      expect(vfs.existsSync(status.session_path)).toBe(true);
      const sessionData = JSON.parse(vfs.readFileSync(status.session_path, "utf8")) as {
        agent_id: string;
      };
      expect(sessionData.agent_id).toBe("mind-init-test");
    });

    it("preserves existing session, policy, and backlogs when already initialized", () => {
      const oltDir = join(testDir, ".olt");
      vfs.mkdirSync(oltDir, { recursive: true });
      const policy = {
        schema_version: 1,
        ecosystem: "node",
        test_runner: { default_command: "bun test" },
        allowed_commands: ["bun"],
      };
      vfs.writeFileSync(join(oltDir, "policy.json"), JSON.stringify(policy));
      vfs.writeFileSync(join(oltDir, "backlog.jsonl"), '{"id":"t1"}\n');
      vfs.writeFileSync(join(oltDir, "defects.jsonl"), '{"id":"d1"}\n');
      vfs.writeFileSync(
        join(testDir, ".session.json"),
        JSON.stringify({ agent_id: "pre-existing" }),
      );

      const status = initializeGovernance({
        repoRoot: testDir,
        runRoot: runDir,
        mindId: "mind-secondary",
      });

      expect(status.ready).toBe(true);
      expect(vfs.readFileSync(status.backlog_path, "utf8")).toBe('{"id":"t1"}\n');
      expect(vfs.readFileSync(status.defects_path, "utf8")).toBe('{"id":"d1"}\n');
      const sessionData = JSON.parse(vfs.readFileSync(status.session_path, "utf8")) as {
        agent_id: string;
      };
      expect(sessionData.agent_id).toBe("pre-existing");
    });
  });

  describe("awakenTier0Governance", () => {
    it("awakens tier 0 with testCommands=false (fast path) and syncs agent ledger", () => {
      writePkg();
      vfs.writeFileSync(join(testDir, "bun.lockb"), "");

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
      expect(vfs.existsSync(ledgerPath)).toBe(true);
      const lines = vfs.readFileSync(ledgerPath, "utf8").trim().split("\n");
      expect(lines).toHaveLength(3);
      expect(lines.map((l) => (JSON.parse(l) as { id: string }).id)).toEqual([
        "mind-fast",
        "mind-fast-mind-auditor",
        "mind-fast-skill-auditor",
      ]);
    });

    it("supports overrideEcosystem option and empirical command testing", () => {
      vfs.writeFileSync(join(testDir, "requirements.txt"), "pytest\n");

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
      writePkg();

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
      writePkg();
      const initialJsonl =
        '{"id":"existing-agent","role":"worker"}\n\n{invalid json}\n{"id":"mind-merge","role":"mind"}\n';
      vfs.writeFileSync(join(runDir, "agents.jsonl"), initialJsonl);

      const res = awakenTier0Governance({
        repoRoot: testDir,
        runRoot: runDir,
        mindId: "mind-merge",
        testCommands: false,
      });

      expect(res.ready).toBe(true);
      const lines = vfs.readFileSync(join(runDir, "agents.jsonl"), "utf8").trim().split("\n");
      const ids = lines.map((l) => (JSON.parse(l) as { id: string }).id);
      expect(ids).toContain("existing-agent");
      expect(ids).toContain("mind-merge");
      expect(ids).toContain("mind-merge-mind-auditor");
      expect(ids).toContain("mind-merge-skill-auditor");
    });
  });

  describe("Advisory locking & safe atomic writes edge cases", () => {
    it("cleans up stale lock file (>10s old) and acquires lock", () => {
      writePkg();
      const lockPath = join(runDir, ".agents.lock");
      vfs.writeFileSync(lockPath, `99999:${Date.now() - 30000}`);

      const res = awakenTier0Governance({
        repoRoot: testDir,
        runRoot: runDir,
        mindId: "mind-stale-lock",
        testCommands: false,
      });

      expect(res.ready).toBe(true);
      expect(vfs.existsSync(join(runDir, "agents.jsonl"))).toBe(true);
    });

    it("cleans up lock file owned by dead process PID and acquires lock", () => {
      writePkg();
      const lockPath = join(runDir, ".agents.lock");
      vfs.writeFileSync(lockPath, `99999999:${Date.now()}`);

      const res = awakenTier0Governance({
        repoRoot: testDir,
        runRoot: runDir,
        mindId: "mind-dead-pid",
        testCommands: false,
      });

      expect(res.ready).toBe(true);
    });

    it("handles read error in advisory lock check and retries cleanly", () => {
      writePkg();
      const lockPath = join(runDir, ".agents.lock");
      vfs.writeFileSync(lockPath, "not-a-valid-pid-ts");

      const res = awakenTier0Governance({
        repoRoot: testDir,
        runRoot: runDir,
        mindId: "mind-bad-lock",
        testCommands: false,
      });
      expect(res.ready).toBe(true);
    });

    it("falls back to direct writeFileSync when renameSync fails in safeAtomicWrite", () => {
      writePkg();

      const origStat = vfs.statSync.bind(vfs);
      const statSpy = spyOn(vfs, "statSync").mockImplementation((p, opts) => {
        if (String(p).includes("agents.jsonl.tmp.")) {
          throw new Error("Simulated rename failure");
        }
        return origStat(p, opts);
      });

      try {
        const res = awakenTier0Governance({
          repoRoot: testDir,
          runRoot: runDir,
          mindId: "mind-rename-fallback",
          testCommands: false,
        });
        expect(res.ready).toBe(true);
        expect(vfs.existsSync(join(runDir, "agents.jsonl"))).toBe(true);
      } finally {
        statSpy.mockRestore();
      }
    });

    it("catches errors silently if syncAgentLedger throws inside awakenTier0Governance", () => {
      writePkg();

      const badRunDir = join(testDir, "bad-run-file");
      vfs.writeFileSync(badRunDir, "not a directory");

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
