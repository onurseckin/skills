import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  analyzeInertness,
  auditEngineWiring,
  collectOptionReadSet,
  defectKey,
  loadEngineWiringDocuments,
  type SourceDocument,
} from "../../../../olt/scripts/src/reporting/doctor/wiring/index.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";

export const engineWiringPredicateSuiteName =
  "Doctor engine wiring guard - detection predicate, vacuity and synthetic instances";

const TYPES_MODULE = "olt/scripts/src/reporting/doctor/types.ts";
const COLLECTOR = "olt/scripts/src/reporting/doctor/diagnostic-collector.ts";

const HEALTHY_ENGINE: SourceDocument = {
  path: "olt/scripts/src/reporting/doctor/healthy-engine.ts",
  text: [
    'import type { DoctorCheckEngineResult } from "./types.ts";',
    "export interface HealthyOptions {",
    "  readonly repoRoot?: string | undefined;",
    "}",
    "export function checkHealthy(options: HealthyOptions = {}): DoctorCheckEngineResult {",
    "  const root = options.repoRoot ?? process.cwd();",
    '  const findings = root.length === 0 ? [{ code: "X", severity: "ERROR" as const, engine: "checkHealthy", message: "empty" }] : [];',
    '  return { engine: "checkHealthy", passed: findings.length === 0, findings };',
    "}",
  ].join("\n"),
};

const ORPHANED_ENGINE: SourceDocument = {
  path: "olt/scripts/src/reporting/doctor/orphan-engine.ts",
  text: [
    'import type { DoctorCheckEngineResult } from "./types.ts";',
    "export function checkOrphaned(): DoctorCheckEngineResult {",
    '  return { engine: "checkOrphaned", passed: true, findings: [] };',
    "}",
  ].join("\n"),
};

const HOLLOW_ENGINE: SourceDocument = {
  path: "olt/scripts/src/reporting/doctor/hollow-engine.ts",
  text: [
    'import type { DoctorCheckEngineResult, DoctorDiagnosticFinding } from "./types.ts";',
    "export interface HollowOptions {",
    "  readonly samples?: readonly string[] | undefined;",
    "}",
    "export function checkHollow(options: HollowOptions = {}): DoctorCheckEngineResult {",
    "  const findings: DoctorDiagnosticFinding[] = [];",
    "  if (options.samples && options.samples.length === 0) {",
    '    findings.push({ code: "EMPTY", severity: "ERROR", engine: "checkHollow", message: "no samples" });',
    "  }",
    '  return { engine: "checkHollow", passed: findings.length === 0, findings };',
    "}",
  ].join("\n"),
};

const FALLBACK_ENGINE: SourceDocument = {
  path: "olt/scripts/src/reporting/doctor/fallback-engine.ts",
  text: [
    'import { loadSamples } from "../samples/index.ts";',
    'import type { DoctorCheckEngineResult, DoctorDiagnosticFinding } from "./types.ts";',
    "export interface FallbackOptions {",
    "  readonly samples?: readonly string[] | undefined;",
    "}",
    "export function checkFallback(options: FallbackOptions = {}): DoctorCheckEngineResult {",
    "  const samples = options.samples ?? loadSamples();",
    "  const findings: DoctorDiagnosticFinding[] = [];",
    "  if (samples.length === 0) {",
    '    findings.push({ code: "EMPTY", severity: "ERROR", engine: "checkFallback", message: "no samples" });',
    "  }",
    '  return { engine: "checkFallback", passed: findings.length === 0, findings };',
    "}",
  ].join("\n"),
};

const IGNORING_ENGINE: SourceDocument = {
  path: "olt/scripts/src/reporting/doctor/ignoring-engine.ts",
  text: [
    'import type { DoctorCheckEngineResult, DoctorDiagnosticFinding } from "./types.ts";',
    "export interface IgnoringOptions {",
    "  readonly samples?: readonly string[] | undefined;",
    "  readonly repoRoot?: string | undefined;",
    "}",
    "export function checkIgnoring(options: IgnoringOptions = {}): DoctorCheckEngineResult {",
    "  const findings: DoctorDiagnosticFinding[] = [];",
    "  if (options.samples && options.samples.length === 0) {",
    '    findings.push({ code: "EMPTY", severity: "ERROR", engine: "checkIgnoring", message: "no samples" });',
    "  }",
    '  return { engine: "checkIgnoring", passed: findings.length === 0, findings };',
    "}",
  ].join("\n"),
};

const FORWARDING_ENGINE: SourceDocument = {
  path: "olt/scripts/src/reporting/doctor/forwarding-engine.ts",
  text: [
    'import type { DoctorCheckEngineResult, DoctorDiagnosticFinding } from "./types.ts";',
    "export interface ForwardingOptions {",
    "  readonly samples?: readonly string[] | undefined;",
    "  readonly repoRoot?: string | undefined;",
    "}",
    "function summarize(input: ForwardingOptions): number {",
    "  return (input.repoRoot ?? '').length;",
    "}",
    "export function checkForwarding(options: ForwardingOptions = {}): DoctorCheckEngineResult {",
    "  const findings: DoctorDiagnosticFinding[] = [];",
    "  if (summarize(options) === 0) {",
    '    findings.push({ code: "EMPTY", severity: "ERROR", engine: "checkForwarding", message: "no root" });',
    "  }",
    '  return { engine: "checkForwarding", passed: findings.length === 0, findings };',
    "}",
  ].join("\n"),
};

const TYPES_STUB: SourceDocument = {
  path: TYPES_MODULE,
  text: "export interface DoctorCheckEngineResult { readonly engine: string }\n",
};

function collector(body: readonly string[]): SourceDocument {
  return { path: COLLECTOR, text: ["export function collect(): void {", ...body, "}"].join("\n") };
}

const WIRED_HEALTHY = collector(['  checkHealthy({ repoRoot: "." });']);

function audit(documents: readonly SourceDocument[]): ReturnType<typeof auditEngineWiring> {
  return auditEngineWiring([TYPES_STUB, ...documents]);
}

describe(engineWiringPredicateSuiteName, () => {
  test("an engine invoked with real arguments is not a defect", () => {
    const report = audit([HEALTHY_ENGINE, WIRED_HEALTHY]);
    expect(report.exportedEngines).toEqual(["checkHealthy"]);
    expect(report.invokedEngines).toEqual(["checkHealthy"]);
    expect(report.defects).toEqual([]);
    expect(report.passed).toBe(true);
  });

  test("removing the only call site turns a healthy engine into a reported defect", () => {
    const report = audit([HEALTHY_ENGINE, collector(["  return;"])]);
    expect(report.defects.map(defectKey)).toEqual(["checkHealthy|exported-but-never-invoked"]);
    expect(report.introduced.map(defectKey)).toEqual(["checkHealthy|exported-but-never-invoked"]);
    expect(report.passed).toBe(false);
  });

  test("a synthetic third instance that is never invoked fails the guard", () => {
    const report = audit([HEALTHY_ENGINE, ORPHANED_ENGINE, WIRED_HEALTHY]);
    const introduced = report.introduced;
    expect(introduced.length).toBe(1);
    expect(introduced[0]?.engine).toBe("checkOrphaned");
    expect(introduced[0]?.condition).toBe("exported-but-never-invoked");
    expect(introduced[0]?.declaredAt).toBe("olt/scripts/src/reporting/doctor/orphan-engine.ts:2");
    expect(report.passed).toBe(false);
  });

  test("a synthetic third instance wired with zero arguments and no input fails the guard", () => {
    const report = audit([
      HEALTHY_ENGINE,
      HOLLOW_ENGINE,
      collector(['  checkHealthy({ repoRoot: "." });', "  checkHollow();"]),
    ]);
    expect(report.introduced.map(defectKey)).toEqual(["checkHollow|invoked-but-cannot-fail"]);
    expect(report.introduced[0]?.evidence).toContain("zero arguments");
    expect(report.passed).toBe(false);
  });

  test("a zero-argument engine with a real acquisition fallback is not a defect", () => {
    const report = audit([FALLBACK_ENGINE, collector(["  checkFallback();"])]);
    expect(report.invokedEngines).toEqual(["checkFallback"]);
    expect(report.defects).toEqual([]);
    const verdict = analyzeInertness(FALLBACK_ENGINE, "checkFallback");
    expect(verdict.inert).toBe(false);
    expect(verdict.reason).toContain("loadSamples");
  });

  test("the inertness verdict separates a closed body from an acquiring body", () => {
    const hollow = analyzeInertness(HOLLOW_ENGINE, "checkHollow");
    expect(hollow.inert).toBe(true);
    expect(hollow.reason).toContain("closed computation");
    const healthy = analyzeInertness(HEALTHY_ENGINE, "checkHealthy");
    expect(healthy.inert).toBe(false);
    expect(healthy.reason).toContain("ambient state");
  });

  test("adding an acquisition to a hollow engine clears the defect", () => {
    const repaired: SourceDocument = {
      path: HOLLOW_ENGINE.path,
      text: HOLLOW_ENGINE.text
        .replace(
          "  const findings: DoctorDiagnosticFinding[] = [];",
          [
            "  const samples = options.samples ?? loadSamples();",
            "  const findings: DoctorDiagnosticFinding[] = samples.length === 0 ? [] : [];",
          ].join("\n"),
        )
        .replace(
          'import type { DoctorCheckEngineResult, DoctorDiagnosticFinding } from "./types.ts";',
          [
            'import { loadSamples } from "../samples/index.ts";',
            'import type { DoctorCheckEngineResult, DoctorDiagnosticFinding } from "./types.ts";',
          ].join("\n"),
        ),
    };
    expect(repaired.text).toContain("loadSamples");
    const report = audit([repaired, collector(["  checkHollow();"])]);
    expect(report.defects).toEqual([]);
    expect(report.passed).toBe(true);
  });

  test("an empty literal argument does not clear the inert verdict", () => {
    const report = audit([HOLLOW_ENGINE, collector(["  checkHollow({ samples: [] });"])]);
    expect(report.defects.map(defectKey)).toEqual(["checkHollow|invoked-but-cannot-fail"]);
    expect(report.defects[0]?.evidence).toContain("empty literal argument 'samples: []'");
    expect(report.passed).toBe(false);
  });

  test("replacing that empty literal with a runtime value clears the defect", () => {
    const report = audit([HOLLOW_ENGINE, collector(["  checkHollow({ samples: gathered });"])]);
    expect(report.defects).toEqual([]);
    expect(report.passed).toBe(true);
  });

  test("an empty object literal and an explicit undefined are both inert arguments", () => {
    const braces = audit([HOLLOW_ENGINE, collector(["  checkHollow({});"])]);
    expect(braces.defects.map(defectKey)).toEqual(["checkHollow|invoked-but-cannot-fail"]);
    expect(braces.defects[0]?.evidence).toContain("empty object literal argument");
    const nothing = audit([HOLLOW_ENGINE, collector(["  checkHollow(undefined);"])]);
    expect(nothing.defects.map(defectKey)).toEqual(["checkHollow|invoked-but-cannot-fail"]);
    expect(nothing.defects[0]?.evidence).toContain("explicitly undefined argument");
  });

  test("null, empty string and zero are observable values, not empty literals", () => {
    for (const literal of ["null", '""', "0", "false"]) {
      const report = audit([HOLLOW_ENGINE, collector([`  checkHollow({ samples: ${literal} });`])]);
      expect(report.defects).toEqual([]);
    }
  });

  test("an argument the engine body never reads does not clear the inert verdict", () => {
    const report = audit([IGNORING_ENGINE, collector(["  checkIgnoring({ repoRoot: root });"])]);
    expect(report.defects.map(defectKey)).toEqual(["checkIgnoring|invoked-but-cannot-fail"]);
    expect(report.defects[0]?.evidence).toContain(
      "argument 'repoRoot' passed but never read in the engine body",
    );
    expect(report.passed).toBe(false);
  });

  test("passing an argument the engine body does read clears the defect", () => {
    const read = audit([IGNORING_ENGINE, collector(["  checkIgnoring({ samples: values });"])]);
    expect(read.defects).toEqual([]);
    const mixed = audit([
      IGNORING_ENGINE,
      collector(["  checkIgnoring({ repoRoot: root, samples: values });"]),
    ]);
    expect(mixed.defects).toEqual([]);
  });

  test("an engine that forwards its whole options object has an undecidable read set", () => {
    const readSet = collectOptionReadSet(FORWARDING_ENGINE, "checkForwarding");
    expect(readSet.decidable).toBe(false);
    expect(readSet.reason).toContain("summarize(options)");
    const report = audit([
      FORWARDING_ENGINE,
      collector(["  checkForwarding({ repoRoot: root });"]),
    ]);
    expect(report.defects).toEqual([]);
    expect(report.passed).toBe(true);
  });

  test("a decidable read set names exactly the properties the body reads", () => {
    const readSet = collectOptionReadSet(IGNORING_ENGINE, "checkIgnoring");
    expect(readSet.decidable).toBe(true);
    expect([...readSet.names].sort()).toEqual(["samples"]);
  });

  test("a spread argument is opaque, so a spread call site is never reported", () => {
    const report = audit([
      HOLLOW_ENGINE,
      collector(["  checkHollow({ ...(ready ? { samples } : {}) });"]),
    ]);
    expect(report.defects).toEqual([]);
  });

  test("a re-exporting barrel is not mistaken for a call site", () => {
    const barrel: SourceDocument = {
      path: "olt/scripts/src/reporting/doctor/engines.ts",
      text: [
        'import { checkOrphaned } from "./orphan-engine.ts";',
        "export { checkOrphaned };",
      ].join("\n"),
    };
    const report = audit([ORPHANED_ENGINE, barrel]);
    expect(report.invokedEngines).toEqual([]);
    expect(report.defects.map(defectKey)).toEqual(["checkOrphaned|exported-but-never-invoked"]);
  });
});

describe(`${engineWiringPredicateSuiteName} - document loader`, () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | null = null;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    if (session) {
      session.cleanup();
      session = null;
    }
  });

  test("the loader collects non-test TypeScript sources and skips vendored trees", () => {
    vfs.mkdirSync("/virtual/repo/olt/scripts/src/reporting/doctor", { recursive: true });
    vfs.mkdirSync("/virtual/repo/olt/scripts/node_modules/vendor", { recursive: true });
    vfs.writeFileSync(
      "/virtual/repo/olt/scripts/src/reporting/doctor/orphan-engine.ts",
      ORPHANED_ENGINE.text,
    );
    vfs.writeFileSync(
      "/virtual/repo/olt/scripts/src/reporting/doctor/orphan-engine.test.ts",
      "export const ignored = 1;\n",
    );
    vfs.writeFileSync(
      "/virtual/repo/olt/scripts/node_modules/vendor/index.ts",
      "export const v = 1;\n",
    );

    const loaded = loadEngineWiringDocuments("/virtual/repo", ["olt/scripts"]);
    expect(loaded.map((document) => document.path)).toEqual([
      "olt/scripts/src/reporting/doctor/orphan-engine.ts",
    ]);
    expect(loaded[0]?.text).toContain("checkOrphaned");

    const report = auditEngineWiring(loaded);
    expect(report.defects.map(defectKey)).toEqual(["checkOrphaned|exported-but-never-invoked"]);
  });
});
