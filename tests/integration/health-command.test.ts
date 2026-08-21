import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { findCommand } from "../../orchestrating-long-tasks/scripts/src/cli/registry/index.ts";
import { cleanupTempRoots, tempRoot, writeTree } from "../unit/health/fixture.ts";

afterAll(cleanupTempRoots);

/** A miniature repo shaped like this one: <repo>/<skill>/scripts/{harness.ts,src}. */
function scriptsRoot(prefix: string, files: Record<string, string>, withTests = true): string {
  const root = tempRoot(prefix);
  writeTree(root, {
    ...Object.fromEntries(
      Object.entries(files).map(([name, text]) => [`skill/scripts/${name}`, text]),
    ),
    ...(withTests ? { "tests/placeholder.test.ts": "// a suite lives here\n" } : {}),
  });
  return join(root, "skill/scripts");
}

const HEALTHY = {
  "harness.ts": 'import { run } from "./src/run.ts";\nrun();\n',
  "src/run.ts": "export function run(): number {\n  return 1;\n}\n",
};

const UNHEALTHY = {
  ...HEALTHY,
  "src/orphan.ts": "export function orphaned(): number {\n  return 2;\n}\n",
};

describe("the health command reports a tree, not a capsule", () => {
  test("a clean tree passes the checks it was asked for", async () => {
    const result = await execute([
      "health",
      "--scripts",
      scriptsRoot("healthy", HEALTHY),
      "--check",
      "unused-code",
      "--check",
      "dead-code",
    ]);
    expect(result.healthy).toBe(true);
    expect(result.failure_count).toBe(0);
    expect(String(result.markdown)).toContain("**Verdict**: healthy");
    expect((result.checks as unknown[]).length).toBe(2);
  });

  test("an unreferenced module makes the tree unhealthy", async () => {
    const result = await execute([
      "health",
      "--scripts",
      scriptsRoot("unhealthy", UNHEALTHY),
      "--check",
      "unused-code",
    ]);
    expect(result.healthy).toBe(false);
    expect(String(result.markdown)).toContain("orphan.ts");
  });

  test("--strict turns an unhealthy report into a nonzero exit", async () => {
    const scripts = scriptsRoot("strict", UNHEALTHY);
    await expect(
      execute(["health", "--scripts", scripts, "--check", "unused-code", "--strict"]),
    ).rejects.toThrow("semantic health check failed");
    const relaxed = await execute(["health", "--scripts", scripts, "--check", "unused-code"]);
    expect(relaxed.healthy).toBe(false);
  });

  test("--strict stays quiet when the report is clean", async () => {
    const result = await execute([
      "health",
      "--scripts",
      scriptsRoot("strict-clean", HEALTHY),
      "--check",
      "unused-code",
      "--strict",
    ]);
    expect(result.healthy).toBe(true);
  });

  test("--all lists what the bounded rendering leaves out", async () => {
    const many = Object.fromEntries(
      Array.from({ length: 8 }, (_, index) => [
        `src/orphan-${index}.ts`,
        `export function orphan${index}(): number {\n  return ${index};\n}\n`,
      ]),
    );
    const scripts = scriptsRoot("listing", { ...HEALTHY, ...many });
    const brief = await execute(["health", "--scripts", scripts, "--check", "unused-code"]);
    const full = await execute(["health", "--scripts", scripts, "--check", "unused-code", "--all"]);
    expect(String(brief.markdown)).toContain("more failure(s)");
    expect(String(full.markdown)).not.toContain("more failure(s)");
    expect(String(full.markdown).length).toBeGreaterThan(String(brief.markdown).length);
  });
});

describe("what the command cannot check, it refuses to pretend about", () => {
  test("a checkout with no suite skips the check that needs one, and says why", async () => {
    const result = await execute([
      "health",
      "--scripts",
      scriptsRoot("no-tests", UNHEALTHY, false),
      "--check",
      "unused-code",
    ]);
    expect(result.checks).toEqual([]);
    expect(String(result.markdown)).toContain("no tests directory");
    expect(String(result.markdown)).toContain("#### Not run");
  });

  test("a checkout with no requirement documents skips the drift check", async () => {
    const result = await execute([
      "health",
      "--scripts",
      scriptsRoot("no-docs", HEALTHY),
      "--check",
      "intent-drift",
    ]);
    expect(String(result.markdown)).toContain("no requirement documents");
  });

  test("without a consumer repository the vendor sweep says it covered one tree", async () => {
    const result = await execute([
      "health",
      "--scripts",
      scriptsRoot("one-repo", HEALTHY),
      "--check",
      "vendor-identifiers",
    ]);
    expect(String(result.markdown)).toContain("consumer repository was NOT scanned");
  });
});

describe("pointed at its own repository, every check runs", () => {
  test("the requirement documents are read and mapped against the code", async () => {
    const result = await execute(["health", "--check", "intent-drift"]);
    const checks = result.checks as Array<{
      check: string;
      scanned: number;
      limitations: string[];
    }>;
    expect(checks[0]?.check).toBe("intent-drift");
    expect(checks[0]?.scanned).toBeGreaterThan(0);
    expect(checks[0]?.limitations.join(" ")).toContain("cannot be checked mechanically");
  });
});

describe("the command refuses what it cannot honour", () => {
  test("an unknown check names the checks that exist", async () => {
    await expect(execute(["health", "--check", "guesswork"])).rejects.toThrow(
      "unknown --check: guesswork",
    );
  });

  test("a consumer path that does not exist is refused", async () => {
    await expect(execute(["health", "--consumer", "/no/such/repo"])).rejects.toThrow(
      "--consumer does not exist",
    );
  });

  test("a scripts path that is not a harness root is refused", async () => {
    const root = writeTree(tempRoot("not-a-harness"), { "readme.md": "no src here" });
    await expect(execute(["health", "--scripts", root])).rejects.toThrow("no src directory under");
  });

  test("the command is registered with its flags and examples", () => {
    const spec = findCommand("health");
    expect(spec?.domain).toBe("diagnostics");
    expect(spec?.flags.map((flag) => flag.name).sort()).toEqual([
      "all",
      "check",
      "consumer",
      "scripts",
      "strict",
    ]);
    expect(spec?.examples.length).toBeGreaterThan(0);
  });
});

describe("pointed at a tree this process is not running, it says what it cannot judge", () => {
  test("the running registry's handlers are not reported missing from a foreign tree", async () => {
    const result = await execute([
      "health",
      "--scripts",
      scriptsRoot("foreign", HEALTHY),
      "--check",
      "unenforced-declarations",
    ]);
    expect(result.healthy).toBe(true);
    expect(String(result.markdown)).not.toContain("declares handler");
    expect(String(result.markdown)).toContain("were NOT checked");
  });
});
