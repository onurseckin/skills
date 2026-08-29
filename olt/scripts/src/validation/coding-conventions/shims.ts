export interface ShimViolation {
  readonly line: number;
  readonly identifier?: string | undefined;
  readonly snippet: string;
  readonly reason: string;
}

export interface ShimValidationResult {
  readonly valid: boolean;
  readonly filePath?: string | undefined;
  readonly violations: readonly ShimViolation[];
}

const SHIM_ANNOTATIONS = new RegExp("@" + "(?:deprecated|compat|shim|legacy)", "i");
const SHIM_NAMES = new RegExp(
  "(?:^|[_\\$])(?:" +
    ["legacy", "compat", "deprecated", "backwardCompat", "forwardingShim"].join("|") +
    ")(?:[_\\$A-Z0-9]|$)|(?:Legacy|Compat|Shim|Deprecated)$",
);
const SHIM_REEXPORT = new RegExp(
  "export\\s*\\{[^}]*\\bas\\s+([a-zA-Z0-9_$]*(?:" +
    ["legacy", "compat", "shim", "deprecated"].join("|") +
    ")[a-zA-Z0-9_$]*)[^}]*\\}",
  "i",
);

export function validateNoBackwardsCompatibilityShims(
  code: string,
  filePath?: string,
): ShimValidationResult {
  const violations: ShimViolation[] = [];
  code.split("\n").forEach((line, idx) => {
    const lineNum = idx + 1;
    if (SHIM_ANNOTATIONS.test(line)) {
      violations.push({
        line: lineNum,
        snippet: line.trim(),
        reason: "Backwards-compatibility deprecation tag or annotation detected",
      });
      return;
    }
    const aliasMatch = SHIM_REEXPORT.exec(line);
    const aliasName = aliasMatch?.[1];
    if (aliasMatch && aliasName) {
      violations.push({
        line: lineNum,
        identifier: aliasName,
        snippet: line.trim(),
        reason: `Deprecated forwarding alias '${aliasName}' detected`,
      });
      return;
    }
    const declMatch =
      /(?:export\s+)?(?:const|let|var|function\*?|class|type|interface)\s+([a-zA-Z0-9_$]+)/.exec(
        line,
      );
    const declName = declMatch?.[1];
    if (declMatch && declName && SHIM_NAMES.test(declName)) {
      violations.push({
        line: lineNum,
        identifier: declName,
        snippet: line.trim(),
        reason: `Backwards-compatibility shim identifier '${declName}' detected`,
      });
    }
  });
  return {
    valid: violations.length === 0,
    ...(filePath !== undefined ? { filePath } : {}),
    violations,
  };
}
