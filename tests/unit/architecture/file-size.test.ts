import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const scriptsRoot = join(repoRoot, "orchestrating-long-tasks/scripts");
const testsRoot = join(repoRoot, "tests");

async function filesBelow(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      return entry.isDirectory() ? filesBelow(path) : [path];
    }),
  );
  return nested.flat();
}

describe("runtime architecture", () => {
  test("keeps production and tests within context-sized limits", async () => {
    const prodFiles = (await filesBelow(scriptsRoot)).filter((path) => path.endsWith(".ts"));
    const testFiles = (await filesBelow(testsRoot)).filter((path) => path.endsWith(".ts"));
    const violations: string[] = [];
    for (const path of prodFiles) {
      const lines = (await readFile(path, "utf8")).split(/\r?\n/).length;
      if (lines > 350) violations.push(`${relative(scriptsRoot, path)}: ${lines} > 350`);
    }
    for (const path of testFiles) {
      const lines = (await readFile(path, "utf8")).split(/\r?\n/).length;
      if (lines > 350) violations.push(`${relative(testsRoot, path)}: ${lines} > 350`);
    }
    expect(violations).toEqual([]);
  });

  test("has no runtime package dependencies", async () => {
    const manifest = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
    expect(manifest.dependencies).toBeUndefined();
  });

  test("contains no retired Python runtime or cache artifacts", async () => {
    const paths = (await filesBelow(scriptsRoot)).map((path) => relative(scriptsRoot, path));
    expect(
      paths.filter(
        (path) =>
          path.endsWith(".py") ||
          path.endsWith(".pyc") ||
          path.split(/[\\/]/).includes("__pycache__"),
      ),
    ).toEqual([]);
  });

  test("contains no model-provider SDK or hardcoded API transport", async () => {
    const manifest = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
    const packages = Object.keys({
      ...(manifest.dependencies ?? {}),
      ...(manifest.optionalDependencies ?? {}),
      ...(manifest.peerDependencies ?? {}),
    });
    expect(
      packages.filter((name) =>
        /openai|anthropic|gemini|google-generative|mistral|groq/i.test(name),
      ),
    ).toEqual([]);
    const production = (await filesBelow(join(scriptsRoot, "src"))).filter((path) =>
      path.endsWith(".ts"),
    );
    const hardcoded: string[] = [];
    for (const path of production) {
      const source = await readFile(path, "utf8");
      if (/api\.(openai|anthropic)\.com|generativelanguage\.googleapis\.com/i.test(source)) {
        hardcoded.push(relative(scriptsRoot, path));
      }
    }
    expect(hardcoded).toEqual([]);
  });
});
