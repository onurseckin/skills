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

describe("a token naming another application's own identifier is exempt, not missing", () => {
  const result = (): ReturnType<typeof checkIntentDrift> => {
    const root = writeTree(tempRoot("external-intent"), {
      "SPEC.md": [
        "## 1. R1 - host research",
        "",
        "- Claude Code exposes `SendMessage`; the harness never defines it.",
      ].join("\n"),
    });
    return checkIntentDrift({
      documents: [{ relative: "SPEC.md", absolute: join(root, "SPEC.md"), headingLevel: 2 }],
      production: [],
      tests: [],
      paths: [],
      registryApplies: true,
    });
  };

  test("the host's own tool name is not reported as a missing symbol", () => {
    const report = result();
    expect(report.findings.map((entry) => entry.key)).toEqual([]);
  });

  test("the exemption is counted and disclosed, not silently dropped", () => {
    const report = result();
    const disclosed = report.limitations.join(" ");
    expect(disclosed).toContain("1 token(s) name another application's own identifier");
    // The requirement had one token and it was exempted, so the check now knows nothing about R1.
    // Reporting the token count alone would let that silence pass for a clean result.
    expect(disclosed).toContain("1 requirement(s) named nothing checkable once those exemptions");
  });

  test("a requirement that still names its own symbol keeps being judged", () => {
    const root = writeTree(tempRoot("external-mixed"), {
      "SPEC.md": [
        "## 1. R1 - host research",
        "",
        "- Claude Code exposes `SendMessage`; this repo records it through `HostProbe`.",
      ].join("\n"),
    });
    const report = checkIntentDrift({
      documents: [{ relative: "SPEC.md", absolute: join(root, "SPEC.md"), headingLevel: 2 }],
      production: [],
      tests: [],
      paths: [],
      registryApplies: true,
    });
    expect(report.findings.map((entry) => entry.detail)).toEqual([
      "R1 names the symbol `HostProbe`, which is not present in the scanned source",
      "R1 names 1 symbol(s) and no test in the suite mentions any of them",
    ]);
    expect(report.limitations.join(" ")).toContain("0 requirement(s) named nothing checkable");
  });
});

describe("a requirement the owner marked deferred is excluded, not judged missing or untested", () => {
  const result = (): ReturnType<typeof checkIntentDrift> => {
    const root = writeTree(tempRoot("owner-deferred"), {
      "BACKLOG.md": [
        "## 1. B99 - a deferred decision `deferred by owner`",
        "",
        "- Would have named `neverWritten` and read `never-written.md`.",
        "",
        "## 2. B100 - research still headed toward landing `research-in-flight`",
        "",
        "- Names `alsoNeverWritten`.",
      ].join("\n"),
    });
    return checkIntentDrift({
      documents: [{ relative: "BACKLOG.md", absolute: join(root, "BACKLOG.md"), headingLevel: 2 }],
      production: [],
      tests: [],
      paths: [],
      registryApplies: true,
    });
  };

  test("the deferred requirement raises no finding of either kind", () => {
    const report = result();
    expect(report.findings.map((entry) => entry.key)).not.toEqual(
      expect.arrayContaining([expect.stringContaining("B99")]),
    );
  });

  test("a requirement with a different, non-terminal status is still judged", () => {
    const report = result();
    expect(report.findings.map((entry) => entry.key)).toContain(
      "intent-missing:BACKLOG.md:B100:alsoNeverWritten",
    );
  });

  test("the exemption is counted and disclosed, not silently dropped", () => {
    const report = result();
    expect(report.limitations.join(" ")).toContain(
      "1 requirement(s) are marked `deferred by owner`",
    );
  });

  test("scanned still counts the deferred requirement", () => {
    expect(result().scanned).toBe(2);
  });
});

describe("health/allowlist.ts quoting a path token is not evidence the repo uses it", () => {
  // An allowance's own `key` necessarily repeats the finding's token verbatim (matches() requires
  // an exact string match), so without this exclusion, allowlisting a missing-file finding would
  // make the token look "written" and the check would call the allowance that just suppressed it
  // unnecessary - self-cancelling the moment someone tries to use it.
  const result = (production: Parameters<typeof checkIntentDrift>[0]["production"]) => {
    const root = writeTree(tempRoot("allowlist-self-reference"), {
      "SPEC.md": ["## 1. R1 - a produced artifact", "", "- Produces `.tmp/scratch/build.ts`."].join(
        "\n",
      ),
    });
    return checkIntentDrift({
      documents: [{ relative: "SPEC.md", absolute: join(root, "SPEC.md"), headingLevel: 2 }],
      production,
      tests: [],
      paths: [],
      registryApplies: true,
    });
  };

  test("the token appearing only inside health/allowlist.ts still reads as missing", () => {
    const report = result([
      sourceOf("health/allowlist.ts", 'key: "intent-missing:SPEC.md:R1:.tmp/scratch/build.ts",'),
    ]);
    expect(report.findings.map((entry) => entry.key)).toContain(
      "intent-missing:SPEC.md:R1:.tmp/scratch/build.ts",
    );
  });

  test("the same token in any other production file still counts as written", () => {
    const report = result([sourceOf("core/paths.ts", 'const p = ".tmp/scratch/build.ts";')]);
    expect(report.findings.map((entry) => entry.key)).not.toContain(
      "intent-missing:SPEC.md:R1:.tmp/scratch/build.ts",
    );
  });
});

describe("a token naming a test file's own path is proven by existing, not by being quoted elsewhere", () => {
  test("a `.test.ts` token in the repo's own tests is not reported as untested", () => {
    const root = writeTree(tempRoot("self-proving-own-tests"), {
      "SPEC.md": [
        "## 1. R1 - completeness",
        "",
        "- Proven by `tests/unit/completeness.test.ts`.",
      ].join("\n"),
    });
    const testPath = join(root, "tests/unit/completeness.test.ts");
    const report = checkIntentDrift({
      documents: [{ relative: "SPEC.md", absolute: join(root, "SPEC.md"), headingLevel: 2 }],
      production: [],
      // The test file's own content never quotes its own path, so a search of `tests` for the
      // literal token text would fail even though the file is exactly the proof R1 cites.
      tests: [sourceOf("tests/unit/completeness.test.ts", "test('covers it', () => {});")],
      paths: [testPath],
      registryApplies: true,
    });
    expect(report.findings.map((entry) => entry.key)).not.toContain("intent-untested:SPEC.md:R1");
    expect(report.limitations.join(" ")).toContain("1 token(s) name a `.test.ts`/`.spec.ts` file");
  });

  test("a `.test.ts` token that lives only in a consumer repo is still proven", () => {
    // Mirrors runHealthCheck: a consumer's sources (tests included) load into `production`, never
    // into `tests`, so `present(input.tests, token)` could never see this file even if it quoted
    // its own path. `paths` is the only signal both repos share.
    const root = writeTree(tempRoot("self-proving-consumer"), {
      "SPEC.md": [
        "## 1. R1 - renderer tolerance",
        "",
        "- Proven by `consumer/src/schema.test.ts`.",
      ].join("\n"),
    });
    const testPath = join(root, "consumer/src/schema.test.ts");
    const report = checkIntentDrift({
      documents: [{ relative: "SPEC.md", absolute: join(root, "SPEC.md"), headingLevel: 2 }],
      production: [sourceOf("consumer/src/schema.test.ts", "test('ignores junk', () => {});")],
      tests: [],
      paths: [testPath],
      registryApplies: true,
    });
    expect(report.findings.map((entry) => entry.key)).not.toContain("intent-untested:SPEC.md:R1");
  });

  test("a non-test file token still requires a test to mention it", () => {
    const root = writeTree(tempRoot("still-checked"), {
      "SPEC.md": ["## 1. R1 - the ledger", "", "- Implemented in `src/ledger.ts`."].join("\n"),
    });
    const report = checkIntentDrift({
      documents: [{ relative: "SPEC.md", absolute: join(root, "SPEC.md"), headingLevel: 2 }],
      production: [sourceOf("src/ledger.ts", "export const x = 1;")],
      tests: [],
      paths: [join(root, "src/ledger.ts")],
      registryApplies: true,
    });
    expect(report.findings.map((entry) => entry.key)).toContain("intent-untested:SPEC.md:R1");
  });

  test("a .test.ts token that only appears as text in an unrelated file is not self-proven", () => {
    // `written` exists so a run-produced artifact (e.g. `graph.json`) can be named as a literal
    // without existing in the scanned tree. A test file is not that kind of artifact: a comment in
    // some other module merely spelling out a test's name proves nothing about that test existing
    // or running, so it must not satisfy the self-proving path (guards the fix above the `isTest`
    // branch, which intentionally excludes `written` for test-kind tokens).
    const root = writeTree(tempRoot("phantom-test-mention"), {
      "SPEC.md": [
        "## 1. R1 - a requirement citing a test file that does not exist",
        "",
        "- Proven by `tests/unit/phantom.test.ts`.",
      ].join("\n"),
    });
    const report = checkIntentDrift({
      documents: [{ relative: "SPEC.md", absolute: join(root, "SPEC.md"), headingLevel: 2 }],
      production: [sourceOf("some/generator.ts", "// see tests/unit/phantom.test.ts for context")],
      tests: [],
      // The phantom test file is deliberately absent from `paths`: it does not exist on disk.
      paths: [join(root, "SPEC.md")],
      registryApplies: true,
    });
    expect(report.findings.map((entry) => entry.key)).toContain("intent-untested:SPEC.md:R1");
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
