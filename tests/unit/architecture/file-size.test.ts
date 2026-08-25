import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const scriptsRoot = join(repoRoot, "olt/scripts");
const testsRoot = join(repoRoot, "tests");

/**
 * A ceiling that catches a file growing past what fits comfortably in one reading, not a target to
 * design against: a file nearing it is split when it has a real seam, and left whole when splitting
 * it would only scatter one idea across two files to satisfy the counter.
 */
const MAX_LINES = 4000;

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
    for (const [root, files] of [
      [scriptsRoot, prodFiles],
      [testsRoot, testFiles],
    ] as const) {
      for (const path of files) {
        const lines = (await readFile(path, "utf8")).split(/\r?\n/).length;
        if (lines > MAX_LINES) violations.push(`${relative(root, path)}: ${lines} > ${MAX_LINES}`);
      }
    }
    expect(violations).toEqual([]);
  });

  test("no test module freezes a clock where it is evaluated", async () => {
    const files = (await filesBelow(testsRoot)).filter((path) => path.endsWith(".ts"));
    const frozen: string[] = [];
    for (const path of files) {
      const source = await readFile(path, "utf8");
      source.split(/\r?\n/).forEach((line, index) => {
        // A clock read straight into a module-scope binding is taken when the file is imported,
        // which under a parallel run is long before the body that depends on it: the window it
        // names has already passed, and a fixture stamping files against it refuses what it should
        // accept. A binding that holds a function reading the clock later is not that shape.
        if (
          /^(export )?(const|let|var) [^=]*=\s*(Date\.now\(\)|performance\.now\(\)|new Date\(\s*(\)|Date\.now\(\)|performance\.now\(\)))/.test(
            line,
          )
        )
          frozen.push(`${relative(testsRoot, path)}:${index + 1}`);
      });
    }
    expect(frozen).toEqual([]);
  });

  test("the runtime package claims no test suite of its own", async () => {
    const manifest = JSON.parse(await readFile(join(scriptsRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    // The suite lives at the repo root. A `test` script here would have to name a `tests` directory
    // below `scripts`, which would split the suite and duplicate the runner configuration.
    expect(manifest.scripts?.test).toBeUndefined();
  });

  test("has only essential parser dependencies", async () => {
    const manifest = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(["js-yaml"]);
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

  /**
   * `telemetry/collectors/common.ts` polls `api.anthropic.com/api/oauth/usage` for the signed-in
   * user's own live quota/usage numbers — the same host-observed telemetry this file's collectors
   * already read from CLI-emitted files and env vars elsewhere in this tree, just sourced over
   * HTTP instead of disk. It is not an inference/completion call and ships no model-provider SDK;
   * this check exists to keep raw LLM inference transport out of the harness, not to ban reading a
   * host's own usage endpoint. See commit 2a0d9bcb, where this collector was added.
   */
  const HARDCODED_TRANSPORT_EXEMPTIONS: readonly string[] = ["src/telemetry/collectors/common.ts"];

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
    expect(hardcoded).toEqual(HARDCODED_TRANSPORT_EXEMPTIONS);
  });

  test("every hardcoded-transport exemption still covers a file that exists", async () => {
    for (const exemption of HARDCODED_TRANSPORT_EXEMPTIONS) {
      const source = await readFile(join(scriptsRoot, exemption), "utf8");
      expect(/api\.(openai|anthropic)\.com|generativelanguage\.googleapis\.com/i.test(source)).toBe(
        true,
      );
    }
  });
});
