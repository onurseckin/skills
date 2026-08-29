import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  assertValidEngineStoreExports, auditEngineStoreBarrelExports, CANONICAL_BLOBS_MODULE_PATH,
  CANONICAL_BLOBS_RELATIVE_SPECIFIER, CANONICAL_STORE_BARREL_PATH, createEngineStoreDefectEntry,
  createEngineStoreDefectProof, DEFECT_REF, EngineStoreBarrelExportError, ERROR_CODE,
  extractBarrelReExports, extractExportedSymbols, extractModuleImports, INVARIANT_DESCRIPTION,
  INVARIANT_NUMBER, INVARIANT_REF, isBlobWriteResultTypeExport, isWriteBlobExport,
  reconcileEngineStoreBlobExports, remediateBlobsModuleExports, remediateStoreBarrelExports,
  REQUIRED_BLOBS_TYPE_EXPORTS, REQUIRED_BLOBS_VALUE_EXPORTS, REQUIRED_STORE_BARREL_EXPORTS,
  TARGET_EXPORT_SYMBOLS, UnexportedBarrelMemberError, UNEXPORTED_MEMBER_IN_BARREL,
  UnresolvedWriteBlobExportError, validateBlobWriteIntegrity, validateBlobsModuleExports,
  validateStoreBarrelExports, verifyEngineStoreRemediation, verifyLiveStoreBarrelIntegrity,
  writeBlobDirect, writeBlobFromMemory,
} from "../../../olt/scripts/src/tooling/defect-engine-store-unresolved-write-blob-export.ts";

const tempDirs: string[] = [];
function createTempDir(prefix = "store-blob-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
function sha256Of(content: string): string { return createHash("sha256").update(content).digest("hex"); }

describe("Task 1.5: Defect Remediation - Unresolved writeBlob export in engine/store/index.ts", () => {
  describe("1. Defect Constants & Canonical Specifiers", () => {
    test("exports canonical defect reference and error code constants", () => {
      expect(DEFECT_REF).toBe("defect-engine-store-unresolved-write-blob-export");
      expect(ERROR_CODE).toBe("UNEXPORTED_MEMBER_IN_BARREL");
      expect(UNEXPORTED_MEMBER_IN_BARREL).toBe("UNEXPORTED_MEMBER_IN_BARREL");
      expect(INVARIANT_NUMBER).toBe(5);
      expect(INVARIANT_REF).toBe("Invariant 1.5");
      expect(INVARIANT_DESCRIPTION).toContain("Engine store barrel");
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
      expect(REQUIRED_BLOBS_TYPE_EXPORTS).toContain("BlobWriteResult");
      expect(TARGET_EXPORT_SYMBOLS).toContain("writeBlob");
    });
  });

  describe("2. Custom Error Classes & Error Aliases", () => {
    test("EngineStoreBarrelExportError instantiates with default defect metadata", () => {
      const err = new EngineStoreBarrelExportError("Missing writeBlob export in barrel");
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(EngineStoreBarrelExportError);
      expect(err.name).toBe("EngineStoreBarrelExportError");
      expect(err.code).toBe(UNEXPORTED_MEMBER_IN_BARREL);
      expect(err.defectRef).toBe(DEFECT_REF);
      expect(err.issues).toEqual([]);
    });

    test("EngineStoreBarrelExportError preserves custom options and aliases match", () => {
      const customIssues = [{ code: UNEXPORTED_MEMBER_IN_BARREL, message: "not found", member: "writeBlob" }];
      const err = new EngineStoreBarrelExportError("Custom error", { code: "CUSTOM_ERR", defectRef: "ref", specifier: "./blobs.ts", missingMember: "writeBlob", filePath: "index.ts", issues: customIssues });
      expect(err.code).toBe("CUSTOM_ERR");
      expect(err.missingMember).toBe("writeBlob");
      expect(err.issues).toEqual(customIssues);

      expect(UnresolvedWriteBlobExportError).toBe(EngineStoreBarrelExportError);
      expect(UnexportedBarrelMemberError).toBe(EngineStoreBarrelExportError);
    });
  });

  describe("3. AST / Source Analysis & Export Extractors", () => {
    test("extractModuleImports and extractExportedSymbols parse imports and declarations", () => {
      const source = `
        import { putBlobFile } from "./layout/blobs.ts";
        export { writeBlob } from "./layout/blobs.ts";
        export function customBlob() {}
        export interface BlobDescriptor {}
        export type BlobWriteResult = BlobPutResult;
      `;
      const imports = extractModuleImports(source);
      expect(imports).toContain("./layout/blobs.ts");

      const symbols = extractExportedSymbols(source);
      expect(symbols).toContain("writeBlob");
      expect(symbols).toContain("customBlob");
      expect(symbols).toContain("BlobDescriptor");
      expect(symbols).toContain("BlobWriteResult");
    });

    test("extractBarrelReExports and symbol predicates extract structured export records", () => {
      const source = `
        export { writeBlob, putBlobFile, type BlobWriteResult } from "./layout/blobs.ts";
      `;
      const reExports = extractBarrelReExports(source);
      expect(reExports.length).toBe(1);
      expect(reExports[0]?.symbols).toContain("writeBlob");
      expect(reExports[0]?.typeSymbols).toContain("BlobWriteResult");

      expect(isWriteBlobExport("writeBlob")).toBe(true);
      expect(isWriteBlobExport("putBlobFile")).toBe(false);
      expect(isBlobWriteResultTypeExport("BlobWriteResult")).toBe(true);
    });
  });

  describe("4. Blobs Module Export Validation (validateBlobsModuleExports)", () => {
    test("validates live repository blobs.ts module has all required exports", () => {
      const result = validateBlobsModuleExports();
      expect(result.valid).toBe(true);
      expect(result.defectRef).toBe(DEFECT_REF);
      expect(result.writeBlobExported).toBe(true);
      expect(result.blobWriteResultExported).toBe(true);
      expect(result.issues).toEqual([]);
    });

    test("detects missing writeBlob in fixture and handles missing file", () => {
      const broken = `export function putBlobFile() {} export interface BlobPutResult { created: boolean; }`;
      const res = validateBlobsModuleExports(broken);
      expect(res.valid).toBe(false);
      expect(res.writeBlobExported).toBe(false);
      expect(res.missingSymbols).toContain("writeBlob");

      const missingFileRes = validateBlobsModuleExports("/nonexistent/blobs.ts");
      expect(missingFileRes.valid).toBe(false);
      expect(missingFileRes.issues.length).toBeGreaterThan(0);
    });
  });

  describe("5. Store Barrel Export Validation (validateStoreBarrelExports & assertValidEngineStoreExports)", () => {
    test("validates live repository store barrel re-exports cleanly", () => {
      const result = validateStoreBarrelExports();
      expect(result.valid).toBe(true);
      expect(result.defectRef).toBe(DEFECT_REF);
      expect(result.writeBlobReExported).toBe(true);
      expect(result.blobWriteResultReExported).toBe(true);
      expect(result.issues).toEqual([]);
      expect(() => assertValidEngineStoreExports()).not.toThrow();
    });

    test("detects missing re-exports and throws EngineStoreBarrelExportError on assertion failure", () => {
      const brokenStore = `export { putBlobFile } from "./layout/blobs.ts";`;
      const res = validateStoreBarrelExports(brokenStore);
      expect(res.valid).toBe(false);
      expect(res.missingReExports).toContain("writeBlob");

      let caught: unknown;
      try { assertValidEngineStoreExports(brokenStore); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(EngineStoreBarrelExportError);
    });
  });

  describe("6. Source Code Remediation (remediateBlobsModuleExports & remediateStoreBarrelExports)", () => {
    test("remediateBlobsModuleExports inserts writeBlob and BlobWriteResult into blobs source", () => {
      const orig = `export interface BlobPutResult { created: boolean; }\nexport function putBlobFile(root: string, src: string) { return { created: true }; }`;
      const fixed = remediateBlobsModuleExports(orig);
      expect(fixed).toContain("export type BlobWriteResult = BlobPutResult;");
      expect(fixed).toContain("export function writeBlob");
      expect(remediateBlobsModuleExports(fixed)).toBe(fixed);
    });

    test("remediateStoreBarrelExports updates barrel re-export block cleanly", () => {
      const orig = `export { putBlobFile } from "./layout/blobs.ts";`;
      const fixed = remediateStoreBarrelExports(orig);
      expect(fixed).toContain("writeBlob,");
      expect(fixed).toContain("type BlobWriteResult,");
      expect(remediateStoreBarrelExports(fixed)).toBe(fixed);
    });
  });

  describe("7. Reconcile Store Blobs Exports (reconcileEngineStoreBlobExports & auditEngineStoreBarrelExports)", () => {
    test("auditEngineStoreBarrelExports audits live repository with resolved: true", () => {
      const audit = auditEngineStoreBarrelExports();
      expect(audit.defectRef).toBe(DEFECT_REF);
      expect(audit.resolved).toBe(true);
      expect(audit.issues).toEqual([]);
    });

    test("reconcileEngineStoreBlobExports performs dryRun and live reconciliation across fixtures", () => {
      const testDir = createTempDir();
      const storeDir = join(testDir, "olt/scripts/src/engine/store");
      const layoutDir = join(storeDir, "layout");
      mkdirSync(layoutDir, { recursive: true });
      const blobsFile = join(layoutDir, "blobs.ts");
      const storeFile = join(storeDir, "index.ts");
      const origBlobs = `export interface BlobPutResult { created: boolean; }\nexport function putBlobFile(r: string, s: string) { return { created: true }; }`;
      const origStore = `export { putBlobFile, type BlobPutResult } from "./layout/blobs.ts";`;
      writeFileSync(blobsFile, origBlobs, "utf-8");
      writeFileSync(storeFile, origStore, "utf-8");

      const dryResult = reconcileEngineStoreBlobExports({ repoRoot: testDir, dryRun: true });
      expect(dryResult.dryRun).toBe(true);
      expect(dryResult.totalReplacements).toBe(2);
      expect(readFileSync(blobsFile, "utf-8")).toBe(origBlobs);

      const liveResult = reconcileEngineStoreBlobExports({ repoRoot: testDir, dryRun: false });
      expect(liveResult.dryRun).toBe(false);
      expect(liveResult.success).toBe(true);
      expect(readFileSync(blobsFile, "utf-8")).toContain("writeBlob");
      expect(readFileSync(storeFile, "utf-8")).toContain("writeBlob");
    });
  });

  describe("8. Runtime Blob Operations & Bridge Verification", () => {
    test("writeBlobDirect and writeBlobFromMemory store content and verify integrity", () => {
      const root = createTempDir("runtime-blob-test-");
      const src = join(root, "file.txt");
      writeFileSync(src, "blob payload test");

      const res1 = writeBlobDirect(root, src);
      expect(res1.created).toBe(true);
      expect(res1.sha256).toBe(sha256Of("blob payload test"));
      expect(validateBlobWriteIntegrity(root, res1.sha256)).toBe(true);

      const res2 = writeBlobFromMemory(root, "mem payload 999");
      expect(res2.created).toBe(true);
      expect(res2.sha256).toBe(sha256Of("mem payload 999"));
      expect(validateBlobWriteIntegrity(root, res2.sha256)).toBe(true);
    });

    test("verifyLiveStoreBarrelIntegrity verifies live barrel functions are callable", () => {
      const integrity = verifyLiveStoreBarrelIntegrity();
      expect(integrity.verified).toBe(true);
      expect(integrity.writeBlobCallable).toBe(true);
      expect(integrity.putBlobCallable).toBe(true);
    });
  });

  describe("9. Defect Proof Creation & End-to-End Verification", () => {
    test("createEngineStoreDefectEntry, createEngineStoreDefectProof, and verifyEngineStoreRemediation succeed", () => {
      const entry = createEngineStoreDefectEntry({ status: "resolved" });
      expect(entry.id).toContain(DEFECT_REF);
      expect(entry.error_code).toBe(UNEXPORTED_MEMBER_IN_BARREL);
      expect(entry.status).toBe("resolved");

      const proof = createEngineStoreDefectProof();
      expect(proof.task_id).toBe("Task 1.5");
      expect(proof.verified).toBe(true);
      expect(proof.empirical_command).toContain("bun test tests/unit/tooling/defect-engine-store-unresolved-write-blob-export.test.ts");

      const verification = verifyEngineStoreRemediation();
      expect(verification.defectRef).toBe(DEFECT_REF);
      expect(verification.verified).toBe(true);
      expect(verification.auditReport.resolved).toBe(true);
      expect(verification.liveIntegrity.verified).toBe(true);
    });
  });
});
