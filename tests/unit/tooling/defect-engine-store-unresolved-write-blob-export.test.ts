import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  assertValidEngineStoreExports,
  auditEngineStoreBarrelExports,
  CANONICAL_BLOBS_MODULE_PATH,
  CANONICAL_BLOBS_RELATIVE_SPECIFIER,
  CANONICAL_STORE_BARREL_PATH,
  createEngineStoreDefectEntry,
  createEngineStoreDefectProof,
  DEFECT_REF,
  EngineStoreBarrelExportError,
  ERROR_CODE,
  extractBarrelReExports,
  extractExportedSymbols,
  extractModuleImports,
  INVARIANT_DESCRIPTION,
  INVARIANT_NUMBER,
  INVARIANT_REF,
  isBlobWriteResultTypeExport,
  isWriteBlobExport,
  reconcileEngineStoreBlobExports,
  remediateBlobsModuleExports,
  remediateStoreBarrelExports,
  REQUIRED_BLOBS_TYPE_EXPORTS,
  REQUIRED_BLOBS_VALUE_EXPORTS,
  REQUIRED_STORE_BARREL_EXPORTS,
  TARGET_EXPORT_SYMBOLS,
  UnexportedBarrelMemberError,
  UNEXPORTED_MEMBER_IN_BARREL,
  UnresolvedWriteBlobExportError,
  validateBlobWriteIntegrity,
  validateBlobsModuleExports,
  validateStoreBarrelExports,
  verifyEngineStoreRemediation,
  verifyLiveStoreBarrelIntegrity,
  writeBlobDirect,
  writeBlobFromMemory,
} from "../../../olt/scripts/src/tooling/defect-engine-store-unresolved-write-blob-export.ts";

const tempDirs: string[] = [];

function createTempDir(prefix = "store-blob-defect-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

function sha256Of(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

describe("Task 1.5: Defect Remediation - Unresolved writeBlob export in engine/store/index.ts", () => {
  describe("1. Defect Constants & Canonical Specifiers", () => {
    test("exports canonical defect reference and error code constants", () => {
      expect(DEFECT_REF).toBe("defect-engine-store-unresolved-write-blob-export");
      expect(ERROR_CODE).toBe("UNEXPORTED_MEMBER_IN_BARREL");
      expect(UNEXPORTED_MEMBER_IN_BARREL).toBe("UNEXPORTED_MEMBER_IN_BARREL");
      expect(INVARIANT_NUMBER).toBe(5);
      expect(INVARIANT_REF).toBe("Invariant 1.5");
      expect(INVARIANT_DESCRIPTION).toContain("Engine store barrel (index.ts) must re-export writeBlob");
      expect(CANONICAL_STORE_BARREL_PATH).toBe("olt/scripts/src/engine/store/index.ts");
      expect(CANONICAL_BLOBS_MODULE_PATH).toBe("olt/scripts/src/engine/store/layout/blobs.ts");
      expect(CANONICAL_BLOBS_RELATIVE_SPECIFIER).toBe("./layout/blobs.ts");
    });

    test("freezes required exports lists and target symbol catalog", () => {
      expect(Object.isFrozen(REQUIRED_BLOBS_VALUE_EXPORTS)).toBe(true);
      expect(Object.isFrozen(REQUIRED_BLOBS_TYPE_EXPORTS)).toBe(true);
      expect(Object.isFrozen(REQUIRED_STORE_BARREL_EXPORTS)).toBe(true);
      expect(Object.isFrozen(TARGET_EXPORT_SYMBOLS)).toBe(true);

      expect(REQUIRED_BLOBS_VALUE_EXPORTS).toContain("writeBlob");
      expect(REQUIRED_BLOBS_VALUE_EXPORTS).toContain("putBlobFile");
      expect(REQUIRED_BLOBS_VALUE_EXPORTS).toContain("blobContentDigest");
      expect(REQUIRED_BLOBS_VALUE_EXPORTS).toContain("blobRelativePath");
      expect(REQUIRED_BLOBS_VALUE_EXPORTS).toContain("linkBlobIntoView");
      expect(REQUIRED_BLOBS_VALUE_EXPORTS).toContain("listBlobs");

      expect(REQUIRED_BLOBS_TYPE_EXPORTS).toContain("BlobWriteResult");
      expect(REQUIRED_BLOBS_TYPE_EXPORTS).toContain("BlobPutResult");
      expect(REQUIRED_BLOBS_TYPE_EXPORTS).toContain("BlobDescriptor");

      expect(TARGET_EXPORT_SYMBOLS).toContain("writeBlob");
      expect(TARGET_EXPORT_SYMBOLS).toContain("BlobWriteResult");
    });
  });

  describe("2. Custom Error Classes & Error Aliases", () => {
    test("EngineStoreBarrelExportError instantiates with default defect metadata", () => {
      const err = new EngineStoreBarrelExportError("Missing writeBlob export in barrel");
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(EngineStoreBarrelExportError);
      expect(err.name).toBe("EngineStoreBarrelExportError");
      expect(err.message).toBe("Missing writeBlob export in barrel");
      expect(err.code).toBe(UNEXPORTED_MEMBER_IN_BARREL);
      expect(err.defectRef).toBe(DEFECT_REF);
      expect(err.specifier).toBeUndefined();
      expect(err.missingMember).toBeUndefined();
      expect(err.filePath).toBeUndefined();
      expect(err.issues).toEqual([]);
    });

    test("EngineStoreBarrelExportError preserves custom options when provided", () => {
      const customIssues = [
        {
          code: UNEXPORTED_MEMBER_IN_BARREL,
          message: "export writeBlob not found",
          member: "writeBlob",
          specifier: "./layout/blobs.ts",
          filePath: "olt/scripts/src/engine/store/index.ts",
        },
      ];
      const err = new EngineStoreBarrelExportError("Custom barrel export error", {
        code: "CUSTOM_UNEXPORTED_ERROR",
        defectRef: "custom-ref",
        specifier: "./layout/blobs.ts",
        missingMember: "writeBlob",
        filePath: "olt/scripts/src/engine/store/index.ts",
        issues: customIssues,
      });

      expect(err.code).toBe("CUSTOM_UNEXPORTED_ERROR");
      expect(err.defectRef).toBe("custom-ref");
      expect(err.specifier).toBe("./layout/blobs.ts");
      expect(err.missingMember).toBe("writeBlob");
      expect(err.filePath).toBe("olt/scripts/src/engine/store/index.ts");
      expect(err.issues).toEqual(customIssues);
    });

    test("error aliases reference the same error class prototype", () => {
      expect(UnresolvedWriteBlobExportError).toBe(EngineStoreBarrelExportError);
      expect(UnexportedBarrelMemberError).toBe(EngineStoreBarrelExportError);

      const alias1 = new UnresolvedWriteBlobExportError("Alias test 1");
      const alias2 = new UnexportedBarrelMemberError("Alias test 2");
      expect(alias1).toBeInstanceOf(EngineStoreBarrelExportError);
      expect(alias2).toBeInstanceOf(EngineStoreBarrelExportError);
    });
  });

  describe("3. AST / Source Analysis & Export Extractors", () => {
    test("extractModuleImports parses static and dynamic imports correctly", () => {
      const source = `
        import { putBlobFile } from "./layout/blobs.ts";
        import type { BlobDescriptor } from "./layout/blobs.ts";
        export { writeBlob } from "./layout/blobs.ts";
        async function load() {
          const mod = await import("./dynamic-store.ts");
        }
      `;
      const imports = extractModuleImports(source);
      expect(imports).toContain("./layout/blobs.ts");
      expect(imports).toContain("./dynamic-store.ts");
      expect(imports.length).toBe(4);
    });

    test("extractExportedSymbols parses functions, classes, types, interfaces, and export blocks", () => {
      const source = `
        export function writeBlob(runRoot: string, sourcePath: string): BlobWriteResult { return putBlobFile(runRoot, sourcePath); }
        export function putBlobFile() {}
        export class BlobManager {}
        export const MAX_BLOB_BYTES = 1024;
        export interface BlobDescriptor {}
        export type BlobWriteResult = BlobPutResult;
        export { linkBlobIntoView, listBlobs as listCapsuleBlobs, type ViewStorage };
      `;
      const symbols = extractExportedSymbols(source);
      expect(symbols).toContain("writeBlob");
      expect(symbols).toContain("putBlobFile");
      expect(symbols).toContain("BlobManager");
      expect(symbols).toContain("MAX_BLOB_BYTES");
      expect(symbols).toContain("BlobDescriptor");
      expect(symbols).toContain("BlobWriteResult");
      expect(symbols).toContain("linkBlobIntoView");
      expect(symbols).toContain("listCapsuleBlobs");
      expect(symbols).toContain("ViewStorage");
    });

    test("extractBarrelReExports extracts specifier, value symbols, and type symbols", () => {
      const source = `
        export {
          blobContentDigest,
          blobRelativePath,
          linkBlobIntoView,
          listBlobs,
          putBlobFile,
          writeBlob,
          type BlobDescriptor,
          type BlobPutResult,
          type BlobWriteResult,
          type ViewLink,
          type ViewLinker,
          type ViewStorage,
        } from "./layout/blobs.ts";

        export type {
          InitRunOptions,
        } from "./capsule/capsule.ts";
      `;
      const reExports = extractBarrelReExports(source);
      expect(reExports.length).toBe(2);

      const blobsBlock = reExports.find((r) => r.specifier === "./layout/blobs.ts");
      expect(blobsBlock).toBeDefined();
      expect(blobsBlock?.symbols).toContain("writeBlob");
      expect(blobsBlock?.symbols).toContain("putBlobFile");
      expect(blobsBlock?.symbols).toContain("blobContentDigest");
      expect(blobsBlock?.typeSymbols).toContain("BlobWriteResult");
      expect(blobsBlock?.typeSymbols).toContain("BlobDescriptor");
      expect(blobsBlock?.isTypeOnly).toBe(false);

      const capsuleBlock = reExports.find((r) => r.specifier === "./capsule/capsule.ts");
      expect(capsuleBlock).toBeDefined();
      expect(capsuleBlock?.typeSymbols).toContain("InitRunOptions");
      expect(capsuleBlock?.isTypeOnly).toBe(true);
    });

    test("isWriteBlobExport and isBlobWriteResultTypeExport predicates match accurately", () => {
      expect(isWriteBlobExport("writeBlob")).toBe(true);
      expect(isWriteBlobExport("putBlobFile")).toBe(false);
      expect(isWriteBlobExport("")).toBe(false);

      expect(isBlobWriteResultTypeExport("BlobWriteResult")).toBe(true);
      expect(isBlobWriteResultTypeExport("BlobPutResult")).toBe(false);
      expect(isBlobWriteResultTypeExport("")).toBe(false);
    });
  });

  describe("4. Blobs Module Export Validation (validateBlobsModuleExports)", () => {
    test("validates live repository blobs.ts module has all required exports", () => {
      const result = validateBlobsModuleExports();
      expect(result.valid).toBe(true);
      expect(result.defectRef).toBe(DEFECT_REF);
      expect(result.writeBlobExported).toBe(true);
      expect(result.blobWriteResultExported).toBe(true);
      expect(result.putBlobFileExported).toBe(true);
      expect(result.blobPutResultExported).toBe(true);
      expect(result.missingSymbols).toEqual([]);
      expect(result.issues).toEqual([]);
    });

    test("detects missing writeBlob and BlobWriteResult in fixture", () => {
      const corruptedSource = `
        export const MAX_BLOB_BYTES = 100;
        export interface BlobDescriptor { sha256: string; }
        export interface BlobPutResult { created: boolean; }
        export function putBlobFile() {}
        export function blobRelativePath() {}
        export function linkBlobIntoView() {}
        export function listBlobs() {}
        export function blobContentDigest() {}
        export interface ViewLink {}
        export interface ViewLinker {}
        export type ViewStorage = "copy";
      `;
      const result = validateBlobsModuleExports(corruptedSource);
      expect(result.valid).toBe(false);
      expect(result.writeBlobExported).toBe(false);
      expect(result.blobWriteResultExported).toBe(false);
      expect(result.missingSymbols).toContain("writeBlob");
      expect(result.missingSymbols).toContain("BlobWriteResult");
      expect(result.issues.length).toBe(2);
      expect(result.issues[0]?.message).toContain("missing required value export 'writeBlob'");
      expect(result.issues[1]?.message).toContain("missing required type export 'BlobWriteResult'");
    });

    test("returns invalid report on non-existent file path", () => {
      const result = validateBlobsModuleExports("/non/existent/path/blobs.ts");
      expect(result.valid).toBe(false);
      expect(result.writeBlobExported).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues[0]?.message).toContain("file not found");
    });
  });

  describe("5. Store Barrel Export Validation (validateStoreBarrelExports & assertValidEngineStoreExports)", () => {
    test("validates live repository engine/store/index.ts has all required exports and re-exports", () => {
      const result = validateStoreBarrelExports();
      expect(result.valid).toBe(true);
      expect(result.defectRef).toBe(DEFECT_REF);
      expect(result.blobsSpecifierFound).toBe(true);
      expect(result.writeBlobReExported).toBe(true);
      expect(result.blobWriteResultReExported).toBe(true);
      expect(result.putBlobFileReExported).toBe(true);
      expect(result.missingReExports).toEqual([]);
      expect(result.issues).toEqual([]);
    });

    test("detects missing writeBlob re-export in fixture store index.ts", () => {
      const corruptedStoreSource = `
        export {
          blobContentDigest,
          blobRelativePath,
          linkBlobIntoView,
          listBlobs,
          putBlobFile,
          type BlobDescriptor,
          type BlobPutResult,
          type ViewLink,
          type ViewLinker,
          type ViewStorage,
        } from "./layout/blobs.ts";
      `;
      const result = validateStoreBarrelExports(corruptedStoreSource);
      expect(result.valid).toBe(false);
      expect(result.writeBlobReExported).toBe(false);
      expect(result.blobWriteResultReExported).toBe(false);
      expect(result.missingReExports).toContain("writeBlob");
      expect(result.missingReExports).toContain("BlobWriteResult");
    });

    test("detects missing blobs specifier altogether", () => {
      const noBlobsStoreSource = `
        export { initRun } from "./capsule/capsule.ts";
      `;
      const result = validateStoreBarrelExports(noBlobsStoreSource);
      expect(result.valid).toBe(false);
      expect(result.blobsSpecifierFound).toBe(false);
      expect(result.issues.some((i) => i.message.includes("does not re-export"))).toBe(true);
    });

    test("assertValidEngineStoreExports succeeds on valid live repository", () => {
      expect(() => assertValidEngineStoreExports()).not.toThrow();
    });

    test("assertValidEngineStoreExports throws EngineStoreBarrelExportError on defective store source", () => {
      const defectiveStore = `export { putBlobFile } from "./layout/blobs.ts";`;
      let thrownError: unknown;
      try {
        assertValidEngineStoreExports(defectiveStore);
      } catch (err) {
        thrownError = err;
      }
      expect(thrownError).toBeInstanceOf(EngineStoreBarrelExportError);
      if (thrownError instanceof EngineStoreBarrelExportError) {
        expect(thrownError.code).toBe(UNEXPORTED_MEMBER_IN_BARREL);
        expect(thrownError.defectRef).toBe(DEFECT_REF);
      }
    });
  });

  describe("6. Source Code Remediation (remediateBlobsModuleExports & remediateStoreBarrelExports)", () => {
    test("remediateBlobsModuleExports inserts writeBlob and BlobWriteResult into un-remediated blobs code", () => {
      const originalSource = `
import { putBlobFile, type BlobPutResult } from "./types.ts";

export interface BlobPutResult {
  sha256: string;
  bytes: number;
  created: boolean;
}

export function putBlobFile(runRoot: string, sourcePath: string): BlobPutResult {
  return { sha256: "abc", bytes: 123, created: true };
}
      `;

      const remediated = remediateBlobsModuleExports(originalSource);
      expect(remediated).toContain("export type BlobWriteResult = BlobPutResult;");
      expect(remediated).toContain(
        "export function writeBlob(runRoot: string, sourcePath: string): BlobWriteResult",
      );
      expect(remediated).toContain("return putBlobFile(runRoot, sourcePath);");

      // Verify idempotency
      const secondPass = remediateBlobsModuleExports(remediated);
      expect(secondPass).toBe(remediated);
    });

    test("remediateStoreBarrelExports updates barrel export block to include writeBlob and BlobWriteResult", () => {
      const originalStore = `
export { initRun } from "./capsule/capsule.ts";
export {
  blobContentDigest,
  blobRelativePath,
  linkBlobIntoView,
  listBlobs,
  putBlobFile,
  type BlobDescriptor,
  type BlobPutResult,
  type ViewLink,
  type ViewLinker,
  type ViewStorage,
} from "./layout/blobs.ts";
export { normalizeRunId } from "./capsule/run-id.ts";
      `;

      const remediated = remediateStoreBarrelExports(originalStore);
      expect(remediated).toContain("writeBlob,");
      expect(remediated).toContain("type BlobWriteResult,");
      expect(remediated).toContain('from "./layout/blobs.ts";');

      // Verify idempotency
      const secondPass = remediateStoreBarrelExports(remediated);
      expect(secondPass).toBe(remediated);
    });

    test("remediateStoreBarrelExports adds blobs export block if missing completely", () => {
      const bareStore = `export { initRun } from "./capsule/capsule.ts";`;
      const remediated = remediateStoreBarrelExports(bareStore);
      expect(remediated).toContain('from "./layout/blobs.ts";');
      expect(remediated).toContain("writeBlob,");
    });
  });

  describe("7. Reconcile Store Blobs Exports (reconcileEngineStoreBlobExports & auditEngineStoreBarrelExports)", () => {
    test("auditEngineStoreBarrelExports audits live repository with resolved: true", () => {
      const audit = auditEngineStoreBarrelExports();
      expect(audit.defectRef).toBe(DEFECT_REF);
      expect(audit.errorCode).toBe(UNEXPORTED_MEMBER_IN_BARREL);
      expect(audit.resolved).toBe(true);
      expect(audit.blobsModuleStatus.valid).toBe(true);
      expect(audit.storeBarrelStatus.valid).toBe(true);
      expect(audit.issues).toEqual([]);
    });

    test("reconcileEngineStoreBlobExports dryRun mode simulates fixes without writing to disk", () => {
      const testDir = createTempDir();
      const storeDir = join(testDir, "olt/scripts/src/engine/store");
      const layoutDir = join(storeDir, "layout");
      mkdirSync(layoutDir, { recursive: true });

      const blobsFile = join(layoutDir, "blobs.ts");
      const storeFile = join(storeDir, "index.ts");

      const originalBlobs = `
export interface BlobPutResult { created: boolean; }
export function putBlobFile(root: string, src: string) { return { created: true }; }
      `;
      const originalStore = `
export {
  putBlobFile,
  type BlobPutResult,
} from "./layout/blobs.ts";
      `;

      writeFileSync(blobsFile, originalBlobs, "utf-8");
      writeFileSync(storeFile, originalStore, "utf-8");

      const result = reconcileEngineStoreBlobExports({
        repoRoot: testDir,
        dryRun: true,
      });

      expect(result.dryRun).toBe(true);
      expect(result.totalReplacements).toBe(2);
      expect(result.reconciledFiles.length).toBe(2);

      // Verify file contents on disk remained unchanged
      expect(readFileSync(blobsFile, "utf-8")).toBe(originalBlobs);
      expect(readFileSync(storeFile, "utf-8")).toBe(originalStore);
    });

    test("reconcileEngineStoreBlobExports writes fixes to disk and resolves issues", () => {
      const testDir = createTempDir();
      const storeDir = join(testDir, "olt/scripts/src/engine/store");
      const layoutDir = join(storeDir, "layout");
      mkdirSync(layoutDir, { recursive: true });

      const blobsFile = join(layoutDir, "blobs.ts");
      const storeFile = join(storeDir, "index.ts");

      const originalBlobs = `
export interface BlobDescriptor { sha256: string; }
export interface BlobPutResult { created: boolean; }
export function putBlobFile(root: string, src: string) { return { created: true }; }
export function blobContentDigest() {}
export function blobRelativePath() {}
export function linkBlobIntoView() {}
export function listBlobs() {}
export interface ViewLink {}
export interface ViewLinker {}
export type ViewStorage = "hardlink";
      `;
      const originalStore = `
export {
  blobContentDigest,
  blobRelativePath,
  linkBlobIntoView,
  listBlobs,
  putBlobFile,
  type BlobDescriptor,
  type BlobPutResult,
  type ViewLink,
  type ViewLinker,
  type ViewStorage,
} from "./layout/blobs.ts";
      `;

      writeFileSync(blobsFile, originalBlobs, "utf-8");
      writeFileSync(storeFile, originalStore, "utf-8");

      const result = reconcileEngineStoreBlobExports({
        repoRoot: testDir,
        dryRun: false,
      });

      expect(result.dryRun).toBe(false);
      expect(result.success).toBe(true);
      expect(result.totalReplacements).toBe(2);

      const fixedBlobs = readFileSync(blobsFile, "utf-8");
      const fixedStore = readFileSync(storeFile, "utf-8");

      expect(fixedBlobs).toContain("writeBlob");
      expect(fixedBlobs).toContain("BlobWriteResult");
      expect(fixedStore).toContain("writeBlob");
      expect(fixedStore).toContain("BlobWriteResult");

      const audit = auditEngineStoreBarrelExports({ repoRoot: testDir });
      expect(audit.resolved).toBe(true);
    });
  });

  describe("8. Runtime Blob Operations & Bridge Verification", () => {
    test("writeBlobDirect writes blob file to root and verifies hash and metadata", () => {
      const root = createTempDir("write-blob-test-");
      const source = join(root, "input.txt");
      writeFileSync(source, "runtime blob test content");

      const result = writeBlobDirect(root, source);
      expect(result.created).toBe(true);
      expect(result.sha256).toBe(sha256Of("runtime blob test content"));
      expect(result.bytes).toBe("runtime blob test content".length);
      expect(result.path).toBe(`blobs/${result.sha256.slice(0, 2)}/${result.sha256}`);

      // Second write should be idempotent with created: false
      const second = writeBlobDirect(root, source);
      expect(second.created).toBe(false);
      expect(second.sha256).toBe(result.sha256);
    });

    test("writeBlobFromMemory writes in-memory string or buffer directly to blob store", () => {
      const root = createTempDir("mem-blob-test-");
      const result = writeBlobFromMemory(root, "in-memory payload 12345");
      expect(result.created).toBe(true);
      expect(result.sha256).toBe(sha256Of("in-memory payload 12345"));

      const bufferResult = writeBlobFromMemory(
        root,
        Buffer.from("buffer payload 67890"),
        "custom-mem.tmp",
      );
      expect(bufferResult.created).toBe(true);
      expect(bufferResult.sha256).toBe(sha256Of("buffer payload 67890"));
    });

    test("validateBlobWriteIntegrity validates stored blob sha256 checksum", () => {
      const root = createTempDir("integrity-test-");
      const source = join(root, "data.bin");
      writeFileSync(source, "integrity verified content");
      const result = writeBlobDirect(root, source);

      expect(validateBlobWriteIntegrity(root, result.sha256)).toBe(true);
      expect(validateBlobWriteIntegrity(root, "f".repeat(64))).toBe(false);
    });

    test("verifyLiveStoreBarrelIntegrity verifies all store blob symbols are callable", () => {
      const integrity = verifyLiveStoreBarrelIntegrity();
      expect(integrity.verified).toBe(true);
      expect(integrity.writeBlobCallable).toBe(true);
      expect(integrity.putBlobCallable).toBe(true);
      expect(integrity.listBlobsCallable).toBe(true);
      expect(integrity.digestCallable).toBe(true);
      expect(integrity.relativePathCallable).toBe(true);
      expect(integrity.details).toContain("verified callable");
    });
  });

  describe("9. Defect Proof Creation & End-to-End Verification", () => {
    test("createEngineStoreDefectEntry creates a schema-compliant DefectEntry", () => {
      const entry = createEngineStoreDefectEntry({
        status: "resolved",
      });
      expect(entry.id).toContain(DEFECT_REF);
      expect(entry.domain).toBe("engine-store");
      expect(entry.error_code).toBe(UNEXPORTED_MEMBER_IN_BARREL);
      expect(entry.status).toBe("resolved");
      expect(entry.type).toBe("CODE_HEALTH");
      expect(entry.category).toBe("modularity_violation");
      expect(entry.severity).toBe("high");
      expect(entry.resolution).toBeDefined();
      expect(entry.resolution?.verified).toBe(true);
      expect(entry.resolution?.task_id).toBe("Task 1.5");
      expect(entry.resolution?.empirical_command).toContain(
        "bun test tests/unit/tooling/defect-engine-store-unresolved-write-blob-export.test.ts",
      );
    });

    test("createEngineStoreDefectProof creates a valid DefectResolutionProof", () => {
      const proof = createEngineStoreDefectProof();
      expect(proof.task_id).toBe("Task 1.5");
      expect(proof.verified).toBe(true);
      expect(proof.empirical_command).toContain(
        "bun test tests/unit/tooling/defect-engine-store-unresolved-write-blob-export.test.ts",
      );
      expect(proof.explanation).toContain("writeBlob and BlobWriteResult are declared and exported");
    });

    test("verifyEngineStoreRemediation runs full verification cycle with 100% PASS result", () => {
      const verification = verifyEngineStoreRemediation();
      expect(verification.defectRef).toBe(DEFECT_REF);
      expect(verification.errorCode).toBe(UNEXPORTED_MEMBER_IN_BARREL);
      expect(verification.verified).toBe(true);
      expect(verification.auditReport.resolved).toBe(true);
      expect(verification.liveIntegrity.verified).toBe(true);
      expect(verification.defectEntry.status).toBe("resolved");
      expect(verification.proof.verified).toBe(true);
    });
  });
});
