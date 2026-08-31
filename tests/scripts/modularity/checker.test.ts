import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkModularity } from "../../../scripts/modularity/index.ts";
import { findGeneratedCatalogViolations } from "../../../scripts/modularity/policy/index.ts";

function blob(path: string, content: string) {
  return { path, bytes: new TextEncoder().encode(content) };
}

async function gitInFixture(repo: string, args: readonly string[]): Promise<void> {
  const proc = Bun.spawn(["git", "-C", repo, ...args], { stderr: "pipe" });
  if ((await proc.exited) !== 0) {
    throw new Error(await new Response(proc.stderr).text());
  }
}

describe("checkModularity orchestrator", () => {
  let tempRepo: string | undefined;

  beforeEach(async () => {
    tempRepo = await mkdtemp(join(tmpdir(), "mod-checker-test-"));
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
    await writeFile(join(tempRepo, "unapproved.txt"), "hello");
    await mkdir(join(tempRepo, "src"), { recursive: true });
    await writeFile(join(tempRepo, "src", "index.ts"), "export const x = 1;\n".repeat(305));
    await writeFile(join(tempRepo, "src", "a.ts"), 'import "./b.ts";\nexport const a = 1;\n');
    await writeFile(join(tempRepo, "src", "b.ts"), 'import "./a.ts";\nexport const b = 2;\n');
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
    await writeFile(join(tempRepo, "README.md"), "# Test\n");
    await writeFile(
      join(tempRepo, "package.json"),
      JSON.stringify({ name: "test", version: "1.0.0" }),
    );
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
});

describe("generated CLI catalog validation", () => {
  const root = "olt/references/cli-capabilities/";

  test("returns empty array when manifest or index.jsonl is missing", () => {
    expect(findGeneratedCatalogViolations([])).toEqual([]);
    expect(findGeneratedCatalogViolations([blob(`${root}manifest.json`, "{}")])).toEqual([
      {
        rule: "generated_catalog",
        path: "olt/references/cli-capabilities",
        observed: "missing index.json",
        detail: "Generated CLI directory requires a catalog index.",
      },
    ]);
  });

  test("handles malformed json in manifest or index.jsonl", () => {
    const findings = findGeneratedCatalogViolations([
      blob(`${root}manifest.json`, "invalid json"),
      blob(`${root}index.jsonl`, "{}"),
      blob(`${root}index.json`, "{}"),
    ]);
    expect(findings).toEqual([
      {
        rule: "generated_catalog",
        path: root,
        observed: "malformed generated catalog",
        detail: "Generated CLI catalog must reference every command exactly once.",
      },
    ]);
  });

  test("handles invalid catalog references", () => {
    const manifest = JSON.stringify({ schema: "olt/cli-capabilities-split@1" });
    const indexLines = [
      JSON.stringify(null),
      JSON.stringify({ file: "" }),
      JSON.stringify({ file: "/absolute/path.json" }),
      JSON.stringify({ file: "../escape.json" }),
      JSON.stringify({ file: 123 }),
    ].join("\n");

    const findings = findGeneratedCatalogViolations([
      blob(`${root}manifest.json`, manifest),
      blob(`${root}index.jsonl`, indexLines),
      blob(`${root}index.json`, "{}"),
    ]);

    expect(findings.filter((f) => f.observed === "invalid catalog reference").length).toBe(5);
  });

  test("rejects duplicate, orphan, stale, and missing generated command catalog entries", () => {
    const manifest = JSON.stringify({
      schema: "olt/cli-capabilities-split@1",
      index_file: "index.jsonl",
      domains: [
        {
          domain: "plan",
          commands_dir: "commands/plan",
          markdown_file: "domains/plan.md",
        },
      ],
    });
    const record = JSON.stringify({
      name: "plan:one",
      file: "commands/plan/one.json",
    });
    const staleRecord = JSON.stringify({
      name: "plan:missing",
      file: "commands/plan/missing.json",
    });
    const findings = findGeneratedCatalogViolations([
      blob(`${root}manifest.json`, manifest),
      blob(`${root}index.jsonl`, `${record}\n${record}\n${staleRecord}\n`),
      blob(`${root}index.json`, "{}"),
      blob(`${root}commands/plan/one.json`, "{}"),
      blob(`${root}commands/plan/orphan.json`, "{}"),
      blob(`${root}commands/plan/index.json`, "{}"),
      blob(`${root}domains/plan.md`, "plan"),
      blob(`${root}domains/index.json`, "{}"),
    ]);

    expect(findings.map((finding) => finding.observed)).toEqual([
      "duplicate catalog reference: commands/plan/one.json",
      "orphan command file: commands/plan/orphan.json",
      "stale catalog reference: commands/plan/missing.json",
    ]);
  });
});
