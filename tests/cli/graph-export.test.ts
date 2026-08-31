import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { exportGraphJsonCommand } from "../../olt/scripts/src/cli/commands/graph-export.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { setupCompiledRun } from "./task-ops-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("graph-export CLI command", () => {
  test("exports graph as json without out path", async () => {
    const { repo, run } = await setupCompiledRun("graph-export-json-no-out", roots);

    const result = exportGraphJsonCommand({
      repo,
      run,
      format: "json",
      pretty: true,
    });

    expect(result.format).toBe("json");
    expect(result.report).toBeDefined();
    expect(result.report?.nodes.length).toBeGreaterThan(0);
    expect(result.exported_to).toBeUndefined();
  });

  test("exports graph as json to specified out file", async () => {
    const { repo, run } = await setupCompiledRun("graph-export-json-out", roots);
    const outPath = join(repo, "dag-export.json");

    const result = exportGraphJsonCommand({
      repo,
      run,
      format: "json",
      out: outPath,
    });

    expect(result.format).toBe("json");
    expect(result.exported_to).toBe(outPath);
    expect(existsSync(outPath)).toBe(true);

    const content = readFileSync(outPath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.nodes).toBeDefined();
  });

  test("exports graph as visual format (mermaid) with and without out path", async () => {
    const { repo, run } = await setupCompiledRun("graph-export-mermaid", roots);
    const outPath = join(repo, "dag.mmd");

    // With out path
    const result1 = exportGraphJsonCommand({
      repo,
      run,
      format: "mermaid",
      out: outPath,
    });

    expect(result1.format).toBe("mermaid");
    expect(result1.content).toContain("flowchart TD");
    expect(result1.exported_to).toBe(outPath);
    expect(existsSync(outPath)).toBe(true);

    // Without out path
    const result2 = exportGraphJsonCommand({
      repo,
      run,
      format: "mermaid",
    });

    expect(result2.format).toBe("mermaid");
    expect(result2.content).toContain("flowchart TD");
    expect(result2.exported_to).toBeUndefined();
  });

  test("exports graph as visual format (dot)", async () => {
    const { repo, run } = await setupCompiledRun("graph-export-dot", roots);

    const result = exportGraphJsonCommand({
      repo,
      run,
      format: "dot",
    });

    expect(result.format).toBe("dot");
    expect(result.content).toBeDefined();
  });
});
