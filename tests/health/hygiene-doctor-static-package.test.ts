import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ALLOWED_ROOT_FILES } from "../../olt/scripts/src/authority/guards/constants.ts";
import {
  scanRepoRoot,
  scanRootHygiene,
  scanStaticPackage,
} from "../../olt/scripts/src/health/hygiene/index.ts";
import { checkRepositoryHygiene } from "../../olt/scripts/src/reporting/doctor/hygiene-engine.ts";
import { cleanupVirtualHealthFS, mockFs, setupVirtualHealthFS, vfs } from "./fixture.ts";

beforeEach(() => {
  setupVirtualHealthFS();
});

afterEach(() => {
  cleanupVirtualHealthFS();
});

function createMockWorkspace(): string {
  const dir = `/virtual/hygiene-recon-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  vfs.mkdirSync(dir, { recursive: true });
  vfs.writeFileSync(join(dir, "package.json"), "{}");
  vfs.writeFileSync(join(dir, "README.md"), "# Mock");
  vfs.writeFileSync(join(dir, "tsconfig.json"), "{}");
  return dir;
}

describe("Health Hygiene - Doctor Static Package Reconciliation", () => {
  test("ALLOWED_ROOT_FILES includes .session.json and permits it in repo root", () => {
    expect(ALLOWED_ROOT_FILES.has(".session.json")).toBe(true);

    const ws = createMockWorkspace();
    vfs.writeFileSync(join(ws, ".session.json"), JSON.stringify({ token: "test-token" }));

    const repoScan = scanRepoRoot(ws, ALLOWED_ROOT_FILES, new Set(["olt", "scripts"]));
    expect(repoScan.findings).toHaveLength(0);

    const hygieneScan = scanRootHygiene({ repoRoot: ws });
    expect(hygieneScan.passed).toBe(true);
    expect(hygieneScan.violations).toHaveLength(0);
  });

  test("scanStaticPackage ignores static reference documents under olt/references/", () => {
    const ws = createMockWorkspace();
    const oltDir = join(ws, "olt");
    const refDir = join(oltDir, "references", "cli-capabilities");
    const reportDir = join(refDir, "commands", "reporting", "reports");
    vfs.mkdirSync(reportDir, { recursive: true });

    vfs.writeFileSync(join(refDir, "index.jsonl"), '{"capability":"agent:define"}\n');
    vfs.writeFileSync(join(reportDir, "report.json"), '{"summary":"report"}\n');
    vfs.writeFileSync(join(refDir, "reference.log"), "sample log output\n");
    vfs.writeFileSync(join(refDir, "temporary.tmp"), "transient spec content\n");

    const scanResult = scanStaticPackage(oltDir, ws);
    expect(scanResult.findings).toHaveLength(0);
    expect(scanResult.count).toBe(0);
  });

  test("scanStaticPackage ignores source code directory olt/scripts/src/ui-validation/quarantine/", () => {
    const ws = createMockWorkspace();
    const oltDir = join(ws, "olt");
    const quarantineSourceDir = join(oltDir, "scripts", "src", "ui-validation", "quarantine");
    const identityDir = join(quarantineSourceDir, "identity");
    vfs.mkdirSync(identityDir, { recursive: true });

    vfs.writeFileSync(
      join(quarantineSourceDir, "index.ts"),
      "export const quarantineReady = true;\n",
    );
    vfs.writeFileSync(
      join(identityDir, "check.ts"),
      "export function checkIdentity(): boolean { return true; }\n",
    );

    const scanResult = scanStaticPackage(oltDir, ws);
    expect(scanResult.findings).toHaveLength(0);
    expect(scanResult.count).toBe(3);
  });

  test("scanStaticPackage continues to detect real runtime pollution in olt/", () => {
    const ws = createMockWorkspace();
    const oltDir = join(ws, "olt");
    const runtimeQuarantineDir = join(oltDir, "quarantine");
    const coverageDir = join(oltDir, "coverage");
    const logsDir = join(oltDir, "logs");
    const tmpDir = join(oltDir, ".tmp");
    const scratchDir = join(oltDir, "scratch");

    vfs.mkdirSync(runtimeQuarantineDir, { recursive: true });
    vfs.mkdirSync(coverageDir, { recursive: true });
    vfs.mkdirSync(logsDir, { recursive: true });
    vfs.mkdirSync(tmpDir, { recursive: true });
    vfs.mkdirSync(scratchDir, { recursive: true });

    vfs.writeFileSync(join(oltDir, "defects.jsonl"), '{"id":"def-1"}\n');
    vfs.writeFileSync(join(oltDir, "report.json"), '{"status":"dirty"}\n');
    vfs.writeFileSync(join(oltDir, ".session.json"), '{"session":"stray"}\n');
    vfs.writeFileSync(join(oltDir, "audit.log"), "stray log\n");
    vfs.writeFileSync(join(oltDir, "transient.tmp"), "stray temp\n");

    const scanResult = scanStaticPackage(oltDir, ws);
    expect(scanResult.findings.length).toBe(10);
    for (const finding of scanResult.findings) {
      expect(finding.scope).toBe("static_package");
      expect(finding.violationType).toBe("STATIC_PACKAGE_RUNTIME_POLLUTION");
      expect(finding.severity).toBe("ERROR");
    }
  });

  test("reconciles all 4 Doctor static package hygiene defects in end-to-end audit", () => {
    const ws = createMockWorkspace();
    const oltDir = join(ws, "olt");
    const refDir = join(oltDir, "references", "cli-capabilities");
    const reportDir = join(refDir, "commands", "reporting", "reports");
    const quarantineSourceDir = join(oltDir, "scripts", "src", "ui-validation", "quarantine");

    vfs.mkdirSync(reportDir, { recursive: true });
    vfs.mkdirSync(quarantineSourceDir, { recursive: true });

    vfs.writeFileSync(join(ws, ".session.json"), '{"sessionId":"session-active-001"}\n');
    vfs.writeFileSync(join(refDir, "index.jsonl"), '{"name":"agent-brief","type":"spec"}\n');
    vfs.writeFileSync(join(reportDir, "report.json"), '{"format":"json","schema":"reference"}\n');
    vfs.writeFileSync(
      join(quarantineSourceDir, "index.ts"),
      "export const quarantineGuard = true;\n",
    );

    const rootHygieneResult = scanRootHygiene({ repoRoot: ws });
    expect(rootHygieneResult.passed).toBe(true);
    expect(rootHygieneResult.violations).toHaveLength(0);
    expect(rootHygieneResult.quarantinedFiles).toHaveLength(0);

    const doctorResult = checkRepositoryHygiene({ repoRoot: ws });
    expect(doctorResult.passed).toBe(true);
    expect(doctorResult.violations).toHaveLength(0);
    expect(doctorResult.scrubbedFiles).toHaveLength(0);
  });

  test("touched hygiene files satisfy strict repository invariants", () => {
    const files = [
      "olt/scripts/src/authority/guards/constants.ts",
      "olt/scripts/src/health/hygiene/scanner.ts",
      "olt/scripts/src/health/hygiene/static-package.ts",
      "tests/health/hygiene-doctor-static-package.test.ts",
    ];

    for (const rel of files) {
      const fullPath = join(process.cwd(), rel);
      expect(mockFs.existsSync(fullPath)).toBe(true);
      const raw = mockFs.readFileSync(fullPath, "utf8");
      const lines = raw.split("\n");

      expect(lines.length).toBeLessThanOrEqual(300);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const trimmed = line.trim();
        const lineNum = i + 1;

        expect(trimmed.startsWith("//")).toBe(false);
        expect(trimmed.startsWith("/*")).toBe(false);
        expect(trimmed.startsWith("*")).toBe(false);

        expect(trimmed.includes("@" + "ts-ignore")).toBe(false);
        expect(trimmed.includes("@" + "ts-expect-error")).toBe(false);
        expect(trimmed.includes("@" + "ts-nocheck")).toBe(false);
        expect(trimmed.includes("eslint" + "-disable")).toBe(false);

        const hasAny =
          new RegExp(":\\s*" + "any\\b").test(trimmed) ||
          new RegExp("as\\s+" + "any\\b").test(trimmed) ||
          new RegExp("<" + "any>").test(trimmed) ||
          new RegExp("Record<[^,]+,\\s*" + "any>").test(trimmed) ||
          new RegExp("Promise<" + "any>").test(trimmed);

        if (hasAny) {
          throw new Error(`any found at line ${lineNum} in ${rel}: ${trimmed}`);
        }
        expect(hasAny).toBe(false);
      }
    }
  });
});
