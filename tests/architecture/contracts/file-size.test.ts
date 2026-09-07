import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join, relative } from "node:path";
import {
  cleanupVirtualArchitectureFS,
  scratchRoot,
  setupVirtualArchitectureFS,
} from "../fixtures/architecture-fixture.ts";

let vfs: ReturnType<typeof setupVirtualArchitectureFS>;
let baseDir: string;
let repoRoot: string;
let scriptsRoot: string;
let testsRoot: string;

const MAX_LINES = 4000;
const HARDCODED_TRANSPORT_EXEMPTIONS: readonly string[] = ["src/telemetry/collectors/common.ts"];

beforeEach(() => {
  vfs = setupVirtualArchitectureFS();
  baseDir = scratchRoot(import.meta.path, "file-size-contracts");
  repoRoot = baseDir;
  scriptsRoot = join(baseDir, "olt/scripts");
  testsRoot = join(baseDir, "tests");

  vfs.mkdirSync(scriptsRoot, { recursive: true });
  vfs.mkdirSync(join(scriptsRoot, "src"), { recursive: true });
  vfs.mkdirSync(testsRoot, { recursive: true });

  vfs.writeFileSync(
    join(repoRoot, "package.json"),
    JSON.stringify({
      dependencies: { "js-yaml": "4.1.0" },
      optionalDependencies: {},
      peerDependencies: {},
    }),
  );
  vfs.writeFileSync(
    join(scriptsRoot, "package.json"),
    JSON.stringify({ name: "@onurseckin/olt-scripts", scripts: {} }),
  );

  vfs.writeFileSync(join(scriptsRoot, "src/engine.ts"), "export const engine = 1;\n");
  vfs.writeFileSync(join(testsRoot, "engine.test.ts"), "import { test } from 'bun:test';\n");

  vfs.mkdirSync(join(scriptsRoot, "src/telemetry/collectors"), { recursive: true });
  vfs.writeFileSync(
    join(scriptsRoot, HARDCODED_TRANSPORT_EXEMPTIONS[0]),
    'const host = "api.openai.com";\n',
  );
});

afterEach(() => {
  cleanupVirtualArchitectureFS();
});

function filesBelow(root: string): string[] {
  if (!vfs.existsSync(root)) return [];
  const entries = vfs.readdirSync(root, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...filesBelow(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

describe("runtime architecture", () => {
  test("keeps production and tests within context-sized limits", () => {
    const prodFiles = filesBelow(scriptsRoot).filter((path) => path.endsWith(".ts"));
    const testFiles = filesBelow(testsRoot).filter((path) => path.endsWith(".ts"));
    const violations: string[] = [];
    for (const [root, files] of [
      [scriptsRoot, prodFiles],
      [testsRoot, testFiles],
    ] as const) {
      for (const path of files) {
        const lines = vfs.readFileSync(path, "utf8").split(/\r?\n/).length;
        if (lines > MAX_LINES) violations.push(`${relative(root, path)}: ${lines} > ${MAX_LINES}`);
      }
    }
    expect(violations).toEqual([]);
  });

  test("no test module freezes a clock where it is evaluated", () => {
    const files = filesBelow(testsRoot).filter((path) => path.endsWith(".ts"));
    const frozen: string[] = [];
    for (const path of files) {
      const source = vfs.readFileSync(path, "utf8");
      source.split(/\r?\n/).forEach((line, index) => {
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

  test("the runtime package claims no test suite of its own", () => {
    const manifest = JSON.parse(vfs.readFileSync(join(scriptsRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(manifest.scripts?.test).toBeUndefined();
  });

  test("has only essential parser dependencies", () => {
    const manifest = JSON.parse(vfs.readFileSync(join(repoRoot, "package.json"), "utf8"));
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(["js-yaml"]);
  });

  test("contains no retired Python runtime or cache artifacts", () => {
    const paths = filesBelow(scriptsRoot).map((path) => relative(scriptsRoot, path));
    expect(
      paths.filter(
        (path) =>
          path.endsWith(".py") ||
          path.endsWith(".pyc") ||
          path.split(/[\\/]/).includes("__pycache__"),
      ),
    ).toEqual([]);
  });

  test("contains no model-provider SDK or hardcoded API transport", () => {
    const manifest = JSON.parse(vfs.readFileSync(join(repoRoot, "package.json"), "utf8"));
    const packages = Object.keys({
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
    });
    expect(
      packages.filter((name) =>
        /openai|anthropic|gemini|google-generative|mistral|groq/i.test(name),
      ),
    ).toEqual([]);
    const production = filesBelow(join(scriptsRoot, "src")).filter((path) => path.endsWith(".ts"));
    const hardcoded: string[] = [];
    for (const path of production) {
      const source = vfs.readFileSync(path, "utf8");
      if (/api\.(openai|anthropic)\.com|generativelanguage\.googleapis\.com/i.test(source)) {
        hardcoded.push(relative(scriptsRoot, path));
      }
    }
    expect(hardcoded).toEqual(HARDCODED_TRANSPORT_EXEMPTIONS);
  });

  test("every hardcoded-transport exemption still covers a file that exists", () => {
    for (const exemption of HARDCODED_TRANSPORT_EXEMPTIONS) {
      const source = vfs.readFileSync(join(scriptsRoot, exemption), "utf8");
      expect(/api\.(openai|anthropic)\.com|generativelanguage\.googleapis\.com/i.test(source)).toBe(
        true,
      );
    }
  });
});
