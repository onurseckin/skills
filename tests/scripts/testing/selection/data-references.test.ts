import { describe, expect, test } from "bun:test";
import {
  buildDataReferenceIndex,
  collectBindings,
  collectDataReferences,
  extractCallArguments,
  extractPathCandidates,
  isDataFile,
  isSelectablePrefix,
  resolvePathExpression,
  selectTestsForDataFile,
  splitTopLevelArguments,
  type DataReferenceOptions,
  type DataReferencePorts,
} from "../../../../scripts/testing/selection/index.ts";
import { resolveAffectedTestFiles } from "../../../../scripts/testing/index.ts";

const REPO = "/repo";

function ports(
  files: Record<string, string>,
  extraPaths: readonly string[] = [],
): DataReferencePorts {
  const present = new Set<string>([...Object.keys(files), ...extraPaths]);
  return {
    readFile: (filePath) => files[filePath] ?? "",
    exists: (filePath) => present.has(filePath),
  };
}

function options(
  files: Record<string, string>,
  extraPaths: readonly string[] = [],
): DataReferenceOptions {
  return { repoRoot: REPO, ports: ports(files, extraPaths) };
}

describe("argument scanning", () => {
  test("splits only top level commas and ignores nested calls, arrays and quoted commas", () => {
    expect(splitTopLevelArguments('root, join(a, b), ["x", "y"], "a,b"')).toEqual([
      "root",
      "join(a, b)",
      '["x", "y"]',
      '"a,b"',
    ]);
  });

  test("returns no parts for an empty argument list", () => {
    expect(splitTopLevelArguments("   ")).toEqual([]);
  });

  test("extracts a balanced argument slice and reports unterminated calls", () => {
    const source = 'const p = join(dirname(a), "b");';
    expect(extractCallArguments(source, source.indexOf("("))).toBe('dirname(a), "b"');
    expect(extractCallArguments('join("a(b", "c"', 4)).toBeNull();
  });

  test("treats parentheses inside string literals as text", () => {
    expect(extractCallArguments('join("a)b", "c")', 4)).toBe('"a)b", "c"');
  });
});

describe("path expression resolution", () => {
  const scope = {
    bindings: new Map<string, string | null>([["root", ""]]),
    selfDirectory: "tests/docs",
  };

  test("resolves literals, cwd, module directory and identifier bindings", () => {
    expect(resolvePathExpression('"olt/agents"', scope)).toBe("olt/agents");
    expect(resolvePathExpression("process.cwd()", scope)).toBe("");
    expect(resolvePathExpression("import.meta.dir", scope)).toBe("tests/docs");
    expect(resolvePathExpression("__dirname", scope)).toBe("tests/docs");
    expect(resolvePathExpression("root", scope)).toBe("");
  });

  test("resolves join, resolve, dirname and normalize against a known base", () => {
    expect(resolvePathExpression('join(root, "olt", "agents")', scope)).toBe("olt/agents");
    expect(resolvePathExpression('resolve(import.meta.dir, "..")', scope)).toBe("tests");
    expect(resolvePathExpression('dirname("docs/book/one.md")', scope)).toBe("docs/book");
    expect(resolvePathExpression('normalize("docs//book")', scope)).toBe("docs/book");
  });

  test("refuses an expression whose base or segment cannot be resolved", () => {
    expect(resolvePathExpression('join(scratch, "docs")', scope)).toBeNull();
    expect(resolvePathExpression('join(root, suffix, "docs")', scope)).toBeNull();
    expect(resolvePathExpression("makePath()", scope)).toBeNull();
    expect(resolvePathExpression("join(root", scope)).toBeNull();
  });

  test("stops recursing once the expression nesting budget is spent", () => {
    expect(resolvePathExpression('join(root, "a")', scope, 7)).toBeNull();
  });
});

describe("binding collection", () => {
  test("chains bindings across declarations in later passes", () => {
    const source = [
      'const docsDir = join(repoRoot, "docs");',
      'const repoRoot = resolve(import.meta.dir, "../..");',
      'const bookDir = join(docsDir, "book");',
    ].join("\n");
    const bindings = collectBindings(source, "tests/docs/book");
    expect(bindings.get("repoRoot")).toBe("tests");
    expect(bindings.get("docsDir")).toBe("tests/docs");
    expect(bindings.get("bookDir")).toBe("tests/docs/book");
  });

  test("records an unresolvable declaration as null", () => {
    const bindings = collectBindings("const scratch = makeTempDir();", "tests");
    expect(bindings.get("scratch")).toBeNull();
  });
});

describe("candidate extraction", () => {
  test("collects call results, bindings and slash bearing literals", () => {
    const source = [
      'const repoRoot = resolve(import.meta.dir, "../../..");',
      'const agents = join(repoRoot, "olt", "agents");',
      'readFileSync(join(repoRoot, "docs", "book", "one.md"));',
      'const label = "olt/references/manifest.json";',
    ].join("\n");
    const candidates = extractPathCandidates(source, "tests/roles/ecosystem");
    expect(candidates).toContain("olt/agents");
    expect(candidates).toContain("docs/book/one.md");
    expect(candidates).toContain("olt/references/manifest.json");
  });

  test("never promotes a bare single segment literal to a candidate", () => {
    const candidates = extractPathCandidates(
      'const name = "README.md";\nwrite(join(scratch, "README.md"));',
      "tests",
    );
    expect(candidates).toEqual([]);
  });
});

describe("prefix eligibility", () => {
  test("accepts repository relative data paths", () => {
    expect(isSelectablePrefix("olt/agents")).toBe(true);
    expect(isSelectablePrefix("docs/book/one.md")).toBe(true);
  });

  test("rejects absolute, escaping, vendored and test file prefixes", () => {
    expect(isSelectablePrefix("")).toBe(false);
    expect(isSelectablePrefix("/etc/passwd")).toBe(false);
    expect(isSelectablePrefix("../outside")).toBe(false);
    expect(isSelectablePrefix("./")).toBe(false);
    expect(isSelectablePrefix("node_modules/pkg")).toBe(false);
    expect(isSelectablePrefix(".git/config")).toBe(false);
    expect(isSelectablePrefix("tests/roles/plan.test.ts")).toBe(false);
  });
});

describe("reference collection", () => {
  test("keeps only referenced paths that exist in the repository", () => {
    const source = [
      'const repoRoot = resolve(import.meta.dir, "../..");',
      'const agentsDir = join(repoRoot, "olt", "agents");',
      'const missing = join(repoRoot, "olt", "ghosts");',
    ].join("\n");
    const references = collectDataReferences("tests/roles/plan.test.ts", {
      repoRoot: REPO,
      ports: ports({ "/repo/tests/roles/plan.test.ts": source }, ["/repo/olt/agents"]),
    });
    expect(references).toEqual(["olt/agents"]);
  });

  test("yields nothing when the test source cannot be read", () => {
    expect(collectDataReferences("tests/gone.test.ts", options({}))).toEqual([]);
  });
});

describe("index construction and selection", () => {
  const rolesSource = 'const dir = join(process.cwd(), "olt", "agents");';
  const docsSource = 'const dir = join(process.cwd(), "docs", "book");';
  const files = {
    "/repo/tests/roles/plan.test.ts": rolesSource,
    "/repo/tests/docs/book.test.ts": docsSource,
  };
  const present = ["/repo/olt/agents", "/repo/docs/book"];

  test("maps each referenced directory to the tests that name it", () => {
    const index = buildDataReferenceIndex(Object.keys(files), options(files, present));
    expect(index.get("olt/agents")).toEqual(["tests/roles/plan.test.ts"]);
    expect(index.get("docs/book")).toEqual(["tests/docs/book.test.ts"]);
  });

  test("selects a test for any file beneath a referenced directory and nothing else", () => {
    const index = buildDataReferenceIndex(Object.keys(files), options(files, present));
    expect(selectTestsForDataFile("olt/agents/mind.yaml", index)).toEqual([
      "tests/roles/plan.test.ts",
    ]);
    expect(selectTestsForDataFile("docs/book/01-foundations.md", index)).toEqual([
      "tests/docs/book.test.ts",
    ]);
    expect(selectTestsForDataFile("olt/agents-archive/mind.yaml", index)).toEqual([]);
    expect(selectTestsForDataFile("lefthook.yml", index)).toEqual([]);
  });

  test("drops a prefix claimed by more tests than the share cap allows", () => {
    const shared: Record<string, string> = {};
    for (let i = 0; i < 20; i += 1) {
      shared[`/repo/tests/shared/t${i}.test.ts`] = rolesSource;
    }
    const capped = buildDataReferenceIndex(Object.keys(shared), {
      repoRoot: REPO,
      ports: ports(shared, present),
      maxPrefixShare: 0.1,
    });
    expect(capped.has("olt/agents")).toBe(false);
    const uncapped = buildDataReferenceIndex(Object.keys(shared), {
      repoRoot: REPO,
      ports: ports(shared, present),
      maxPrefixShare: 1,
    });
    expect(uncapped.get("olt/agents")).toHaveLength(20);
  });
});

describe("data file classification", () => {
  test("separates data files from compiled sources", () => {
    expect(isDataFile("olt/agents/mind.yaml")).toBe(true);
    expect(isDataFile("lefthook.yml")).toBe(true);
    expect(isDataFile("olt/scripts/pulse.sh")).toBe(true);
    expect(isDataFile("scripts/testing/test-changed.ts")).toBe(false);
    expect(isDataFile("tests/roles/plan.test.tsx")).toBe(false);
  });
});

describe("affected test resolution for data changes", () => {
  const allTests = [
    "tests/roles/plan.test.ts",
    "tests/docs/book.test.ts",
    "tests/cli/flags.test.ts",
  ];
  const index = new Map<string, readonly string[]>([
    ["olt/agents", ["tests/roles/plan.test.ts"]],
    ["docs/book", ["tests/docs/book.test.ts"]],
  ]);

  test("selects the manifest tests when an agent manifest changes", () => {
    expect(
      resolveAffectedTestFiles(["olt/agents/mind.yaml"], false, "tests", allTests, index).testFiles,
    ).toEqual(["tests/roles/plan.test.ts"]);
  });

  test("selects only the docs tests when a chapter changes", () => {
    const resolved = resolveAffectedTestFiles(
      ["docs/book/01-foundations.md"],
      false,
      "tests",
      allTests,
      index,
    );
    expect(resolved.all).toBe(false);
    expect(resolved.testFiles).toEqual(["tests/docs/book.test.ts"]);
  });

  test("drags nothing in for an unreferenced data file", () => {
    expect(
      resolveAffectedTestFiles(["docs/archive/old/PLAN.md"], false, "tests", allTests, index)
        .testFiles,
    ).toEqual([]);
  });

  test("leaves source file selection to the existing stem mapping", () => {
    expect(
      resolveAffectedTestFiles(["olt/scripts/src/cli/flags.ts"], false, "tests", allTests, index)
        .testFiles,
    ).toEqual(["tests/cli/flags.test.ts"]);
  });
});
