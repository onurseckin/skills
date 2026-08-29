import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  SplitChannelDefectRouter,
  type DefectRouteResult,
} from "../../../olt/scripts/src/reporting/split-channel-defect-router.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

const scratchRoots: string[] = [];

function createScratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `split-channel-${prefix}-`));
  scratchRoots.push(dir);
  return dir;
}

afterEach(() => {
  delete process.env["OLT_SKILL_HOME_REPO"];
  for (const dir of scratchRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("SplitChannelDefectRouter", () => {
  test("routes domain 'project' defects to the local project repository ledger", () => {
    const projectRoot = createScratchDir("project");
    mkdirSync(join(projectRoot, ".olt"), { recursive: true });

    const result: DefectRouteResult = SplitChannelDefectRouter.routeDefect({
      currentRepoRoot: projectRoot,
      domain: "project",
      defect: {
        id: "DEF-PROJ-001",
        error_code: "APP_TYPE_ERROR",
        title: "TypeScript type check failure",
        description: "Property 'id' is missing in User type",
        actor: "type-checker",
        timestamp: "2026-08-24T05:00:00.000Z",
        context: { file: "src/user.ts", line: 42 },
      },
    });

    expect(result.routed).toBe(true);
    expect(result.isMothership).toBe(false);
    expect(result.targetRepoRoot).toBe(resolve(projectRoot));
    expect(existsSync(result.targetDefectsPath)).toBe(true);

    const content = readFileSync(result.targetDefectsPath, "utf-8");
    const record = JSON.parse(content.trim()) as Record<string, unknown>;

    expect(record["id"]).toBe("DEF-PROJ-001");
    expect(record["domain"]).toBe("project");
    expect(record["error_code"]).toBe("APP_TYPE_ERROR");
    expect(record["title"]).toBe("TypeScript type check failure");
    expect(record["description"]).toBe("Property 'id' is missing in User type");
    expect(record["actor"]).toBe("type-checker");
    expect(record["timestamp"]).toBe("2026-08-24T05:00:00.000Z");
    expect(record["source_repo"]).toBe(resolve(projectRoot));
    expect(record["context"]).toEqual({ file: "src/user.ts", line: 42 });
  });

  test("routes domain 'skill-framework' defects to the mothership repository ledger", () => {
    const mothershipRoot = createScratchDir("mothership");
    const projectRoot = createScratchDir("client-project");
    mkdirSync(join(mothershipRoot, ".olt"), { recursive: true });
    mkdirSync(join(projectRoot, ".olt"), { recursive: true });

    process.env["OLT_SKILL_HOME_REPO"] = mothershipRoot;

    const result: DefectRouteResult = SplitChannelDefectRouter.routeDefect({
      currentRepoRoot: projectRoot,
      domain: "skill-framework",
      defect: {
        id: "DEF-FRAMEWORK-001",
        error_code: "ROOT_HYGIENE_VIOLATION",
        title: "Scratch file leaked into repo root",
        description: "Temporary script was created outside scratch/",
        actor: "meta-auditor",
        timestamp: "2026-08-24T05:05:00.000Z",
        context: { leakedFile: "temp.ts" },
      },
    });

    expect(result.routed).toBe(true);
    expect(result.isMothership).toBe(true);
    expect(result.targetRepoRoot).toBe(resolve(mothershipRoot));
    expect(existsSync(result.targetDefectsPath)).toBe(true);
    expect(result.targetDefectsPath.startsWith(resolve(mothershipRoot))).toBe(true);

    const content = readFileSync(result.targetDefectsPath, "utf-8");
    const record = JSON.parse(content.trim()) as Record<string, unknown>;

    expect(record["id"]).toBe("DEF-FRAMEWORK-001");
    expect(record["domain"]).toBe("skill-framework");
    expect(record["error_code"]).toBe("ROOT_HYGIENE_VIOLATION");
    expect(record["source_repo"]).toBe(resolve(projectRoot));
  });

  test("auto-generates id, actor, and timestamp when omitted", () => {
    const projectRoot = createScratchDir("defaults");

    const result = SplitChannelDefectRouter.routeDefect({
      currentRepoRoot: projectRoot,
      domain: "project",
      defect: {
        error_code: "GENERIC_ERROR",
        title: "Sample error",
        description: "Sample description",
      },
    });

    expect(result.routed).toBe(true);
    const content = readFileSync(result.targetDefectsPath, "utf-8");
    const record = JSON.parse(content.trim()) as Record<string, unknown>;

    expect(typeof record["id"]).toBe("string");
    expect((record["id"] as string).startsWith("defect-")).toBe(true);
    expect(record["actor"]).toBe("unknown");
    expect(typeof record["timestamp"]).toBe("string");
    expect(record["context"]).toBeUndefined();
  });

  test("throws INTEGRITY without routing a framework defect to the project ledger when mothership is unavailable", () => {
    const projectRoot = createScratchDir("fallback-project");
    mkdirSync(join(projectRoot, ".olt"), { recursive: true });

    // Set mothership to an invalid location where creating directory fails
    const badMothership = join(projectRoot, "mothership-file");
    // Create a regular file at badMothership so mkdirSync(badMothership/.olt) fails with ENOTDIR
    writeFileSync(badMothership, "not a directory", "utf-8");
    process.env["OLT_SKILL_HOME_REPO"] = badMothership;

    let firstFailure: unknown;
    try {
      SplitChannelDefectRouter.routeDefect({
        currentRepoRoot: projectRoot,
        domain: "skill-framework",
        defect: {
          id: "DEF-FALLBACK-001",
          error_code: "BLUNDER_DETECTED",
          title: "Test blunder",
          description: "Blunder description",
        },
      });
    } catch (error) {
      firstFailure = error;
    }
    expect(firstFailure).toBeInstanceOf(HarnessError);
    expect((firstFailure as HarnessError).code).toBe("INTEGRITY");
    expect(existsSync(join(projectRoot, ".olt", "defects.jsonl"))).toBe(false);
  });

  test("refuses a final symlink without changing its target", () => {
    const projectRoot = createScratchDir("symlink");
    const target = join(projectRoot, "target.jsonl");
    const defectsPath = join(projectRoot, ".olt", "defects.jsonl");
    writeFileSync(target, "preserve\n", "utf-8");
    mkdirSync(dirname(defectsPath), { recursive: true });
    symlinkSync(target, defectsPath);

    expect(() =>
      SplitChannelDefectRouter.routeDefect({
        currentRepoRoot: projectRoot,
        domain: "project",
        defect: {
          error_code: "SYMLINK",
          title: "refuse",
          description: "must not follow final symlink",
        },
      }),
    ).toThrow(HarnessError);
    expect(readFileSync(target, "utf-8")).toBe("preserve\n");
  });

  test("fails serialization before creating a ledger row for cyclic and BigInt contexts", () => {
    const cyclicRoot = createScratchDir("cyclic");
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;

    let cyclicFailure: unknown;
    try {
      SplitChannelDefectRouter.routeDefect({
        currentRepoRoot: cyclicRoot,
        domain: "project",
        defect: { error_code: "CYCLIC", title: "cyclic", description: "cyclic", context: cyclic },
      });
    } catch (error) {
      cyclicFailure = error;
    }
    expect(cyclicFailure).toBeInstanceOf(HarnessError);
    expect((cyclicFailure as HarnessError).code).toBe("INTEGRITY");
    expect(existsSync(join(cyclicRoot, ".olt", "defects.jsonl"))).toBe(false);

    const bigintRoot = createScratchDir("bigint");
    let bigintFailure: unknown;
    try {
      SplitChannelDefectRouter.routeDefect({
        currentRepoRoot: bigintRoot,
        domain: "project",
        defect: {
          error_code: "BIGINT",
          title: "bigint",
          description: "bigint",
          context: { value: BigInt(1) },
        },
      });
    } catch (error) {
      bigintFailure = error;
    }
    expect(bigintFailure).toBeInstanceOf(HarnessError);
    expect((bigintFailure as HarnessError).code).toBe("INTEGRITY");
    expect(existsSync(join(bigintRoot, ".olt", "defects.jsonl"))).toBe(false);
  });

  test("formats hostile serialization errors without accessing hostile getters or coercion", () => {
    const projectRoot = createScratchDir("hostile");
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, "message", {
      get: () => {
        throw new Error("message getter accessed");
      },
    });
    Object.defineProperty(hostile, "toString", {
      get: () => {
        throw new Error("toString getter accessed");
      },
    });
    const context = {} as Record<string, unknown>;
    Object.defineProperty(context, "toJSON", {
      get: () => {
        throw hostile;
      },
    });

    let hostileFailure: unknown;
    try {
      SplitChannelDefectRouter.routeDefect({
        currentRepoRoot: projectRoot,
        domain: "project",
        defect: { error_code: "HOSTILE", title: "hostile", description: "hostile", context },
      });
    } catch (error) {
      hostileFailure = error;
    }
    expect(hostileFailure).toBeInstanceOf(HarnessError);
    expect((hostileFailure as HarnessError).code).toBe("INTEGRITY");
    expect((hostileFailure as Error).message).toContain("unknown error");
    expect(existsSync(join(projectRoot, ".olt", "defects.jsonl"))).toBe(false);
  });

  test("rejects a supplied context that JSON serialization would silently omit before directory creation", () => {
    const projectRoot = createScratchDir("omitted-context");
    let serializations = 0;
    const context = {} as Record<string, unknown>;
    context["toJSON"] = () => {
      serializations += 1;
      return undefined;
    };

    let failure: unknown;
    try {
      SplitChannelDefectRouter.routeDefect({
        currentRepoRoot: projectRoot,
        domain: "project",
        defect: {
          error_code: "OMITTED_CONTEXT",
          title: "omitted",
          description: "context must persist",
          context,
        },
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(HarnessError);
    expect((failure as HarnessError).code).toBe("INTEGRITY");
    expect(serializations).toBe(1);
    expect(existsSync(join(projectRoot, ".olt"))).toBe(false);
  });

  test("appends multiple defects sequentially without overwriting previous records", () => {
    const projectRoot = createScratchDir("multi");

    SplitChannelDefectRouter.routeDefect({
      currentRepoRoot: projectRoot,
      domain: "project",
      defect: {
        id: "DEF-001",
        error_code: "ERR_1",
        title: "First defect",
        description: "First description",
      },
    });

    const result2 = SplitChannelDefectRouter.routeDefect({
      currentRepoRoot: projectRoot,
      domain: "project",
      defect: {
        id: "DEF-002",
        error_code: "ERR_2",
        title: "Second defect",
        description: "Second description",
      },
    });

    expect(result2.routed).toBe(true);
    const content = readFileSync(result2.targetDefectsPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]!) as Record<string, unknown>;
    const second = JSON.parse(lines[1]!) as Record<string, unknown>;

    expect(first["id"]).toBe("DEF-001");
    expect(second["id"]).toBe("DEF-002");
  });
});
