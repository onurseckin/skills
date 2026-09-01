import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, fstatSync, mkdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupVirtualPolicyFS, setupVirtualPolicyFS } from "../fixture.ts";
import {
  CURRENT_POLICY_SCHEMA_VERSION,
  generateCanonicalDefaultPolicy,
  generateDefaultRepoPolicy,
  initRepoPolicy,
  inspectRepoPolicy,
  loadRepoPolicy,
  saveRepoPolicy,
} from "../../../olt/scripts/src/policy/index.ts";
import {
  checkExistingDir,
  ensureDir,
  readVerifiedFile,
  reqNoFollow,
  resolvePolicyLocation,
} from "../../../olt/scripts/src/policy/io-safety.ts";

describe("Repo Policy I/O, Integrity & TOCTOU Verification", () => {
  const scratchBase = "/virtual/policy/io/integrity";

  beforeEach(() => {
    setupVirtualPolicyFS();
  });

  afterEach(() => {
    cleanupVirtualPolicyFS();
  });

  test("generates canonical default policy with complete agent archetypes and docker profiles", () => {
    const policy = generateCanonicalDefaultPolicy(process.cwd());
    expect(policy.schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);
    expect(policy.ecosystem).toBe("bun");
    expect(policy.package_manager).toBe("bun");
    const agents = policy.agents;
    expect(agents).toBeDefined();
    if (!agents) throw new Error("Agents undefined");

    const ms = agents["mind_supervisor"];
    if (!ms) throw new Error("mind_supervisor undefined");
    expect(ms.tier).toBe(0);
    expect(ms.silent_daemon).toBe(true);
    expect(ms.hosts.antigravity.thinking_effort).toBe("high");
    expect(ms.hosts.claude_code.model_tier).toBe("xhigh");

    const orch = agents["orchestrator"];
    if (!orch) throw new Error("orchestrator undefined");
    expect(orch.tier).toBe(1);

    const coord = agents["coordinator"];
    if (!coord) throw new Error("coordinator undefined");
    expect(coord.tier).toBe(2);

    const impl = agents["implementer"];
    if (!impl) throw new Error("implementer undefined");
    expect(impl.tier).toBe(3);
    expect(impl.hosts.antigravity.thinking_effort).toBe("medium");
    expect(impl.hosts.antigravity.model_tier).toBe("medium");

    const valCode = agents["validator_code_quality"];
    if (!valCode) throw new Error("validator_code_quality undefined");
    expect(valCode.domain).toBe("code_quality");

    const critic = agents["completeness_critic"];
    if (!critic) throw new Error("completeness_critic undefined");
    expect(critic.hosts.codex.thinking_effort).toBe("medium");

    const watchdog = agents["autonomic_watchdog"];
    if (!watchdog) throw new Error("autonomic_watchdog undefined");
    expect(watchdog.hosts.antigravity.thinking_effort).toBe("medium");

    const owner = agents["owner"];
    if (!owner) throw new Error("owner undefined");
    expect(owner.tier).toBe("independent");
    expect(owner.rbac.allowed_commands).toContain("authority:decide");

    const docker = policy.docker_environment;
    expect(docker).toBeDefined();
    if (!docker) throw new Error("docker undefined");
    expect(docker.enabled).toBe(true);
    expect(docker.test_user_personas.admin.role).toBe("admin");
  });

  test("strictly governs .olt/policy.json and ignores legacy olt/policy.json fallback", () => {
    const dir = join(scratchBase, "no-fallback-test");
    mkdirSync(join(dir, "olt"), { recursive: true });
    const legacyPath = join(dir, "olt", "policy.json");
    const samplePolicy = { ...generateDefaultRepoPolicy(dir), read_scope_neighborhood_depth: 99 };
    writeFileSync(legacyPath, JSON.stringify(samplePolicy), "utf-8");

    const inspection = inspectRepoPolicy(dir);
    expect(inspection.status).toBe("auto_detected");
    expect(loadRepoPolicy(dir).read_scope_neighborhood_depth).not.toBe(99);

    mkdirSync(join(dir, ".olt"), { recursive: true });
    const primaryPath = join(dir, ".olt", "policy.json");
    const updatedPolicy = { ...samplePolicy, read_scope_neighborhood_depth: 7 };
    writeFileSync(primaryPath, JSON.stringify(updatedPolicy), "utf-8");

    const primaryInspection = inspectRepoPolicy(dir);
    expect(primaryInspection.status).toBe("valid_custom");
    expect(primaryInspection.filePath).toBe(primaryPath);
    expect(loadRepoPolicy(dir).read_scope_neighborhood_depth).toBe(7);
  });

  test("atomic save writes strictly to .olt/policy.json and does not mirror to olt/policy.json", () => {
    const dir = join(scratchBase, "no-mirror-test");
    mkdirSync(join(dir, ".olt"), { recursive: true });
    mkdirSync(join(dir, "olt"), { recursive: true });

    const policy = generateDefaultRepoPolicy(dir);
    const savedPath = saveRepoPolicy(policy, dir);
    expect(savedPath).toBe(join(dir, ".olt", "policy.json"));
    expect(existsSync(join(dir, ".olt", "policy.json"))).toBe(true);
    expect(existsSync(join(dir, "olt", "policy.json"))).toBe(false);
  });

  test("initRepoPolicy creates .olt/policy.json and returns valid policy", () => {
    const dir = join(scratchBase, "init-test");
    mkdirSync(dir, { recursive: true });

    const policy = initRepoPolicy(dir);
    expect(policy.schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);
    expect(existsSync(join(dir, ".olt", "policy.json"))).toBe(true);
    expect(loadRepoPolicy(dir).schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);
  });

  test("rejects symlinked files escaping repo root with PATH_SAFETY error", () => {
    const dir = join(scratchBase, "escape-test");
    const outside = join(scratchBase, "outside-sec.json");
    mkdirSync(dir, { recursive: true });
    writeFileSync(outside, JSON.stringify(generateDefaultRepoPolicy(dir)), "utf-8");

    const symlinkTarget = join(dir, "symlinked-policy.json");
    symlinkSync(outside, symlinkTarget);

    expect(() => loadRepoPolicy(dir, symlinkTarget)).toThrow(/PATH_SAFETY|regular file/i);
  });

  test("validates checkExistingDir, ensureDir, and resolvePolicyLocation path escaping", () => {
    const root = join(scratchBase, "path-escape-dir");
    mkdirSync(root, { recursive: true });
    expect(() => checkExistingDir(root, "/outside/path")).toThrow(/escapes repository root/);
    expect(() => ensureDir(root, "/outside/path")).toThrow(/escapes repository root/);

    const nonExistentRoot = join(scratchBase, "nonexistent-root-123");
    expect(() =>
      resolvePolicyLocation(nonExistentRoot, "/outside/escape/path.json", false),
    ).toThrow(/must remain under repository root/);

    const loc = resolvePolicyLocation(nonExistentRoot, undefined, true);
    expect(loc.root).toBe(nonExistentRoot);
    expect(existsSync(nonExistentRoot)).toBe(true);
  });

  test("readVerifiedFile performs inode verification and defends against TOCTOU replacements", () => {
    const dir = join(scratchBase, "read-verified-test");
    mkdirSync(dir, { recursive: true });
    const loc = resolvePolicyLocation(dir, undefined, true);
    expect(readVerifiedFile(loc)).toBeUndefined();

    initRepoPolicy(dir);
    const content = readVerifiedFile(loc);
    expect(content).toBeDefined();

    // Test readVerifiedFile when file is replaced after open
    expect(() =>
      readVerifiedFile(loc, {
        afterOpenBeforeRead: () => {
          unlinkSync(loc.filePath);
          writeFileSync(loc.filePath, JSON.stringify({ modified: true }));
        },
      }),
    ).toThrow(/Repository policy changed while opening/);

    // Test reqNoFollow unsupported flag
    expect(() => reqNoFollow(0)).toThrow(/final-component O_NOFOLLOW/);
    expect(() => reqNoFollow(Number.NaN)).toThrow(/final-component O_NOFOLLOW/);

    // Test readVerifiedFile retry loop when attempt < maxAttempts
    let fstatCalls = 0;
    const retriedContent = readVerifiedFile(loc, {
      maxAttempts: 2,
      fstat: ((fd: number) => {
        const real = fstatSync(fd);
        fstatCalls++;
        if (fstatCalls === 1) {
          const copy = Object.create(Object.getPrototypeOf(real));
          Object.assign(copy, real, { ino: real.ino + 999 });
          return copy;
        }
        return real;
      }) as typeof fstatSync,
    });
    expect(retriedContent).toBeDefined();
    expect(fstatCalls).toBeGreaterThanOrEqual(2);
  });
});
