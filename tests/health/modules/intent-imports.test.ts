import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { checkIntentDrift } from "../../../olt/scripts/src/health/intent.ts";
import { cleanupTempRoots, sourceOf, tempRoot, writeTree } from "../fixture.ts";

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

describe("Health Modules - Intent Drift & Symbol Mapping", () => {
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
});
