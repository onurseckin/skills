import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { checkIntentDrift } from "../../../orchestrating-long-tasks/scripts/src/health/intent.ts";
import { cleanupTempRoots, sourceOf, tempRoot, writeTree } from "./fixture.ts";

afterAll(cleanupTempRoots);

const DOCUMENT = [
  "# Spec",
  "",
  "## 1. R1 - the implemented requirement",
  "",
  "- `buildPacket` publishes the contract, recorded by `task:claim`.",
  "- The renderer reads `graph.ts`.",
  "",
  "## 2. R2 - the requirement nothing implements",
  "",
  "- `missingSymbol` decides the wave, exposed as `run:recover`.",
  "",
  "## 3. R3 - the requirement no test touches",
  "",
  "- `untestedSymbol` writes the ledger.",
  "",
  "## 4. R4 - the prose requirement",
  "",
  "- The report must be honest about `unknown` values and never guess.",
].join("\n");

function run(): ReturnType<typeof checkIntentDrift> {
  const root = writeTree(tempRoot("intent"), { "SPEC.md": DOCUMENT, "src/graph.ts": "" });
  return checkIntentDrift({
    documents: [{ relative: "SPEC.md", absolute: join(root, "SPEC.md"), headingLevel: 2 }],
    production: [
      sourceOf("packet.ts", "export function buildPacket(): number {\n  return 1;\n}"),
      sourceOf("ledger.ts", "export function untestedSymbol(): number {\n  return 2;\n}"),
    ],
    tests: [sourceOf("packet.test.ts", "buildPacket();")],
    paths: [join(root, "src/graph.ts")],
    registryApplies: true,
  });
}

describe("every requirement is mapped to code and to a test", () => {
  const result = run();
  const keys = result.findings.map((entry) => entry.key);

  test("a requirement whose symbols and commands exist is not reported", () => {
    expect(keys.filter((key) => key.includes(":R1:"))).toEqual([]);
  });

  test("a symbol the requirement names and the code lacks is reported", () => {
    expect(keys).toContain("intent-missing:SPEC.md:R2:missingSymbol");
  });

  test("a command the requirement names and the registry lacks is reported", () => {
    expect(keys).toContain("intent-missing:SPEC.md:R2:run:recover");
  });

  test("a file the requirement names is resolved by path suffix", () => {
    expect(keys).not.toContain("intent-missing:SPEC.md:R1:graph.ts");
  });

  test("a requirement no test mentions is reported as unproven", () => {
    expect(keys).toContain("intent-untested:SPEC.md:R3");
  });

  test("a requirement with a test that mentions its symbol is not reported as unproven", () => {
    expect(keys).not.toContain("intent-untested:SPEC.md:R1");
  });

  test("a prose requirement is counted as uncheckable rather than passed or failed", () => {
    expect(keys.filter((key) => key.includes(":R4"))).toEqual([]);
    expect(result.limitations.join(" ")).toContain("cannot be checked mechanically");
  });

  test("the number of requirements inspected is reported", () => {
    expect(result.scanned).toBe(4);
  });
});

describe("an artifact the run produces counts as present", () => {
  test("a name no file carries, but the writer spells out, is not drift", () => {
    const root = writeTree(tempRoot("artifact"), {
      "SPEC.md": ["## 1. R1 - handoff", "", "- Writes `handoff.md` at completion."].join("\n"),
    });
    const result = checkIntentDrift({
      documents: [{ relative: "SPEC.md", absolute: join(root, "SPEC.md"), headingLevel: 2 }],
      production: [sourceOf("handoff.ts", 'const path = join(runRoot, "handoff.md");')],
      tests: [sourceOf("handoff.test.ts", 'const p = "handoff.md";')],
      paths: [],
      registryApplies: true,
    });
    expect(result.findings.map((entry) => entry.key)).toEqual([]);
  });
});

describe("a command token is not judged against a registry that does not describe the tree", () => {
  const result = (): ReturnType<typeof checkIntentDrift> => {
    const root = writeTree(tempRoot("foreign-intent"), {
      "SPEC.md": ["## 1. R1 - recovery", "", "- Provides `run:invent`."].join("\n"),
    });
    return checkIntentDrift({
      documents: [{ relative: "SPEC.md", absolute: join(root, "SPEC.md"), headingLevel: 2 }],
      production: [sourceOf("recover.ts", "export function recover(): number {\n  return 1;\n}")],
      tests: [],
      paths: [],
      registryApplies: false,
    });
  };

  test("the command is counted as unclassifiable rather than declared missing", () => {
    const report = result();
    expect(report.findings.map((entry) => entry.key)).toEqual([]);
    expect(report.limitations.join(" ")).toContain("counted as unclassifiable");
  });
});
