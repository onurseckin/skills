import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ALL_LEGACY_IMPORT_PATTERNS,
  assertValidCognitiveAuditingImports,
  AuditorCursorStore,
  auditAuditingSubsystem,
  auditCognitiveAuditingDirectory,
  auditMindPulseHelper,
  CANONICAL_AUDITING_BARREL_PATH,
  CANONICAL_COGNITIVE_BARREL_PATH,
  CANONICAL_COGNITIVE_CURSOR_PATH,
  CANONICAL_COGNITIVE_DIR,
  CANONICAL_COGNITIVE_ENGINE_PATH,
  CANONICAL_COGNITIVE_PULSE_AUDITOR_PATH,
  CANONICAL_COGNITIVE_SKILL_AUDITOR_PATH,
  CANONICAL_COGNITIVE_SYMBOLS,
  CANONICAL_COGNITIVE_TYPES_PATH,
  CANONICAL_LAST_PULSE_DIRECT_SPECIFIER_FROM_COGNITIVE,
  CANONICAL_LAST_PULSE_PATH,
  CANONICAL_LAST_PULSE_SPECIFIER_FROM_AUDITING,
  CANONICAL_LAST_PULSE_SPECIFIER_FROM_COGNITIVE,
  CANONICAL_LAST_PULSE_SYMBOLS,
  CANONICAL_META_BARREL_PATH,
  CANONICAL_META_SPECIFIER_FROM_AUDITING,
  CANONICAL_META_SPECIFIER_FROM_COGNITIVE,
  CANONICAL_META_SYMBOLS,
  CANONICAL_PULSE_BARREL_PATH,
  CANONICAL_WITNESS_BARREL_PATH,
  CANONICAL_WITNESS_SPECIFIER_FROM_AUDITING,
  CANONICAL_WITNESS_SPECIFIER_FROM_COGNITIVE,
  CANONICAL_WITNESS_SYMBOLS,
  CANONICAL_WITNESS_TYPES_PATH,
  CANONICAL_WITNESS_TYPES_SPECIFIER_FROM_WITNESS,
  CANONICAL_WITNESS_VERIFIER_PATH,
  classifyCognitiveAuditingImport,
  CognitiveAuditingImportError,
  collectCapsuleSearchRoots,
  createCognitiveAuditingDefectEntry,
  createCognitiveAuditingDefectProof,
  DEFAULT_CONSECUTIVE_CRASH_THRESHOLD,
  DEFECT_REF,
  ERROR_CODE,
  extractImportEntries,
  extractModuleImports,
  formatCognitiveAuditingAuditBrief,
  formatForensicsReport,
  INVARIANT_DESCRIPTION,
  INVARIANT_NUMBER,
  INVARIANT_REF,
  isCanonicalCognitiveImport,
  isCanonicalLastPulseImport,
  isCanonicalMetaAuditorImport,
  isCanonicalWitnessImport,
  isLegacyCognitiveImport,
  isLegacyLastPulseImport,
  isLegacyMetaAuditorImport,
  isLegacyWitnessImport,
  LEGACY_COGNITIVE_CHUNK1_FILE,
  LEGACY_COGNITIVE_CHUNK2_FILE,
  LEGACY_LAST_PULSE_FILE,
  LEGACY_LAST_PULSE_SPECIFIERS,
  LEGACY_META_AUDITOR_FILE,
  LEGACY_META_AUDITOR_SPECIFIERS,
  LEGACY_WITNESS_FILE,
  LEGACY_WITNESS_SPECIFIERS,
  MindAuditorEngine,
  MindAuditingCognitiveImportError,
  pulseProducedActivity,
  readCommandOutput,
  readLastPulse,
  reconcileLastPulse,
  remediateCognitiveAuditingFile,
  remediateCognitiveAuditingSource,
  remediateCognitiveAuditingSourceWithReport,
  resolveCognitiveAuditingImportPath,
  resolveLastPulsePath,
  resolveWitnessCommand,
  SkillAuditorEngine,
  synthesizeRemediationPlan,
  UNRESOLVED_MODULE_IMPORT_IN_MIND_AUDITING,
  UnresolvedCognitiveAuditingImportError,
  validateCognitiveAuditingFile,
  validateCognitiveAuditingSource,
  verifyDefectWitness,
  verifyLiveCognitiveAuditingIntegrity,
  writeLastPulse,
  type AuditorCursor,
  type CognitiveAuditingImportIssue,
  type CognitiveAuditingModuleAuditReport,
  type CognitiveAuditingValidationResult,
  type CognitiveImportClassification,
  type DefectWitnessVerification,
  type ForensicsAnalysisResult,
  type ForensicsIncident,
  type ForensicsMetrics,
  type ForensicsSummary,
  type ImportEntry,
  type LastPulseRecord,
  type MindAuditLiveResult,
  type SkillAuditLiveResult,
  type StoredAuditorCursors,
  type WitnessResolution,
} from "../../../olt/scripts/src/mind/defect-mind-auditing-cognitive-unresolved-relative-imports.ts";

const tempDirs: string[] = [];

function createTempDir(prefix = "mind-cog-import-test-"): string {
  const dir = join(tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of tempDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
  tempDirs.length = 0;
});

describe("Task 1.20: Defect Remediation - Stale relative imports in mind/auditing/cognitive/ chunk files after modularization", () => {
  describe("1. Defect Metadata, Constants & Architectural Contracts", () => {
    test("defect identifiers and error codes match architectural specifications", () => {
      expect(DEFECT_REF).toBe("defect-mind-auditing-cognitive-unresolved-relative-imports");
      expect(ERROR_CODE).toBe("UNRESOLVED_MODULE_IMPORT_IN_MIND_AUDITING");
      expect(UNRESOLVED_MODULE_IMPORT_IN_MIND_AUDITING).toBe(
        "UNRESOLVED_MODULE_IMPORT_IN_MIND_AUDITING",
      );
      expect(INVARIANT_NUMBER).toBe(20);
      expect(INVARIANT_REF).toBe("Invariant 1.20");
      expect(INVARIANT_DESCRIPTION).toContain("Cognitive auditing modules and chunk files");
    });

    test("canonical paths and module directories are accurately declared", () => {
      expect(CANONICAL_COGNITIVE_DIR).toBe("olt/scripts/src/mind/auditing/cognitive");
      expect(CANONICAL_AUDITING_BARREL_PATH).toBe("olt/scripts/src/mind/auditing/index.ts");
      expect(CANONICAL_COGNITIVE_BARREL_PATH).toBe(
        "olt/scripts/src/mind/auditing/cognitive/index.ts",
      );
      expect(CANONICAL_COGNITIVE_PULSE_AUDITOR_PATH).toBe(
        "olt/scripts/src/mind/auditing/cognitive/pulse-auditor.ts",
      );
      expect(CANONICAL_COGNITIVE_SKILL_AUDITOR_PATH).toBe(
        "olt/scripts/src/mind/auditing/cognitive/skill-auditor.ts",
      );
      expect(CANONICAL_COGNITIVE_ENGINE_PATH).toBe(
        "olt/scripts/src/mind/auditing/cognitive/engine.ts",
      );
      expect(CANONICAL_COGNITIVE_CURSOR_PATH).toBe(
        "olt/scripts/src/mind/auditing/cognitive/cursor.ts",
      );
      expect(CANONICAL_COGNITIVE_TYPES_PATH).toBe(
        "olt/scripts/src/mind/auditing/cognitive/types.ts",
      );

      expect(CANONICAL_WITNESS_BARREL_PATH).toBe("olt/scripts/src/mind/auditing/witness/index.ts");
      expect(CANONICAL_WITNESS_TYPES_PATH).toBe("olt/scripts/src/mind/auditing/witness/types.ts");
      expect(CANONICAL_WITNESS_VERIFIER_PATH).toBe(
        "olt/scripts/src/mind/auditing/witness/verifier.ts",
      );

      expect(CANONICAL_META_BARREL_PATH).toBe("olt/scripts/src/mind/auditing/meta/index.ts");
      expect(CANONICAL_PULSE_BARREL_PATH).toBe("olt/scripts/src/mind/lifecycle/pulse/index.ts");
      expect(CANONICAL_LAST_PULSE_PATH).toBe("olt/scripts/src/mind/lifecycle/pulse/last-pulse.ts");
    });

    test("canonical specifiers from cognitive and auditing scopes are correct", () => {
      expect(CANONICAL_LAST_PULSE_SPECIFIER_FROM_COGNITIVE).toBe("../../lifecycle/pulse/index.ts");
      expect(CANONICAL_LAST_PULSE_DIRECT_SPECIFIER_FROM_COGNITIVE).toBe(
        "../../lifecycle/pulse/last-pulse.ts",
      );
      expect(CANONICAL_META_SPECIFIER_FROM_COGNITIVE).toBe("../meta/index.ts");
      expect(CANONICAL_WITNESS_SPECIFIER_FROM_COGNITIVE).toBe("../witness/index.ts");
      expect(CANONICAL_WITNESS_TYPES_SPECIFIER_FROM_WITNESS).toBe("./types.ts");

      expect(CANONICAL_LAST_PULSE_SPECIFIER_FROM_AUDITING).toBe("../lifecycle/pulse/index.ts");
      expect(CANONICAL_META_SPECIFIER_FROM_AUDITING).toBe("./meta/index.ts");
      expect(CANONICAL_WITNESS_SPECIFIER_FROM_AUDITING).toBe("./witness/index.ts");
    });

    test("legacy chunk files and specifier lists are frozen and complete", () => {
      expect(LEGACY_COGNITIVE_CHUNK1_FILE).toBe("cognitive-auditors-chunk1.ts");
      expect(LEGACY_COGNITIVE_CHUNK2_FILE).toBe("cognitive-auditors-chunk2.ts");
      expect(LEGACY_WITNESS_FILE).toBe("witness.ts");
      expect(LEGACY_META_AUDITOR_FILE).toBe("meta-auditor.ts");
      expect(LEGACY_LAST_PULSE_FILE).toBe("last-pulse.ts");

      expect(Object.isFrozen(LEGACY_LAST_PULSE_SPECIFIERS)).toBe(true);
      expect(LEGACY_LAST_PULSE_SPECIFIERS).toContain("./last-pulse.ts");
      expect(LEGACY_LAST_PULSE_SPECIFIERS).toContain("../last-pulse.ts");

      expect(Object.isFrozen(LEGACY_META_AUDITOR_SPECIFIERS)).toBe(true);
      expect(LEGACY_META_AUDITOR_SPECIFIERS).toContain("./meta-auditor.ts");
      expect(LEGACY_META_AUDITOR_SPECIFIERS).toContain("../meta-auditor.ts");

      expect(Object.isFrozen(LEGACY_WITNESS_SPECIFIERS)).toBe(true);
      expect(LEGACY_WITNESS_SPECIFIERS).toContain("./witness.ts");
      expect(LEGACY_WITNESS_SPECIFIERS).toContain("mind/auditing/witness.ts");

      expect(Object.isFrozen(ALL_LEGACY_IMPORT_PATTERNS)).toBe(true);
      expect(ALL_LEGACY_IMPORT_PATTERNS.length).toBeGreaterThanOrEqual(15);
    });

    test("canonical symbol sets are frozen and contain expected members", () => {
      expect(Object.isFrozen(CANONICAL_COGNITIVE_SYMBOLS)).toBe(true);
      expect(CANONICAL_COGNITIVE_SYMBOLS).toContain("MindAuditorEngine");
      expect(CANONICAL_COGNITIVE_SYMBOLS).toContain("SkillAuditorEngine");
      expect(CANONICAL_COGNITIVE_SYMBOLS).toContain("AuditorCursorStore");

      expect(Object.isFrozen(CANONICAL_LAST_PULSE_SYMBOLS)).toBe(true);
      expect(CANONICAL_LAST_PULSE_SYMBOLS).toContain("readLastPulse");
      expect(CANONICAL_LAST_PULSE_SYMBOLS).toContain("writeLastPulse");
      expect(CANONICAL_LAST_PULSE_SYMBOLS).toContain("reconcileLastPulse");

      expect(Object.isFrozen(CANONICAL_META_SYMBOLS)).toBe(true);
      expect(CANONICAL_META_SYMBOLS).toContain("analyzeRunForensics");
      expect(CANONICAL_META_SYMBOLS).toContain("formatForensicsReport");

      expect(Object.isFrozen(CANONICAL_WITNESS_SYMBOLS)).toBe(true);
      expect(CANONICAL_WITNESS_SYMBOLS).toContain("collectCapsuleSearchRoots");
      expect(CANONICAL_WITNESS_SYMBOLS).toContain("resolveWitnessCommand");
      expect(CANONICAL_WITNESS_SYMBOLS).toContain("verifyDefectWitness");
    });
  });

  describe("2. Re-exported Facade Symbols & Runtime Invocations", () => {
    test("re-exported cognitive auditor symbols function properly", () => {
      expect(typeof MindAuditorEngine).toBe("function");
      expect(typeof SkillAuditorEngine).toBe("function");
      expect(typeof AuditorCursorStore).toBe("function");
      expect(typeof auditMindPulseHelper).toBe("function");

      const tempDir = createTempDir("cursor-test-");
      const cursor: AuditorCursor = {
        lastInspectedTimestamp: new Date().toISOString(),
        lastInspectedEventIndex: 5,
        lastAuditTimestamp: new Date().toISOString(),
      };
      AuditorCursorStore.saveCursor(tempDir, "mind", cursor);
      const loaded = AuditorCursorStore.loadCursor(tempDir, "mind");
      expect(loaded.lastInspectedEventIndex).toBe(5);
    });

    test("re-exported pulse lifecycle symbols execute properly", () => {
      expect(typeof readLastPulse).toBe("function");
      expect(typeof writeLastPulse).toBe("function");
      expect(typeof reconcileLastPulse).toBe("function");
      expect(typeof resolveLastPulsePath).toBe("function");
      expect(typeof pulseProducedActivity).toBe("function");
      expect(DEFAULT_CONSECUTIVE_CRASH_THRESHOLD).toBe(3);

      const tempDir = createTempDir("pulse-test-");
      const record: LastPulseRecord = {
        at: new Date().toISOString(),
        pulse_id: "pulse-123",
        outcome: "healthy",
        next_wake_at: null,
      };
      writeLastPulse(tempDir, record);
      const readBack = readLastPulse(tempDir);
      expect(readBack?.pulse_id).toBe("pulse-123");
      expect(readBack?.outcome).toBe("healthy");
    });

    test("re-exported witness resolution symbols execute properly", () => {
      expect(typeof resolveWitnessCommand).toBe("function");
      expect(typeof collectCapsuleSearchRoots).toBe("function");
      expect(typeof readCommandOutput).toBe("function");
      expect(typeof verifyDefectWitness).toBe("function");

      const tempDir = createTempDir("witness-test-");
      const roots = collectCapsuleSearchRoots(tempDir);
      expect(Array.isArray(roots)).toBe(true);
    });

    test("re-exported meta forensics symbols are callable", () => {
      expect(typeof formatForensicsReport).toBe("function");
      expect(typeof synthesizeRemediationPlan).toBe("function");
    });
  });

  describe("3. Error Types & Class Hierarchy", () => {
    test("MindAuditingCognitiveImportError creates structured error with defaults", () => {
      const err = new MindAuditingCognitiveImportError("Unresolved relative import in cognitive chunk");
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(MindAuditingCognitiveImportError);
      expect(err.name).toBe("MindAuditingCognitiveImportError");
      expect(err.code).toBe(UNRESOLVED_MODULE_IMPORT_IN_MIND_AUDITING);
      expect(err.defectRef).toBe(DEFECT_REF);
      expect(err.issues).toEqual([]);
    });

    test("MindAuditingCognitiveImportError creates structured error with custom options", () => {
      const issue: CognitiveAuditingImportIssue = {
        code: UNRESOLVED_MODULE_IMPORT_IN_MIND_AUDITING,
        message: "Stale import ./last-pulse.ts",
        specifier: "./last-pulse.ts",
        filePath: "olt/scripts/src/mind/auditing/cognitive/cognitive-auditors-chunk1.ts",
        category: "stale_last_pulse",
      };
      const err = new MindAuditingCognitiveImportError("Custom error", {
        code: "CUSTOM_CODE",
        defectRef: "custom-ref",
        filePath: "some/file.ts",
        specifier: "./last-pulse.ts",
        issues: [issue],
      });

      expect(err.code).toBe("CUSTOM_CODE");
      expect(err.defectRef).toBe("custom-ref");
      expect(err.filePath).toBe("some/file.ts");
      expect(err.specifier).toBe("./last-pulse.ts");
      expect(err.issues.length).toBe(1);
      expect(err.issues[0]?.category).toBe("stale_last_pulse");
    });

    test("alias exports match MindAuditingCognitiveImportError class", () => {
      expect(UnresolvedCognitiveAuditingImportError).toBe(MindAuditingCognitiveImportError);
      expect(CognitiveAuditingImportError).toBe(MindAuditingCognitiveImportError);
    });
  });

  describe("4. Lexical AST Extraction & Import Classification", () => {
    test("extractImportEntries captures named, type-only, namespace, and re-export statements", () => {
      const source = `
import { readLastPulse, writeLastPulse } from "./last-pulse.ts";
import type { AuditorCursor } from "./types.ts";
import * as meta from "../meta/index.ts";
import defaultHelper from "./helper.ts";
export { resolveWitnessCommand } from "./witness.ts";
export type { DefectWitnessVerification } from "./witness.ts";
const dyn = import("./dynamic-mod.ts");
// Commented import { ignoreMe } from "./ignored.ts";
`;
      const entries = extractImportEntries(source);
      expect(entries.length).toBe(7);

      const lastPulse = entries.find((e) => e.specifier === "./last-pulse.ts");
      expect(lastPulse).toBeDefined();
      expect(lastPulse?.namedSymbols).toContain("readLastPulse");
      expect(lastPulse?.namedSymbols).toContain("writeLastPulse");
      expect(lastPulse?.isTypeOnly).toBe(false);

      const typeOnly = entries.find((e) => e.specifier === "./types.ts");
      expect(typeOnly).toBeDefined();
      expect(typeOnly?.isTypeOnly).toBe(true);

      const nsImport = entries.find((e) => e.specifier === "../meta/index.ts");
      expect(nsImport).toBeDefined();
      expect(nsImport?.namespaceImport).toBe("meta");

      const reExport = entries.find((e) => e.specifier === "./witness.ts" && !e.isTypeOnly);
      expect(reExport).toBeDefined();
      expect(reExport?.isReExport).toBe(true);
      expect(reExport?.namedSymbols).toContain("resolveWitnessCommand");
    });

    test("extractModuleImports returns unique specifiers", () => {
      const source = `
import { a } from "./mod1.ts";
import { b } from "./mod1.ts";
import { c } from "./mod2.ts";
`;
      const imports = extractModuleImports(source);
      expect(imports).toEqual(["./mod1.ts", "./mod2.ts"]);
    });

    test("isLegacyLastPulseImport and isCanonicalLastPulseImport predicates operate correctly", () => {
      expect(isLegacyLastPulseImport("./last-pulse.ts")).toBe(true);
      expect(isLegacyLastPulseImport("../last-pulse.ts")).toBe(true);
      expect(isLegacyLastPulseImport("./pulse/last-pulse.ts")).toBe(true);
      expect(isLegacyLastPulseImport("../../lifecycle/pulse/index.ts")).toBe(false);
      expect(isLegacyLastPulseImport("../../lifecycle/pulse/last-pulse.ts")).toBe(false);

      expect(isCanonicalLastPulseImport("../../lifecycle/pulse/index.ts")).toBe(true);
      expect(isCanonicalLastPulseImport("../../lifecycle/pulse/last-pulse.ts")).toBe(true);
      expect(isCanonicalLastPulseImport("../lifecycle/pulse/index.ts")).toBe(true);
      expect(isCanonicalLastPulseImport("./last-pulse.ts")).toBe(false);
    });

    test("isLegacyMetaAuditorImport and isCanonicalMetaAuditorImport operate correctly", () => {
      expect(isLegacyMetaAuditorImport("./meta-auditor.ts")).toBe(true);
      expect(isLegacyMetaAuditorImport("../meta-auditor.ts")).toBe(true);
      expect(isLegacyMetaAuditorImport("./meta.ts")).toBe(true);
      expect(isLegacyMetaAuditorImport("../meta/index.ts")).toBe(false);

      expect(isCanonicalMetaAuditorImport("../meta/index.ts")).toBe(true);
      expect(isCanonicalMetaAuditorImport("./meta/index.ts")).toBe(true);
      expect(isCanonicalMetaAuditorImport("./meta-auditor.ts")).toBe(false);
    });

    test("isLegacyWitnessImport and isCanonicalWitnessImport operate correctly", () => {
      expect(isLegacyWitnessImport("./witness.ts")).toBe(true);
      expect(isLegacyWitnessImport("../witness.ts")).toBe(true);
      expect(isLegacyWitnessImport("mind/auditing/witness.ts")).toBe(true);
      expect(isLegacyWitnessImport("./witness/index.ts")).toBe(false);

      expect(isCanonicalWitnessImport("./witness/index.ts")).toBe(true);
      expect(isCanonicalWitnessImport("../witness/index.ts")).toBe(true);
      expect(isCanonicalWitnessImport("./types.ts")).toBe(true);
      expect(isCanonicalWitnessImport("./witness.ts")).toBe(false);
    });

    test("isLegacyCognitiveImport and isCanonicalCognitiveImport operate correctly", () => {
      expect(isLegacyCognitiveImport("./cognitive-auditors.ts")).toBe(true);
      expect(isLegacyCognitiveImport("./cognitive-auditors-chunk1.ts")).toBe(true);
      expect(isLegacyCognitiveImport("./cognitive-auditors-chunk2.ts")).toBe(true);
      expect(isLegacyCognitiveImport("./cognitive/index.ts")).toBe(false);

      expect(isCanonicalCognitiveImport("./cognitive/index.ts")).toBe(true);
      expect(isCanonicalCognitiveImport("../cognitive/index.ts")).toBe(true);
      expect(isCanonicalCognitiveImport("./engine.ts")).toBe(true);
      expect(isCanonicalCognitiveImport("./cognitive-auditors-chunk1.ts")).toBe(false);
    });

    test("classifyCognitiveAuditingImport provides accurate suggestions and classifications", () => {
      const fromCog = "olt/scripts/src/mind/auditing/cognitive/cognitive-auditors-chunk1.ts";
      const c1 = classifyCognitiveAuditingImport("./last-pulse.ts", fromCog);
      expect(c1.isLegacy).toBe(true);
      expect(c1.category).toBe("last_pulse");
      expect(c1.suggestedCanonicalSpecifier).toBe("../../lifecycle/pulse/index.ts");
      expect(c1.issues.length).toBe(1);
      expect(c1.issues[0]?.category).toBe("stale_last_pulse");

      const c2 = classifyCognitiveAuditingImport("./meta-auditor.ts", fromCog);
      expect(c2.isLegacy).toBe(true);
      expect(c2.category).toBe("meta_auditor");
      expect(c2.suggestedCanonicalSpecifier).toBe("../meta/index.ts");
      expect(c2.issues[0]?.category).toBe("stale_meta_auditor");

      const c3 = classifyCognitiveAuditingImport("./witness.ts", fromCog);
      expect(c3.isLegacy).toBe(true);
      expect(c3.category).toBe("witness");
      expect(c3.suggestedCanonicalSpecifier).toBe("../witness/index.ts");

      const cCanonical = classifyCognitiveAuditingImport("../../lifecycle/pulse/index.ts", fromCog);
      expect(cCanonical.isCanonical).toBe(true);
      expect(cCanonical.isLegacy).toBe(false);
      expect(cCanonical.issues.length).toBe(0);
    });

    test("resolveCognitiveAuditingImportPath resolves relative paths and handles nonexistent files", () => {
      const res = resolveCognitiveAuditingImportPath("./index.ts", "olt/scripts/src/mind/auditing/cognitive/engine.ts");
      expect(typeof res.exists).toBe("boolean");
      expect(res.resolvedPath).toBeDefined();
    });
  });

  describe("5. Validation Engine & Invariant Assertion", () => {
    test("validateCognitiveAuditingSource flags chunk1 defect with stale ./last-pulse.ts", () => {
      const defectiveChunk1 = `
import { readLastPulse, writeLastPulse } from "./last-pulse.ts";
import { AuditorCursorStore } from "./cursor.ts";
import type { AuditorCursor, MindAuditLiveResult } from "./types.ts";

export function auditMindPulse(repoRoot: string): MindAuditLiveResult {
  const pulse = readLastPulse(repoRoot);
  return {} as MindAuditLiveResult;
}
`;
      const result = validateCognitiveAuditingSource(
        defectiveChunk1,
        "olt/scripts/src/mind/auditing/cognitive/cognitive-auditors-chunk1.ts",
      );

      expect(result.valid).toBe(false);
      expect(result.defectRef).toBe(DEFECT_REF);
      expect(result.legacyImportsDetected).toContain("./last-pulse.ts");
      expect(result.issues.some((i) => i.category === "stale_last_pulse")).toBe(true);
      expect(result.issueCount).toBeGreaterThanOrEqual(1);
    });

    test("validateCognitiveAuditingSource flags chunk2 defect with stale ./meta-auditor.ts", () => {
      const defectiveChunk2 = `
import { analyzeRunForensics } from "./meta-auditor.ts";
import { AuditorCursorStore } from "./cursor.ts";
import type { SkillAuditLiveResult } from "./types.ts";

export function auditSkillCompliance(repoRoot: string): SkillAuditLiveResult {
  const res = analyzeRunForensics({ runRoot: repoRoot, inject: false });
  return {} as SkillAuditLiveResult;
}
`;
      const result = validateCognitiveAuditingSource(
        defectiveChunk2,
        "olt/scripts/src/mind/auditing/cognitive/cognitive-auditors-chunk2.ts",
      );

      expect(result.valid).toBe(false);
      expect(result.legacyImportsDetected).toContain("./meta-auditor.ts");
      expect(result.issues.some((i) => i.category === "stale_meta_auditor")).toBe(true);
    });

    test("validateCognitiveAuditingSource flags unexported collectCapsuleSearchRoots in witness.ts", () => {
      const defectiveWitnessCall = `
import { collectCapsuleSearchRoots, resolveWitnessCommand } from "./witness.ts";

export function runWitnessCheck(path: string): string[] {
  return collectCapsuleSearchRoots(path);
}
`;
      const result = validateCognitiveAuditingSource(
        defectiveWitnessCall,
        "olt/scripts/src/mind/auditing/cognitive/engine.ts",
      );

      expect(result.valid).toBe(false);
      expect(result.unexportedSymbolsReferenced).toContain("collectCapsuleSearchRoots");
      expect(result.issues.some((i) => i.category === "unexported_witness_symbol")).toBe(true);
    });

    test("validateCognitiveAuditingSource validates canonical cognitive auditor module with 0 issues", () => {
      const canonicalSource = `
import { readLastPulse } from "../../lifecycle/pulse/index.ts";
import { analyzeRunForensics } from "../meta/index.ts";
import { AuditorCursorStore } from "./cursor.ts";
import { MindAuditorEngine } from "./engine.ts";
import type { AuditorCursor, MindAuditLiveResult, SkillAuditLiveResult } from "./types.ts";

export function auditMindPulse(repoRoot: string): MindAuditLiveResult {
  const pulse = readLastPulse(repoRoot);
  return {} as MindAuditLiveResult;
}
`;
      const result = validateCognitiveAuditingSource(
        canonicalSource,
        "olt/scripts/src/mind/auditing/cognitive/pulse-auditor.ts",
      );

      expect(result.valid).toBe(true);
      expect(result.issues.length).toBe(0);
      expect(result.canonicalImportsPresent).toContain("../../lifecycle/pulse/index.ts");
      expect(result.canonicalImportsPresent).toContain("../meta/index.ts");
      expect(result.legacyImportsDetected.length).toBe(0);
    });

    test("assertValidCognitiveAuditingImports throws on violation and succeeds on clean code", () => {
      const defective = `import { readLastPulse } from "./last-pulse.ts";`;
      expect(() => {
        assertValidCognitiveAuditingImports(
          defective,
          "olt/scripts/src/mind/auditing/cognitive/cognitive-auditors-chunk1.ts",
        );
      }).toThrow(MindAuditingCognitiveImportError);

      const clean = `import { readLastPulse } from "../../lifecycle/pulse/index.ts";`;
      expect(() => {
        assertValidCognitiveAuditingImports(
          clean,
          "olt/scripts/src/mind/auditing/cognitive/pulse-auditor.ts",
        );
      }).not.toThrow();
    });

    test("validateCognitiveAuditingFile handles non-existent file gracefully", () => {
      const rep = validateCognitiveAuditingFile("/tmp/nonexistent-file-404.ts");
      expect(rep.valid).toBe(false);
      expect(rep.issueCount).toBe(1);
      expect(rep.issues[0]?.category).toBe("unresolved_import");
    });
  });

  describe("6. Remediation Engine & Automated Transformations", () => {
    test("remediateCognitiveAuditingSource transforms stale imports in cognitive chunk files", () => {
      const chunkSource = `
import { readLastPulse, writeLastPulse } from "./last-pulse.ts";
import { analyzeRunForensics } from "./meta-auditor.ts";
import { resolveWitnessCommand } from "./witness.ts";
import { AuditorCursorStore } from "./cursor.ts";
`;
      const remediated = remediateCognitiveAuditingSource(
        chunkSource,
        "olt/scripts/src/mind/auditing/cognitive/cognitive-auditors-chunk1.ts",
      );

      expect(remediated.success).toBe(true);
      expect(remediated.replacementsCount).toBe(3);
      expect(remediated.remediatedSource).toContain(
        `import { readLastPulse, writeLastPulse } from "../../lifecycle/pulse/index.ts";`,
      );
      expect(remediated.remediatedSource).toContain(
        `import { analyzeRunForensics } from "../meta/index.ts";`,
      );
      expect(remediated.remediatedSource).toContain(
        `import { resolveWitnessCommand } from "../witness/index.ts";`,
      );
      expect(remediated.remediatedSource).not.toContain("./last-pulse.ts");
      expect(remediated.remediatedSource).not.toContain("./meta-auditor.ts");
      expect(remediated.remediatedSource).not.toContain("./witness.ts");
    });

    test("remediateCognitiveAuditingSource transforms stale imports in auditing root scope", () => {
      const auditRootSource = `
import { readLastPulse } from "./last-pulse.ts";
import { analyzeRunForensics } from "./meta-auditor.ts";
import { resolveWitnessCommand } from "./witness.ts";
`;
      const remediated = remediateCognitiveAuditingSource(
        auditRootSource,
        "olt/scripts/src/mind/auditing/index.ts",
      );

      expect(remediated.success).toBe(true);
      expect(remediated.remediatedSource).toContain(
        `import { readLastPulse } from "../lifecycle/pulse/index.ts";`,
      );
      expect(remediated.remediatedSource).toContain(
        `import { analyzeRunForensics } from "./meta/index.ts";`,
      );
      expect(remediated.remediatedSource).toContain(
        `import { resolveWitnessCommand } from "./witness/index.ts";`,
      );
    });

    test("remediateCognitiveAuditingSourceWithReport verifies end-to-end fix", () => {
      const defective = `
import { readLastPulse } from "./last-pulse.ts";
import { analyzeRunForensics } from "./meta-auditor.ts";
`;
      const report = remediateCognitiveAuditingSourceWithReport(
        defective,
        "olt/scripts/src/mind/auditing/cognitive/cognitive-auditors-chunk1.ts",
      );

      expect(report.validationBefore.valid).toBe(false);
      expect(report.validationBefore.issueCount).toBe(2);
      expect(report.result.replacementsCount).toBe(2);
      expect(report.validationAfter.valid).toBe(true);
      expect(report.validationAfter.issueCount).toBe(0);
    });

    test("remediateCognitiveAuditingFile modifies file on disk and verifies persistence", () => {
      const tempDir = createTempDir("remediate-disk-test-");
      const cogSubdir = join(tempDir, "cognitive");
      mkdirSync(cogSubdir, { recursive: true });
      const testFile = join(cogSubdir, "chunk1.ts");

      writeFileSync(
        testFile,
        `import { readLastPulse } from "./last-pulse.ts";\nexport const x = 1;\n`,
        "utf-8",
      );

      const remResult = remediateCognitiveAuditingFile(testFile);
      expect(remResult.replacementsCount).toBe(1);

      const onDisk = readFileSync(testFile, "utf-8");
      expect(onDisk).toContain(`import { readLastPulse } from "../../lifecycle/pulse/index.ts";`);
      expect(onDisk).not.toContain("./last-pulse.ts");
    });
  });

  describe("7. Directory & Subsystem Auditing", () => {
    test("auditCognitiveAuditingDirectory correctly reports valid vs invalid directories", () => {
      const tempDir = createTempDir("audit-dir-test-");
      const validFile = join(tempDir, "valid.ts");
      const invalidFile = join(tempDir, "invalid.ts");

      writeFileSync(
        validFile,
        `import { readLastPulse } from "../../lifecycle/pulse/index.ts";\nexport const v = 1;\n`,
        "utf-8",
      );
      writeFileSync(
        invalidFile,
        `import { readLastPulse } from "./last-pulse.ts";\nexport const iv = 2;\n`,
        "utf-8",
      );

      const report = auditCognitiveAuditingDirectory(tempDir);
      expect(report.totalFilesScanned).toBe(2);
      expect(report.validFilesCount).toBe(1);
      expect(report.invalidFilesCount).toBe(1);
      expect(report.resolved).toBe(false);
      expect(report.issues.length).toBe(1);

      // Remediate the invalid file
      remediateCognitiveAuditingFile(invalidFile);
      const reportAfter = auditCognitiveAuditingDirectory(tempDir);
      expect(reportAfter.validFilesCount).toBe(2);
      expect(reportAfter.invalidFilesCount).toBe(0);
      expect(reportAfter.resolved).toBe(true);
    });

    test("formatCognitiveAuditingAuditBrief formats markdown summary accurately", () => {
      const sampleReport: CognitiveAuditingModuleAuditReport = {
        defectRef: DEFECT_REF,
        errorCode: UNRESOLVED_MODULE_IMPORT_IN_MIND_AUDITING,
        resolved: true,
        totalFilesScanned: 8,
        validFilesCount: 8,
        invalidFilesCount: 0,
        checkedFiles: ["file1.ts", "file2.ts"],
        issues: [],
        fileReports: [],
        timestamp: new Date().toISOString(),
      };

      const brief = formatCognitiveAuditingAuditBrief(sampleReport);
      expect(brief).toContain("# Cognitive Auditing Import Integrity Report");
      expect(brief).toContain(DEFECT_REF);
      expect(brief).toContain(INVARIANT_REF);
      expect(brief).toContain("RESOLVED (100% Valid)");
      expect(brief).toContain("Total Files Scanned: 8");
    });
  });

  describe("8. Defect Tracking Contract Compliance & Proof Generation", () => {
    test("createCognitiveAuditingDefectEntry creates standard compliant DefectEntry", () => {
      const entry = createCognitiveAuditingDefectEntry();

      expect(entry.id).toBe(DEFECT_REF);
      expect(entry.domain).toBe("mind-auditing");
      expect(entry.error_code).toBe(UNRESOLVED_MODULE_IMPORT_IN_MIND_AUDITING);
      expect(entry.status).toBe("resolved");
      expect(entry.category).toBe("modularity_violation");
      expect(entry.severity).toBe("high");
      expect(entry.description).toContain("Cognitive auditing modules and chunk files");
      expect(entry.observation).toBeDefined();
      expect(entry.remediation).toBeDefined();
      expect(entry.resolution?.verified).toBe(true);
      expect(entry.resolution?.task_id).toBe("Task 1.20");
      expect(entry.resolution?.empirical_command).toBe(
        "bun test tests/unit/mind/defect-mind-auditing-cognitive-unresolved-relative-imports.test.ts",
      );
    });

    test("createCognitiveAuditingDefectProof produces valid empirical resolution proof", () => {
      const proof = createCognitiveAuditingDefectProof({
        commitSha: "abc1234",
        verified: true,
      });

      expect(proof.task_id).toBe("Task 1.20");
      expect(proof.commit_sha).toBe("abc1234");
      expect(proof.verified).toBe(true);
      expect(proof.test_assertion).toBe(
        "tests/unit/mind/defect-mind-auditing-cognitive-unresolved-relative-imports.test.ts",
      );
      expect(proof.empirical_command).toBe(
        "bun test tests/unit/mind/defect-mind-auditing-cognitive-unresolved-relative-imports.test.ts",
      );
      expect(proof.explanation).toContain("mind/auditing/cognitive");
    });
  });

  describe("9. Live Workspace Integrity Verification", () => {
    test("verifyLiveCognitiveAuditingIntegrity proves live auditing subsystem files are 100% compliant", () => {
      const live = verifyLiveCognitiveAuditingIntegrity();

      expect(live.liveFilesChecked.length).toBeGreaterThanOrEqual(5);
      expect(live.report.invalidFilesCount).toBe(0);
      expect(live.report.issues.length).toBe(0);
      expect(live.verified).toBe(true);
      expect(live.report.resolved).toBe(true);
    });

    test("live cognitive auditor files exist and resolve canonical imports cleanly", () => {
      const cognitiveBarrel = join(process.cwd(), CANONICAL_COGNITIVE_BARREL_PATH);
      const pulseAuditor = join(process.cwd(), CANONICAL_COGNITIVE_PULSE_AUDITOR_PATH);
      const skillAuditor = join(process.cwd(), CANONICAL_COGNITIVE_SKILL_AUDITOR_PATH);
      const witnessBarrel = join(process.cwd(), CANONICAL_WITNESS_BARREL_PATH);

      expect(existsSync(cognitiveBarrel)).toBe(true);
      expect(existsSync(pulseAuditor)).toBe(true);
      expect(existsSync(skillAuditor)).toBe(true);
      expect(existsSync(witnessBarrel)).toBe(true);

      const pulseValidation = validateCognitiveAuditingFile(pulseAuditor);
      expect(pulseValidation.valid).toBe(true);
      expect(pulseValidation.canonicalImportsPresent).toContain("../../lifecycle/pulse/index.ts");
      expect(pulseValidation.legacyImportsDetected.length).toBe(0);

      const skillValidation = validateCognitiveAuditingFile(skillAuditor);
      expect(skillValidation.valid).toBe(true);
      expect(skillValidation.canonicalImportsPresent).toContain("../meta/index.ts");
      expect(skillValidation.legacyImportsDetected.length).toBe(0);
    });
  });
});
