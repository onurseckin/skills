/**
 * Defect Remediation: Unresolved import '../../reporting/core/certify-command' in cli/registry/diagnostics.ts
 * Defect Ref: defect-cli-diagnostics-unresolved-certify-import
 * Error Code: UNRESOLVED_MODULE_IMPORT_IN_CLI
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { COMMAND_REGISTRY } from "../cli/registry/index.ts";
import { doctorCertifyCommand } from "../reporting/doctor/certify-command.ts";

export const CANONICAL_CERTIFY_IMPORT_PATH = "../../reporting/doctor/certify-command.ts" as const;
export const CANONICAL_CERTIFY_MODULE_SUBPATH = "reporting/doctor/certify-command.ts" as const;
export const LEGACY_CERTIFY_MODULE_SUBPATH = "reporting/core/certify-command" as const;
export const LEGACY_CERTIFY_IMPORT_PATH = "../../reporting/core/certify-command.ts" as const;
export const DEFECT_REF = "defect-cli-diagnostics-unresolved-certify-import" as const;
export const UNRESOLVED_MODULE_IMPORT_IN_CLI = "UNRESOLVED_MODULE_IMPORT_IN_CLI" as const;

export interface CliImportResolutionErrorOptions {
  readonly code?: string | undefined;
  readonly defectRef?: string | undefined;
  readonly specifier?: string | undefined;
  readonly filePath?: string | undefined;
  readonly cause?: unknown;
}

export class CliImportResolutionError extends Error {
  readonly code: string;
  readonly defectRef: string;
  readonly specifier: string | undefined;
  readonly filePath: string | undefined;

  constructor(message: string, options?: CliImportResolutionErrorOptions) {
    super(message);
    this.name = "CliImportResolutionError";
    this.code = options?.code ?? UNRESOLVED_MODULE_IMPORT_IN_CLI;
    this.defectRef = options?.defectRef ?? DEFECT_REF;
    this.specifier = options?.specifier;
    this.filePath = options?.filePath;
  }
}

export interface CliDiagnosticsImportValidationResult {
  readonly defectRef: typeof DEFECT_REF;
  readonly valid: boolean;
  readonly legacyImportDetected: boolean;
  readonly canonicalImportPresent: boolean;
  readonly imports: readonly string[];
  readonly issues: readonly string[];
  readonly targetPath?: string | undefined;
}

export interface CliRegistryGraphAuditResult {
  readonly defectRef: typeof DEFECT_REF;
  readonly resolved: boolean;
  readonly targetFile: string;
  readonly canonicalCertifyPath: string;
  readonly importedModules: readonly string[];
  readonly commandCount: number;
  readonly certifiedCommandRegistered: boolean;
  readonly issues: readonly string[];
}

export function extractModuleImports(sourceCode: string): readonly string[] {
  const imports: string[] = [];
  const staticImportRegex =
    /(?:^|\n)\s*(?:import|export)\s+(?:(?:type\s+)?(?:(?:\*\s+as\s+[\w$]+|[\w$,\s{}]+)\s+from\s+)?|)["']([^"']+)["']/g;
  const dynamicImportRegex = /import\s*\(\s*["']([^"']+)["']\s*\)/g;

  let match: RegExpExecArray | null;
  while ((match = staticImportRegex.exec(sourceCode)) !== null) {
    if (match[1]) {
      imports.push(match[1]);
    }
  }
  while ((match = dynamicImportRegex.exec(sourceCode)) !== null) {
    if (match[1]) {
      imports.push(match[1]);
    }
  }
  return imports;
}

export function isLegacyCertifyCommandImport(importPathOrSpecifier: string): boolean {
  if (typeof importPathOrSpecifier !== "string" || importPathOrSpecifier.trim() === "") {
    return false;
  }
  const normalized = importPathOrSpecifier.trim().replace(/\\/g, "/");
  return (
    normalized.includes(LEGACY_CERTIFY_MODULE_SUBPATH) ||
    normalized === LEGACY_CERTIFY_IMPORT_PATH ||
    normalized === "../../reporting/core/certify-command" ||
    normalized === "../reporting/core/certify-command" ||
    normalized === "./reporting/core/certify-command"
  );
}

export function resolveCertifyCommandImportPath(importPathOrSpecifier: string): string {
  if (!isLegacyCertifyCommandImport(importPathOrSpecifier)) {
    return importPathOrSpecifier;
  }
  return importPathOrSpecifier.replace(
    /(\.\.\/)*reporting\/core\/certify-command(\.ts)?/,
    (match) => {
      if (match.startsWith("../../")) {
        return CANONICAL_CERTIFY_IMPORT_PATH;
      }
      return match.replace("reporting/core/certify-command", CANONICAL_CERTIFY_MODULE_SUBPATH);
    },
  );
}

export function remediateCliDiagnosticsImports(sourceCode: string): string {
  return sourceCode.replace(
    /(['"])(?:\.\.\/)*reporting\/core\/certify-command(?:\.ts)?\1/g,
    `"${CANONICAL_CERTIFY_IMPORT_PATH}"`,
  );
}

export function validateCliDiagnosticsImports(
  sourceCodeOrFilePath?: string,
): CliDiagnosticsImportValidationResult {
  let content = "";
  let targetPath: string | undefined;

  if (!sourceCodeOrFilePath) {
    targetPath = resolve(process.cwd(), "olt/scripts/src/cli/registry/diagnostics.ts");
    if (!existsSync(targetPath)) {
      return {
        defectRef: DEFECT_REF,
        valid: false,
        legacyImportDetected: false,
        canonicalImportPresent: false,
        imports: [],
        issues: [`Diagnostics registry file does not exist at ${targetPath}`],
        targetPath,
      };
    }
    content = readFileSync(targetPath, "utf-8");
  } else if (
    !sourceCodeOrFilePath.includes("\n") &&
    (sourceCodeOrFilePath.endsWith(".ts") ||
      sourceCodeOrFilePath.endsWith(".js") ||
      existsSync(sourceCodeOrFilePath))
  ) {
    targetPath = resolve(sourceCodeOrFilePath);
    if (!existsSync(targetPath)) {
      return {
        defectRef: DEFECT_REF,
        valid: false,
        legacyImportDetected: false,
        canonicalImportPresent: false,
        imports: [],
        issues: [`File not found at ${targetPath}`],
        targetPath,
      };
    }
    content = readFileSync(targetPath, "utf-8");
  } else {
    content = sourceCodeOrFilePath;
  }

  const imports = extractModuleImports(content);
  const issues: string[] = [];
  let legacyImportDetected = false;
  let canonicalImportPresent = false;

  for (const imp of imports) {
    if (isLegacyCertifyCommandImport(imp)) {
      legacyImportDetected = true;
      issues.push(
        `Unresolved legacy certify-command import '${imp}' detected. Should be '${CANONICAL_CERTIFY_IMPORT_PATH}'.`,
      );
    }
    if (
      imp === CANONICAL_CERTIFY_IMPORT_PATH ||
      imp.includes(CANONICAL_CERTIFY_MODULE_SUBPATH)
    ) {
      canonicalImportPresent = true;
    }
  }

  const valid = !legacyImportDetected && issues.length === 0;

  return {
    defectRef: DEFECT_REF,
    valid,
    legacyImportDetected,
    canonicalImportPresent,
    imports,
    issues,
    targetPath,
  };
}

export function assertValidCliDiagnosticsImports(sourceCodeOrFilePath?: string): void {
  const result = validateCliDiagnosticsImports(sourceCodeOrFilePath);
  if (!result.valid) {
    throw new CliImportResolutionError(
      `CLI diagnostics import validation failed: ${result.issues.join("; ")}`,
      {
        code: UNRESOLVED_MODULE_IMPORT_IN_CLI,
        defectRef: DEFECT_REF,
        filePath: result.targetPath,
        specifier: result.legacyImportDetected ? LEGACY_CERTIFY_IMPORT_PATH : undefined,
      },
    );
  }
}

export function auditCliRegistryModuleGraph(diagnosticsFilePath?: string): CliRegistryGraphAuditResult {
  const target = diagnosticsFilePath
    ? resolve(diagnosticsFilePath)
    : resolve(process.cwd(), "olt/scripts/src/cli/registry/diagnostics.ts");

  const validation = validateCliDiagnosticsImports(target);
  const issues = [...validation.issues];

  let commandCount = 0;
  let certifiedCommandRegistered = false;

  try {
    const diagnosticsCommands = COMMAND_REGISTRY.filter((cmd) => cmd.domain === "diagnostics");
    commandCount = diagnosticsCommands.length;
    const certifyCmd = diagnosticsCommands.find((cmd) => cmd.name === "doctor:certify");
    if (certifyCmd) {
      certifiedCommandRegistered = certifyCmd.handler === doctorCertifyCommand;
    } else {
      issues.push("Command 'doctor:certify' not found in diagnostics commands registry");
    }
  } catch (err) {
    issues.push(
      `Failed to audit COMMAND_REGISTRY: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const resolved = validation.valid && issues.length === 0 && certifiedCommandRegistered;

  return {
    defectRef: DEFECT_REF,
    resolved,
    targetFile: target,
    canonicalCertifyPath: CANONICAL_CERTIFY_IMPORT_PATH,
    importedModules: validation.imports,
    commandCount,
    certifiedCommandRegistered,
    issues,
  };
}
