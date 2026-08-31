import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkModularity } from "../../../../scripts/modularity/index.ts";
import { gitInFixture } from "./inventory/index-fixture.ts";

let tempRepo: string | undefined;

beforeEach(async () => {
  tempRepo = await mkdtemp(join(tmpdir(), "modularity-checker-test-"));
  await gitInFixture(tempRepo, ["init", "--quiet", "--initial-branch", "main"]);
});

afterEach(async () => {
  if (tempRepo) {
    await rm(tempRepo, { recursive: true, force: true });
    tempRepo = undefined;
  }
});

test("rejects a baseline path outside the repository", async () => {
  await expect(
    checkModularity({
      repoRoot: process.cwd(),
      mode: "ratchet",
      source: "index",
      baselinePath: "../outside.json",
    }),
  ).rejects.toThrow("outside");
});

test("runs checkModularity in strict mode on tree with clean repository", async () => {
  if (!tempRepo) throw new Error("Missing temp repo");
  await writeFile(join(tempRepo, "README.md"), "# Test\n");
  await writeFile(
    join(tempRepo, "package.json"),
    JSON.stringify({ name: "test", version: "1.0.0" }),
  );
  await mkdir(join(tempRepo, "src"), { recursive: true });
  await writeFile(join(tempRepo, "src", "index.ts"), "export const a = 1;\n");

  const report = await checkModularity({
    repoRoot: tempRepo,
    mode: "strict",
    source: "tree",
  });

  expect(report.mode).toBe("strict");
  expect(report.source).toBe("tree");
  expect(report.violations).toEqual([]);
  expect(report.baselineDelta).toEqual({ added: [], worsened: [], resolved: [] });
  expect(report.passed).toBe(true);
});

test("runs checkModularity in strict mode on index with violations", async () => {
  if (!tempRepo) throw new Error("Missing temp repo");
  // Add unapproved root path
  await writeFile(join(tempRepo, "unapproved.txt"), "hello");
  // Add line limit violation (> 300 lines)
  await mkdir(join(tempRepo, "src"), { recursive: true });
  await writeFile(join(tempRepo, "src", "index.ts"), "export const x = 1;\n".repeat(305));
  // Add cycle
  await writeFile(join(tempRepo, "src", "a.ts"), 'import "./b.ts";\nexport const a = 1;\n');
  await writeFile(join(tempRepo, "src", "b.ts"), 'import "./a.ts";\nexport const b = 2;\n');
  // Add export star
  await writeFile(join(tempRepo, "src", "star.ts"), 'export * from "./a.ts";\n');

  await gitInFixture(tempRepo, ["add", "."]);

  const report = await checkModularity({
    repoRoot: tempRepo,
    mode: "strict",
    source: "index",
  });

  expect(report.mode).toBe("strict");
  expect(report.source).toBe("index");
  expect(report.passed).toBe(false);
  expect(report.violations.length).toBeGreaterThan(0);
});

test("runs checkModularity in ratchet mode with custom baseline in subdirectory", async () => {
  if (!tempRepo) throw new Error("Missing temp repo");
  await writeFile(join(tempRepo, "README.md"), "# Test\n");
  await mkdir(join(tempRepo, "src"), { recursive: true });
  await writeFile(join(tempRepo, "src", "index.ts"), "export const a = 1;\n");
  await mkdir(join(tempRepo, "config"), { recursive: true });

  const baselineContent = JSON.stringify({
    schema: "olt-modularity-baseline/v1",
    violations: [],
  });
  await writeFile(join(tempRepo, "config", "baseline.json"), baselineContent);

  const report = await checkModularity({
    repoRoot: tempRepo,
    mode: "ratchet",
    source: "tree",
    baselinePath: "config/baseline.json",
  });

  expect(report.mode).toBe("ratchet");
  expect(report.passed).toBe(true);
});

test("runs checkModularity in ratchet mode on repo root with default baseline", async () => {
  if (!tempRepo) throw new Error("Missing temp repo");
  await mkdir(join(tempRepo, "scripts", "modularity", "baseline"), { recursive: true });
  await writeFile(
    join(tempRepo, "scripts", "modularity", "baseline", "index.json"),
    JSON.stringify({ schema: "olt-modularity-baseline/v1", violations: [] }),
  );
  const report = await checkModularity({
    repoRoot: tempRepo,
    mode: "ratchet",
    source: "tree",
  });

  expect(report.mode).toBe("ratchet");
  expect(report.source).toBe("tree");
  expect(typeof report.passed).toBe("boolean");
});
