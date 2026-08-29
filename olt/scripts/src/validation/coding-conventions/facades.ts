export interface FacadeExportViolation {
  readonly line: number;
  readonly statement: string;
  readonly reason: string;
}

export interface FacadeValidationResult {
  readonly valid: boolean;
  readonly filePath?: string | undefined;
  readonly namedExports: readonly string[];
  readonly hasWildcardExport: boolean;
  readonly violations: readonly FacadeExportViolation[];
}

const WILDCARD_EXPORT_REGEX = /^\s*export\s+\*\s*(?:as\s+\w+\s+)?from\s+['"][^'"]+['"]/m;
const DEFAULT_EXPORT_REGEX = /^\s*export\s+default\b/m;

export function validateFacadeExports(code: string, filePath?: string): FacadeValidationResult {
  const violations: FacadeExportViolation[] = [];
  const namedExports: string[] = [];
  let hasWildcard = false;

  code.split("\n").forEach((raw, idx) => {
    const trimmed = raw.trim();
    if (WILDCARD_EXPORT_REGEX.test(trimmed)) {
      hasWildcard = true;
      violations.push({
        line: idx + 1,
        statement: trimmed,
        reason: "Wildcard export '*' is strictly forbidden in facades",
      });
    }
    if (DEFAULT_EXPORT_REGEX.test(trimmed)) {
      violations.push({
        line: idx + 1,
        statement: trimmed,
        reason: "Default export is forbidden in facades; use explicit named exports",
      });
    }
  });

  const exportBlockRegex = /export\s*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = exportBlockRegex.exec(code)) !== null) {
    const blockContent = match[1];
    if (blockContent !== undefined) {
      for (const item of blockContent.split(",")) {
        const clean = item.trim().replace(/^type\s+/, "");
        const parts = clean.split(/\s+as\s+/);
        const name = (parts[1] || parts[0] || "").trim();
        if (name.length > 0) namedExports.push(name);
      }
    }
  }

  const directDeclRegex =
    /export\s+(?:async\s+)?(?:function\*?|class|const|let|var|type|interface|enum)\s+([a-zA-Z0-9_$]+)/g;
  while ((match = directDeclRegex.exec(code)) !== null) {
    const declName = match[1];
    if (declName && !namedExports.includes(declName)) namedExports.push(declName);
  }

  return {
    valid: violations.length === 0,
    ...(filePath !== undefined ? { filePath } : {}),
    namedExports,
    hasWildcardExport: hasWildcard,
    violations,
  };
}
