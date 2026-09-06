import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logCliDefect, resolveDefectRouting } from "../../olt/scripts/harness.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/harness-error.ts";
import { ensureDefectRoutingDeployment } from "../../scripts/sync/index.ts";

interface DefectRecord {
  readonly id: string;
  readonly timestamp: string;
  readonly category: string;
  readonly command: string;
  readonly error_code: string;
  readonly message: string;
  readonly severity: string;
  readonly status: string;
  readonly source_repo: string;
}

function parseLastDefect(filePath: string): DefectRecord {
  const content = readFileSync(filePath, "utf-8").trim();
  const lines = content.split("\n").filter((l) => l.length > 0);
  const lastLine = lines[lines.length - 1];
  if (!lastLine) {
    throw new Error(`File ${filePath} is empty`);
  }
  return JSON.parse(lastLine) as DefectRecord;
}

describe("CLI Defect Routing and Dual-Write Forwarding", () => {
  let sandboxDir: string;
  let clientRepo: string;
  let mothershipRepo: string;
  let globalSkillDir: string;
  const originalCwd = process.cwd();
  const originalHomeRepo = process.env["OLT_SKILL_HOME_REPO"];
  const originalGlobalDir = process.env["OLT_GLOBAL_SKILL_DIR"];
  const originalDualWrite = process.env["OLT_DUAL_WRITE"];

  beforeEach(() => {
    const rawSandbox = join(
      tmpdir(),
      `olt-defect-routing-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    mkdirSync(rawSandbox, { recursive: true });
    sandboxDir = realpathSync(rawSandbox);
    clientRepo = join(sandboxDir, "client-repo");
    mothershipRepo = join(sandboxDir, "mothership-repo");
    globalSkillDir = join(sandboxDir, "global-skill");

    mkdirSync(join(clientRepo, ".git"), { recursive: true });
    writeFileSync(join(clientRepo, "package.json"), "{}", "utf-8");
    mkdirSync(join(clientRepo, ".olt"), { recursive: true });

    mkdirSync(join(mothershipRepo, ".git"), { recursive: true });
    writeFileSync(join(mothershipRepo, "package.json"), "{}", "utf-8");
    mkdirSync(join(mothershipRepo, ".olt"), { recursive: true });

    mkdirSync(join(globalSkillDir, ".olt"), { recursive: true });

    process.chdir(clientRepo);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalHomeRepo !== undefined) {
      process.env["OLT_SKILL_HOME_REPO"] = originalHomeRepo;
    } else {
      delete process.env["OLT_SKILL_HOME_REPO"];
    }
    if (originalGlobalDir !== undefined) {
      process.env["OLT_GLOBAL_SKILL_DIR"] = originalGlobalDir;
    } else {
      delete process.env["OLT_GLOBAL_SKILL_DIR"];
    }
    if (originalDualWrite !== undefined) {
      process.env["OLT_DUAL_WRITE"] = originalDualWrite;
    } else {
      delete process.env["OLT_DUAL_WRITE"];
    }
    if (existsSync(sandboxDir)) {
      rmSync(sandboxDir, { recursive: true, force: true });
    }
  });

  test("logCliDefect writes locally to .olt/defects.jsonl", () => {
    process.env["OLT_DUAL_WRITE"] = "false";
    const error = new HarnessError("INVALID_ARGUMENT", "Invalid argument provided");
    logCliDefect(error, ["test:cmd", "--flag"]);

    const localPath = join(clientRepo, ".olt", "defects.jsonl");
    expect(existsSync(localPath)).toBe(true);

    const record = parseLastDefect(localPath);
    expect(record.command).toBe("test:cmd --flag");
    expect(record.error_code).toBe("INVALID_ARGUMENT");
    expect(record.source_repo).toBe(clientRepo);
    expect(record.category).toBe("cli_error");
    expect(typeof record.timestamp).toBe("string");
    expect(record.timestamp.length).toBeGreaterThan(0);

    // Forwarding paths should not be written when dual-write is disabled
    expect(existsSync(join(mothershipRepo, ".olt", "defects.jsonl"))).toBe(false);
    expect(existsSync(join(globalSkillDir, ".olt", "defects.jsonl"))).toBe(false);
  });

  test("dual-write forwards defects to skill_home_repo_root and global_skill_dir with source_repo and timestamp", () => {
    process.env["OLT_SKILL_HOME_REPO"] = mothershipRepo;
    process.env["OLT_GLOBAL_SKILL_DIR"] = globalSkillDir;
    process.env["OLT_DUAL_WRITE"] = "true";

    const error = new HarnessError("PERMISSION_DENIED", "Access to resource refused");
    logCliDefect(error, ["auth:check", "--role", "worker"]);

    const localPath = join(clientRepo, ".olt", "defects.jsonl");
    const mothershipPath = join(mothershipRepo, ".olt", "defects.jsonl");
    const globalPath = join(globalSkillDir, ".olt", "defects.jsonl");

    expect(existsSync(localPath)).toBe(true);
    expect(existsSync(mothershipPath)).toBe(true);
    expect(existsSync(globalPath)).toBe(true);

    const localRecord = parseLastDefect(localPath);
    const mothershipRecord = parseLastDefect(mothershipPath);
    const globalRecord = parseLastDefect(globalPath);

    expect(localRecord.id).toBe(mothershipRecord.id);
    expect(localRecord.id).toBe(globalRecord.id);
    expect(localRecord.timestamp).toBe(mothershipRecord.timestamp);
    expect(localRecord.timestamp).toBe(globalRecord.timestamp);

    expect(mothershipRecord.source_repo).toBe(clientRepo);
    expect(mothershipRecord.error_code).toBe("PERMISSION_DENIED");
    expect(mothershipRecord.severity).toBe("critical");

    expect(globalRecord.source_repo).toBe(clientRepo);
    expect(globalRecord.error_code).toBe("PERMISSION_DENIED");
    expect(globalRecord.command).toBe("auth:check --role worker");
  });

  test("resolves defect routing from policy.json when configured", () => {
    delete process.env["OLT_SKILL_HOME_REPO"];
    delete process.env["OLT_GLOBAL_SKILL_DIR"];
    delete process.env["OLT_DUAL_WRITE"];

    const policyContent = {
      defect_routing: {
        skill_home_repo_root: mothershipRepo,
        global_skill_dir: globalSkillDir,
        dual_write_enabled: true,
      },
    };
    writeFileSync(
      join(clientRepo, ".olt", "policy.json"),
      JSON.stringify(policyContent, null, 2),
      "utf-8",
    );

    const resolution = resolveDefectRouting(clientRepo);
    expect(resolution.skillHomeRepo).toBe(mothershipRepo);
    expect(resolution.globalSkillDir).toBe(globalSkillDir);
    expect(resolution.dualWriteEnabled).toBe(true);

    const error = new HarnessError("LOCK_TIMEOUT", "Lock acquisition timed out");
    logCliDefect(error, ["task:run"]);

    const mothershipPath = join(mothershipRepo, ".olt", "defects.jsonl");
    const globalPath = join(globalSkillDir, ".olt", "defects.jsonl");

    expect(existsSync(mothershipPath)).toBe(true);
    expect(existsSync(globalPath)).toBe(true);

    const record = parseLastDefect(mothershipPath);
    expect(record.error_code).toBe("LOCK_TIMEOUT");
    expect(record.source_repo).toBe(clientRepo);
  });

  test("isolates write errors non-blockingly so CLI execution is never disrupted", () => {
    // Pass non-standard error types without throwing
    expect(() =>
      logCliDefect(new Error("standard runtime exception"), ["throw:cmd"]),
    ).not.toThrow();
    expect(() => logCliDefect("raw string error message", ["throw:cmd"])).not.toThrow();
    expect(() => logCliDefect(null, ["throw:cmd"])).not.toThrow();
    expect(() => logCliDefect(undefined, ["throw:cmd"])).not.toThrow();
    expect(() => logCliDefect({ custom: "untyped payload" }, ["throw:cmd"])).not.toThrow();
  });

  test("ensureDefectRoutingDeployment configures global skill directory with defect routing", () => {
    ensureDefectRoutingDeployment(globalSkillDir, mothershipRepo);

    expect(existsSync(join(globalSkillDir, ".olt"))).toBe(true);
    const configPath = join(globalSkillDir, "skill-config.json");
    expect(existsSync(configPath)).toBe(true);

    const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as {
      readonly home_repo_root: string;
      readonly defect_routing: {
        readonly skill_home_repo_root: string;
        readonly global_skill_dir: string;
        readonly dual_write_enabled: boolean;
      };
    };

    expect(parsed.home_repo_root).toBe(mothershipRepo);
    expect(parsed.defect_routing.skill_home_repo_root).toBe(mothershipRepo);
    expect(parsed.defect_routing.global_skill_dir).toBe(globalSkillDir);
    expect(parsed.defect_routing.dual_write_enabled).toBe(true);
  });
});
