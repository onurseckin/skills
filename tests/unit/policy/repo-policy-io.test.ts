import { describe, expect, test, afterAll } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

describe("Repo Policy I/O, Flocking & Generator (Task 1.2)", () => {
  const scratchBase = join(process.cwd(), "coverage", "scratch", "test-policy-io");

  afterAll(() => {
    rmSync(scratchBase, { recursive: true, force: true });
  });

  test("generates canonical default policy with complete agent archetypes and docker profiles", () => {
    const policy = generateCanonicalDefaultPolicy(process.cwd());
    expect(policy.schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);
    expect(policy.ecosystem).toBe("bun");
    expect(policy.package_manager).toBe("bun");
    expect(policy.agents).toBeDefined();

    const agents = policy.agents!;
    expect(agents["mind_supervisor"]).toBeDefined();
    expect(agents["mind_supervisor"].tier).toBe(0);
    expect(agents["mind_supervisor"].silent_daemon).toBe(true);
    expect(agents["mind_supervisor"].hosts.antigravity.thinking_effort).toBe("high");
    expect(agents["mind_supervisor"].hosts.claude_code.model_tier).toBe("xhigh");
    expect(agents["orchestrator"]).toBeDefined();
    expect(agents["orchestrator"].tier).toBe(1);
    expect(agents["coordinator"]).toBeDefined();
    expect(agents["coordinator"].tier).toBe(2);
    expect(agents["implementer"]).toBeDefined();
    expect(agents["implementer"].tier).toBe(3);
    expect(agents["implementer"].hosts.antigravity.thinking_effort).toBe("medium");
    expect(agents["implementer"].hosts.antigravity.model_tier).toBe("medium");
    expect(agents["implementer"].hosts.claude_code.thinking_effort).toBe("medium");
    expect(agents["implementer"].hosts.claude_code.model_tier).toBe("medium");
    expect(agents["implementer"].hosts.codex.thinking_effort).toBe("medium");
    expect(agents["implementer"].hosts.codex.model_tier).toBe("medium");
    expect(agents["implementer"].hosts.cursor.thinking_effort).toBe("medium");
    expect(agents["implementer"].hosts.cursor.model_tier).toBe("medium");
    expect(agents["validator_code_quality"]).toBeDefined();
    expect(agents["validator_code_quality"].domain).toBe("code_quality");
    expect(agents["validator_code_quality"].hosts.claude_code.thinking_effort).toBe("medium");
    expect(agents["validator_ui_design"]).toBeDefined();
    expect(agents["validator_security"]).toBeDefined();
    expect(agents["validator_system_design"]).toBeDefined();
    expect(agents["validator_product"]).toBeDefined();
    expect(agents["completeness_critic"]).toBeDefined();
    expect(agents["completeness_critic"].hosts.codex.thinking_effort).toBe("medium");
    expect(agents["autonomic_watchdog"]).toBeDefined();
    expect(agents["autonomic_watchdog"].hosts.antigravity.thinking_effort).toBe("medium");
    expect(agents["owner"]).toBeDefined();
    expect(agents["owner"].tier).toBe("independent");
    expect(agents["owner"].hosts.codex.thinking_effort).toBe("high");
    expect(agents["owner"].hosts.codex.model_tier).toBe("xhigh");
    expect(agents["owner"].rbac.allowed_commands).toContain("authority:decide");

    expect(policy.docker_environment).toBeDefined();
    expect(policy.docker_environment!.enabled).toBe(true);
    expect(policy.docker_environment!.test_user_personas.admin.role).toBe("admin");
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
  const p = loadRepoPolicy(dir);
  saveRepoPolicy({ ...p, read_scope_neighborhood_depth: i + 1 }, dir);
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
});
