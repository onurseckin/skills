import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  SplitChannelDefectRouter,
  expandHomeDir,
  resolveDefectRoutingPolicy,
} from "../../olt/scripts/src/reporting/split-channel-defect-router.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("SplitChannelDefectRouter Policy & Dual-Write", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | null = null;
  let dirCounter = 0;

  function normPath(p: string): string {
    return p.replace(/\\/g, "/");
  }

  function makeTempDir(prefix: string): string {
    const dir = `/virtual/test-split-router/${prefix}-${++dirCounter}`;
    vfs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  beforeEach(() => {
    if (session) {
      session.cleanup();
      session = null;
    }
    vfs = new VirtualMemoryFS();
    vfs.mkdirSync(normPath(process.cwd()), { recursive: true });
    vfs.mkdirSync("/virtual/test-split-router", { recursive: true });
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    if (session) {
      session.cleanup();
      session = null;
    }
  });

  test("expands tilde paths to user home directory", () => {
    expect(expandHomeDir("~")).toBe(homedir());
    expect(expandHomeDir("~/.agents/skills/olt")).toBe(join(homedir(), ".agents", "skills", "olt"));
    expect(expandHomeDir("/var/log")).toBe("/var/log");
  });

  test("routes defect to local target defects ledger without dual write", () => {
    const localRepo = makeTempDir("local-only");
    const result = SplitChannelDefectRouter.routeDefect({
      currentRepoRoot: localRepo,
      domain: "project",
      defect: {
        id: "defect-local-1",
        error_code: "TEST_ERR_LOCAL",
        title: "Local Error Title",
        description: "Local Error Description",
        actor: "tester",
        timestamp: "2026-09-06T12:00:00.000Z",
      },
      routingPolicy: {
        dual_write_enabled: false,
      },
    });

    expect(result.routed).toBe(true);
    expect(result.isMothership).toBe(false);
    expect(result.targetRepoRoot).toBe(resolve(localRepo));
    expect(result.dualWriteEnabled).toBe(false);

    const targetDefectsFile = join(localRepo, ".olt", "defects.jsonl");
    expect(vfs.existsSync(targetDefectsFile)).toBe(true);

    const raw = vfs.readFileSync(targetDefectsFile, "utf-8").trim();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed["id"]).toBe("defect-local-1");
    expect(parsed["error_code"]).toBe("TEST_ERR_LOCAL");
    expect(parsed["title"]).toBe("Local Error Title");
    expect(parsed["description"]).toBe("Local Error Description");
    expect(parsed["actor"]).toBe("tester");
    expect(parsed["source_repo"]).toBe(resolve(localRepo));
    expect(parsed["timestamp"]).toBe("2026-09-06T12:00:00.000Z");
  });

  test("forwards defect records to skill_home and global_skill_dir on dual_write_enabled", () => {
    const localRepo = makeTempDir("local-dw");
    const skillHome = makeTempDir("skill-home");
    const globalSkill = makeTempDir("global-skill");

    const result = SplitChannelDefectRouter.routeDefect({
      currentRepoRoot: localRepo,
      domain: "project",
      defect: {
        id: "defect-dw-1",
        error_code: "ERR_DUAL_WRITE",
        title: "Dual Write Defect",
        description: "Verifying forwarding across repos",
        actor: "implementer_task3",
      },
      routingPolicy: {
        skill_home_repo_root: skillHome,
        global_skill_dir: globalSkill,
        dual_write_enabled: true,
      },
    });

    expect(result.routed).toBe(true);
    expect(result.dualWriteEnabled).toBe(true);

    const localDefectsFile = join(localRepo, ".olt", "defects.jsonl");
    const skillHomeDefectsFile = join(skillHome, ".olt", "defects.jsonl");
    const globalDefectsFile = join(globalSkill, ".olt", "defects.jsonl");

    expect(vfs.existsSync(localDefectsFile)).toBe(true);
    expect(vfs.existsSync(skillHomeDefectsFile)).toBe(true);
    expect(vfs.existsSync(globalDefectsFile)).toBe(true);

    const skillHomeRaw = vfs.readFileSync(skillHomeDefectsFile, "utf-8").trim();
    const skillHomeRecord = JSON.parse(skillHomeRaw) as Record<string, unknown>;
    expect(skillHomeRecord["id"]).toBe("defect-dw-1");
    expect(skillHomeRecord["source_repo"]).toBe(resolve(localRepo));
    expect(typeof skillHomeRecord["timestamp"]).toBe("string");
    expect(skillHomeRecord["error_code"]).toBe("ERR_DUAL_WRITE");

    const globalRaw = vfs.readFileSync(globalDefectsFile, "utf-8").trim();
    const globalRecord = JSON.parse(globalRaw) as Record<string, unknown>;
    expect(globalRecord["id"]).toBe("defect-dw-1");
    expect(globalRecord["source_repo"]).toBe(resolve(localRepo));
    expect(typeof globalRecord["timestamp"]).toBe("string");
    expect(globalRecord["title"]).toBe("Dual Write Defect");

    expect(result.forwardedDestinations).toBeDefined();
    expect(result.forwardedDestinations?.length).toBe(2);
    expect(result.forwardedDestinations).toContain(resolve(skillHomeDefectsFile));
    expect(result.forwardedDestinations).toContain(resolve(globalDefectsFile));
  });

  test("reads defect_routing configuration from active policy.json", () => {
    const localRepo = makeTempDir("policy-repo");
    const skillHome = makeTempDir("policy-skill-home");
    const globalSkill = makeTempDir("policy-global-skill");

    const oltDir = join(localRepo, ".olt");
    vfs.mkdirSync(oltDir, { recursive: true });
    vfs.writeFileSync(
      join(oltDir, "policy.json"),
      JSON.stringify({
        schema_version: 1,
        defect_routing: {
          skill_home_repo_root: skillHome,
          global_skill_dir: globalSkill,
          dual_write_enabled: true,
        },
      }),
    );

    const resolved = resolveDefectRoutingPolicy(localRepo);
    expect(resolved.skill_home_repo_root).toBe(skillHome);
    expect(resolved.global_skill_dir).toBe(globalSkill);
    expect(resolved.dual_write_enabled).toBe(true);

    const result = SplitChannelDefectRouter.routeDefect({
      currentRepoRoot: localRepo,
      domain: "project",
      defect: {
        error_code: "POLICY_ROUTED_ERR",
        title: "From Policy Test",
        description: "Testing policy resolution",
      },
    });

    expect(result.routed).toBe(true);
    expect(vfs.existsSync(join(skillHome, ".olt", "defects.jsonl"))).toBe(true);
    expect(vfs.existsSync(join(globalSkill, ".olt", "defects.jsonl"))).toBe(true);
  });

  test("respects dual_write_enabled: false defined in policy.json", () => {
    const localRepo = makeTempDir("disabled-repo");
    const skillHome = makeTempDir("disabled-skill-home");
    const globalSkill = makeTempDir("disabled-global-skill");

    const oltDir = join(localRepo, ".olt");
    vfs.mkdirSync(oltDir, { recursive: true });
    vfs.writeFileSync(
      join(oltDir, "policy.json"),
      JSON.stringify({
        defect_routing: {
          skill_home_repo_root: skillHome,
          global_skill_dir: globalSkill,
          dual_write_enabled: false,
        },
      }),
    );

    const result = SplitChannelDefectRouter.routeDefect({
      currentRepoRoot: localRepo,
      domain: "project",
      defect: {
        error_code: "DISABLED_ERR",
        title: "Dual Write Disabled",
        description: "Should not forward",
      },
    });

    expect(result.routed).toBe(true);
    expect(result.dualWriteEnabled).toBe(false);
    expect(vfs.existsSync(join(localRepo, ".olt", "defects.jsonl"))).toBe(true);
    expect(vfs.existsSync(join(skillHome, ".olt", "defects.jsonl"))).toBe(false);
    expect(vfs.existsSync(join(globalSkill, ".olt", "defects.jsonl"))).toBe(false);
    expect(result.forwardedDestinations?.length ?? 0).toBe(0);
  });

  test("isolates forwarding errors when remote directory is inaccessible without failing primary route", () => {
    const localRepo = makeTempDir("error-isolation-local");
    const blockerFile = join(localRepo, "blocker.txt");
    vfs.writeFileSync(blockerFile, "I am a file, not a directory");

    const inaccessiblePath = join(blockerFile, "impossible", "nested");

    const result = SplitChannelDefectRouter.routeDefect({
      currentRepoRoot: localRepo,
      domain: "project",
      defect: {
        id: "defect-nonblocking-1",
        error_code: "ERR_NONBLOCKING",
        title: "Non-blocking Test",
        description: "Primary routing must succeed even if remote fails",
      },
      routingPolicy: {
        skill_home_repo_root: inaccessiblePath,
        global_skill_dir: inaccessiblePath,
        dual_write_enabled: true,
      },
    });

    expect(result.routed).toBe(true);
    expect(result.dualWriteEnabled).toBe(true);
    expect(result.forwardedDestinations).toEqual([]);

    const localDefectsFile = join(localRepo, ".olt", "defects.jsonl");
    expect(vfs.existsSync(localDefectsFile)).toBe(true);
    const raw = vfs.readFileSync(localDefectsFile, "utf-8");
    expect(raw).toContain("defect-nonblocking-1");
  });

  test("routes domain skill-framework to skill_home_repo_root as primary target", () => {
    const localRepo = makeTempDir("client-repo");
    const skillHome = makeTempDir("framework-home");
    const globalSkill = makeTempDir("framework-global");

    const result = SplitChannelDefectRouter.routeDefect({
      currentRepoRoot: localRepo,
      domain: "skill-framework",
      defect: {
        id: "framework-defect-1",
        error_code: "FRAMEWORK_ERR",
        title: "Framework Error",
        description: "Defect belonging to framework domain",
      },
      routingPolicy: {
        skill_home_repo_root: skillHome,
        global_skill_dir: globalSkill,
        dual_write_enabled: true,
      },
    });

    expect(result.routed).toBe(true);
    expect(result.isMothership).toBe(true);
    expect(vfs.existsSync(join(globalSkill, ".olt", "defects.jsonl"))).toBe(true);
  });
});
