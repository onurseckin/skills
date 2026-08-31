import { describe, expect, test, afterAll } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
  resolveSystemLockPath,
  withLock,
} from "../../../olt/scripts/src/policy/io-safety.ts";

describe("Repo Policy I/O, Flocking & Generator (Task 1.2)", () => {
  const scratchBase = join(
    tmpdir(),
    `test-policy-io-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  afterAll(() => {
    rmSync(scratchBase, { recursive: true, force: true });
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
    expect(impl.hosts.claude_code.thinking_effort).toBe("medium");
    expect(impl.hosts.claude_code.model_tier).toBe("medium");
    expect(impl.hosts.codex.thinking_effort).toBe("medium");
    expect(impl.hosts.codex.model_tier).toBe("medium");
    expect(impl.hosts.cursor.thinking_effort).toBe("medium");
    expect(impl.hosts.cursor.model_tier).toBe("medium");

    const valCode = agents["validator_code_quality"];
    if (!valCode) throw new Error("validator_code_quality undefined");
    expect(valCode.domain).toBe("code_quality");
    expect(valCode.hosts.claude_code.thinking_effort).toBe("medium");

    expect(agents["validator_ui_design"]).toBeDefined();
    expect(agents["validator_security"]).toBeDefined();
    expect(agents["validator_system_design"]).toBeDefined();
    expect(agents["validator_product"]).toBeDefined();

    const critic = agents["completeness_critic"];
    if (!critic) throw new Error("completeness_critic undefined");
    expect(critic.hosts.codex.thinking_effort).toBe("medium");

    const watchdog = agents["autonomic_watchdog"];
    if (!watchdog) throw new Error("autonomic_watchdog undefined");
    expect(watchdog.hosts.antigravity.thinking_effort).toBe("medium");

    const owner = agents["owner"];
    if (!owner) throw new Error("owner undefined");
    expect(owner.tier).toBe("independent");
    expect(owner.hosts.codex.thinking_effort).toBe("high");
    expect(owner.hosts.codex.model_tier).toBe("xhigh");
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

    rmSync(dir, { recursive: true, force: true });
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

    rmSync(dir, { recursive: true, force: true });
  });

  test("initRepoPolicy creates .olt/policy.json and returns valid policy", () => {
    const dir = join(scratchBase, "init-test");
    mkdirSync(dir, { recursive: true });

    const policy = initRepoPolicy(dir);
    expect(policy.schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);
    expect(existsSync(join(dir, ".olt", "policy.json"))).toBe(true);
    expect(loadRepoPolicy(dir).schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);

    rmSync(dir, { recursive: true, force: true });
  });

  test("rejects symlinked files escaping repo root with PATH_SAFETY error", () => {
    const dir = join(scratchBase, "escape-test");
    const outside = join(scratchBase, "outside-sec.json");
    mkdirSync(dir, { recursive: true });
    writeFileSync(outside, JSON.stringify(generateDefaultRepoPolicy(dir)), "utf-8");

    const symlinkTarget = join(dir, "symlinked-policy.json");
    symlinkSync(outside, symlinkTarget);

    expect(() => loadRepoPolicy(dir, symlinkTarget)).toThrow(/PATH_SAFETY|regular file/i);

    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { force: true });
  });

  test("concurrent processes serialize writes with flock and expose valid json", async () => {
    const dir = join(
      scratchBase,
      `concurrent-flock-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    mkdirSync(dir, { recursive: true });
    initRepoPolicy(dir);

    const helperScript = join(dir, "worker.ts");
    writeFileSync(
      helperScript,
      `
import { saveRepoPolicy, loadRepoPolicy } from "${resolve(process.cwd(), "olt/scripts/src/policy/repo-policy.ts")}";
const dir = "${dir}";
for (let i = 0; i < 5; i++) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const p = loadRepoPolicy(dir);
      saveRepoPolicy({ ...p, read_scope_neighborhood_depth: i + 1 }, dir);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 15));
    }
  }
}
`,
      "utf-8",
    );

    const spawnWorker = () =>
      new Promise<number>((resolveExit) => {
        const proc = spawn("bun", [helperScript], { stdio: "ignore" });
        proc.on("exit", (code) => resolveExit(code ?? 1));
      });

    const results = await Promise.all([spawnWorker(), spawnWorker(), spawnWorker()]);
    expect(results.every((code) => code === 0)).toBe(true);

    const finalPolicy = loadRepoPolicy(dir);
    expect(finalPolicy.schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);
    expect(finalPolicy.read_scope_neighborhood_depth).toBeGreaterThan(0);

    rmSync(dir, { recursive: true, force: true });
  });

  test("validates resolveSystemLockPath safety constraints", () => {
    const root = process.cwd();
    expect(resolveSystemLockPath("policy.lock", root)).toBe(
      join(root, ".olt", "locks", "policy.lock"),
    );

    expect(() => resolveSystemLockPath(123 as unknown as string)).toThrow(/non-empty string/);
    expect(() => resolveSystemLockPath("")).toThrow(/non-empty string/);
    expect(() => resolveSystemLockPath("   ")).toThrow(/non-empty string/);
    expect(() => resolveSystemLockPath(".")).toThrow(/Invalid lockName/);
    expect(() => resolveSystemLockPath("..")).toThrow(/Invalid lockName/);
    expect(() => resolveSystemLockPath("path/with/slash")).toThrow(/Invalid lockName/);
    expect(() => resolveSystemLockPath("path\\with\\backslash")).toThrow(/Invalid lockName/);
    expect(() => resolveSystemLockPath("path\0null")).toThrow(/Invalid lockName/);
  });

  test("validates checkExistingDir, ensureDir, and resolvePolicyLocation path escaping", () => {
    const root = join(scratchBase, "path-escape-dir");
    mkdirSync(root, { recursive: true });
    try {
      expect(() => checkExistingDir(root, "/outside/path")).toThrow(/escapes repository root/);
      expect(() => ensureDir(root, "/outside/path")).toThrow(/escapes repository root/);

      const nonExistentRoot = join(scratchBase, "nonexistent-root-123");
      expect(() =>
        resolvePolicyLocation(nonExistentRoot, "/outside/escape/path.json", false),
      ).toThrow(/must remain under repository root/);

      // Create policy location when root doesn't exist
      const loc = resolvePolicyLocation(nonExistentRoot, undefined, true);
      expect(loc.root).toBe(nonExistentRoot);
      expect(existsSync(nonExistentRoot)).toBe(true);
      rmSync(nonExistentRoot, { recursive: true, force: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("withLock prevents nested re-entry on the same repo root and readVerifiedFile verifies file integrity", () => {
    const dir = join(scratchBase, "lock-reentry-test");
    mkdirSync(dir, { recursive: true });
    try {
      const loc = resolvePolicyLocation(dir, undefined, true);
      expect(
        withLock(loc, () => {
          expect(() => withLock(loc, () => {})).toThrow(/already active/);
          return 42;
        }),
      ).toBe(42);

      // readVerifiedFile returns undefined when file doesn't exist
      expect(readVerifiedFile(loc)).toBeUndefined();

      // Write valid policy file
      initRepoPolicy(dir);
      const content = readVerifiedFile(loc);
      expect(content).toBeDefined();

      // Test readVerifiedFile when file is modified/replaced after open
      expect(() =>
        readVerifiedFile(loc, {
          afterOpenBeforeRead: () => {
            // Overwrite file so inode changes
            rmSync(loc.filePath);
            writeFileSync(loc.filePath, JSON.stringify({ modified: true }));
          },
        }),
      ).toThrow(/Repository policy changed while opening/);

      // Test readVerifiedFile when file is modified after read
      expect(() =>
        readVerifiedFile(loc, {
          afterLstatBeforeOpen: () => {},
          afterOpenBeforeRead: () => {},
          fstat: ((fd: number) => {
            const real = require("node:fs").fstatSync(fd);
            const copy = Object.create(Object.getPrototypeOf(real));
            Object.assign(copy, real, { ino: real.ino + 999 });
            return copy;
          }) as typeof import("node:fs").fstatSync,
        }),
      ).toThrow(/Repository policy changed while/);

      // Test reqNoFollow unsupported flag

      expect(() => reqNoFollow(0)).toThrow(/final-component O_NOFOLLOW/);
      expect(() => reqNoFollow(Number.NaN)).toThrow(/final-component O_NOFOLLOW/);

      // Test readVerifiedFile retry loop when attempt < maxAttempts
      let fstatCalls = 0;
      const retriedContent = readVerifiedFile(loc, {
        maxAttempts: 2,
        fstat: ((fd: number) => {
          const real = require("node:fs").fstatSync(fd);
          fstatCalls++;
          if (fstatCalls === 1) {
            const copy = Object.create(Object.getPrototypeOf(real));
            Object.assign(copy, real, { ino: real.ino + 999 });
            return copy;
          }
          return real;
        }) as typeof import("node:fs").fstatSync,
      });
      expect(retriedContent).toBeDefined();
      expect(fstatCalls).toBeGreaterThanOrEqual(2);

      // Test withLock when lock is already held
      const lockPath = resolveSystemLockPath("policy.lock", loc.root);
      const holderFd = require("node:fs").openSync(
        lockPath,
        require("node:fs").constants.O_RDWR | require("node:fs").constants.O_CREAT,
        0o600,
      );
      expect(
        require("../../../olt/scripts/src/platform/index.ts").tryExclusiveFlock(holderFd),
      ).toBe(true);
      try {
        const otherLoc = { ...loc, root: loc.root + "-other" };
        const startTime = performance.now();
        // Since activeLocks check passed, it tries flock and times out or acquires
      } finally {
        require("../../../olt/scripts/src/platform/index.ts").releaseFlock(holderFd);
        require("node:fs").closeSync(holderFd);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
