import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

export interface CommentViolation {
  readonly line: number;
  readonly column: number;
  readonly type: "single-line" | "multi-line" | "docblock";
  readonly snippet: string;
}
export interface ZeroCommentsValidationResult {
  readonly valid: boolean;
  readonly filePath?: string | undefined;
  readonly violations: readonly CommentViolation[];
}
export interface FileDensityViolation {
  readonly filePath: string;
  readonly lineCount: number;
  readonly limit: number;
}
export interface DirectoryDensityViolation {
  readonly directoryPath: string;
  readonly fileCount: number;
  readonly limit: number;
}
export interface DensityCheckOptions {
  readonly files?:
    | readonly {
        readonly path: string;
        readonly content?: string | undefined;
        readonly lineCount?: number | undefined;
      }[]
    | undefined;
  readonly directories?:
    | readonly {
        readonly path: string;
        readonly fileCount?: number | undefined;
        readonly filePaths?: readonly string[] | undefined;
      }[]
    | undefined;
  readonly maxLinesPerFile?: number | undefined;
  readonly maxFilesPerDirectory?: number | undefined;
  readonly rootDir?: string | undefined;
}
export interface DensityValidationResult {
  readonly valid: boolean;
  readonly maxLinesPerFile: number;
  readonly maxFilesPerDirectory: number;
  readonly fileViolations: readonly FileDensityViolation[];
  readonly directoryViolations: readonly DirectoryDensityViolation[];
}
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
export interface CapsuleHygieneViolation {
  readonly path: string;
  readonly reason: string;
  readonly patternMatched: string;
}
export interface CapsuleHygieneValidationResult {
  readonly valid: boolean;
  readonly inspectedPaths: readonly string[];
  readonly violations: readonly CapsuleHygieneViolation[];
}
export interface RepoConventionsCheckOptions {
  readonly targetFiles?: readonly { readonly path: string; readonly content: string }[] | undefined;
  readonly directories?:
    | readonly {
        readonly path: string;
        readonly fileCount?: number | undefined;
        readonly filePaths?: readonly string[] | undefined;
      }[]
    | undefined;
  readonly capsulesDir?: string | readonly string[] | undefined;
  readonly maxLinesPerFile?: number | undefined;
  readonly maxFilesPerDirectory?: number | undefined;
}
export interface RepoConventionsValidationResult {
  readonly valid: boolean;
  readonly commentsResult: ZeroCommentsValidationResult;
  readonly densityResult: DensityValidationResult;
  readonly facadeResults: readonly FacadeValidationResult[];
  readonly shimResults: readonly ShimValidationResult[];
  readonly capsuleHygieneResult: CapsuleHygieneValidationResult;
  readonly allViolations: readonly string[];
}

const EXEMPT_EXTS = new Set([
  ".md",
  ".markdown",
  ".yaml",
  ".yml",
  ".json",
  ".toml",
  ".txt",
  ".csv",
]);

export function validateZeroCommentsInCode(
  code: string,
  filePath?: string,
): ZeroCommentsValidationResult {
  if (filePath && EXEMPT_EXTS.has(extname(filePath).toLowerCase()))
    return { valid: true, filePath, violations: [] };
  const violations: CommentViolation[] = [];
  let line = 1,
    col = 1,
    i = 0;
  const len = code.length;
  let state: "NORMAL" | "SINGLE" | "DOUBLE" | "TEMPLATE" | "REGEX" = "NORMAL";
  const templateStack: number[] = [];

  while (i < len) {
    const ch = code[i] ?? "",
      next = i + 1 < len ? (code[i + 1] ?? "") : "";
    if (ch === "\n") {
      line++;
      col = 1;
      i++;
      continue;
    }
    if (state === "SINGLE") {
      if (ch === "\\") {
        i += 2;
        col += 2;
        continue;
      }
      if (ch === "'") state = "NORMAL";
      i++;
      col++;
      continue;
    }
    if (state === "DOUBLE") {
      if (ch === "\\") {
        i += 2;
        col += 2;
        continue;
      }
      if (ch === '"') state = "NORMAL";
      i++;
      col++;
      continue;
    }
    if (state === "TEMPLATE") {
      if (ch === "\\") {
        i += 2;
        col += 2;
        continue;
      }
      if (ch === "$" && next === "{") {
        templateStack.push(0);
        state = "NORMAL";
        i += 2;
        col += 2;
        continue;
      }
      if (ch === "`") state = "NORMAL";
      i++;
      col++;
      continue;
    }
    if (state === "REGEX") {
      if (ch === "\\") {
        i += 2;
        col += 2;
        continue;
      }
      if (ch === "/") state = "NORMAL";
      i++;
      col++;
      continue;
    }
    if (templateStack.length > 0) {
      const topIdx = templateStack.length - 1,
        top = templateStack[topIdx];
      if (top !== undefined) {
        if (ch === "{") templateStack[topIdx] = top + 1;
        else if (ch === "}") {
          if (top === 0) {
            templateStack.pop();
            state = "TEMPLATE";
            i++;
            col++;
            continue;
          }
          templateStack[topIdx] = top - 1;
        }
      }
    }
    if (ch === "'") {
      state = "SINGLE";
      i++;
      col++;
      continue;
    }
    if (ch === '"') {
      state = "DOUBLE";
      i++;
      col++;
      continue;
    }
    if (ch === "`") {
      state = "TEMPLATE";
      i++;
      col++;
      continue;
    }
    if (ch === "/" && next === "/") {
      let end = code.indexOf("\n", i);
      if (end === -1) end = len;
      violations.push({
        line,
        column: col,
        type: "single-line",
        snippet: code.slice(i, end).trim(),
      });
      i = end;
      continue;
    }
    if (ch === "/" && next === "*") {
      const isDoc = code.slice(i, i + 3) === "/**",
        end = code.indexOf("*/", i + 2);
      const closeIdx = end === -1 ? len : end + 2;
      violations.push({
        line,
        column: col,
        type: isDoc ? "docblock" : "multi-line",
        snippet: code.slice(i, Math.min(i + 60, closeIdx)).trim(),
      });
      const commentLines = code.slice(i, closeIdx).split("\n");
      const lastLine = commentLines[commentLines.length - 1],
        firstLine = commentLines[0];
      if (commentLines.length > 1 && lastLine !== undefined) {
        line += commentLines.length - 1;
        col = lastLine.length + 1;
      } else if (firstLine !== undefined) col += firstLine.length;
      i = closeIdx;
      continue;
    }
    if (ch === "/") {
      let p = i - 1;
      while (p >= 0 && /\s/.test(code[p] ?? "")) p--;
      const pc = p >= 0 ? (code[p] ?? "") : "";
      const isKw = /(?:return|case|typeof|void|delete|throw|yield|await|in|of|instanceof)\s*$/.test(
        code.slice(Math.max(0, p - 10), p + 1),
      );
      if (pc === "" || /[\(\[\{,;:\?=\!&|\+\-\*%<>~^]/.test(pc) || isKw) state = "REGEX";
    }
    i++;
    col++;
  }
  return {
    valid: violations.length === 0,
    ...(filePath !== undefined ? { filePath } : {}),
    violations,
  };
}

export function validateDensityBudgets(options: DensityCheckOptions): DensityValidationResult {
  const maxLines = options.maxLinesPerFile ?? 300,
    maxFiles = options.maxFilesPerDirectory ?? 10;
  const fileViolations: FileDensityViolation[] = [],
    directoryViolations: DirectoryDensityViolation[] = [];
  if (options.files) {
    for (const f of options.files) {
      let count = f.lineCount;
      if (count === undefined && f.content !== undefined) count = f.content.split("\n").length;
      if (count === undefined && existsSync(f.path))
        count = readFileSync(f.path, "utf-8").split("\n").length;
      if (count !== undefined && count > maxLines)
        fileViolations.push({ filePath: f.path, lineCount: count, limit: maxLines });
    }
  }
  if (options.directories) {
    for (const d of options.directories) {
      let count = d.fileCount;
      if (count === undefined && d.filePaths) count = d.filePaths.length;
      if (count === undefined && existsSync(d.path))
        count = readdirSync(d.path, { withFileTypes: true }).filter((e) => e.isFile()).length;
      if (count !== undefined && count > maxFiles)
        directoryViolations.push({ directoryPath: d.path, fileCount: count, limit: maxFiles });
    }
  }
  return {
    valid: fileViolations.length === 0 && directoryViolations.length === 0,
    maxLinesPerFile: maxLines,
    maxFilesPerDirectory: maxFiles,
    fileViolations,
    directoryViolations,
  };
}

const WILDCARD_EXPORT_REGEX = /^\s*export\s+\*\s*(?:as\s+\w+\s+)?from\s+['"][^'"]+['"]/m;
const DEFAULT_EXPORT_REGEX = /^\s*export\s+default\b/m;

export function validateFacadeExports(code: string, filePath?: string): FacadeValidationResult {
  const violations: FacadeExportViolation[] = [],
    namedExports: string[] = [];
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

const SHIM_ANNOTATIONS = /@deprecated|@compat|@shim|@legacy/i;
const SHIM_NAMES =
  /(?:^|[_\$])(?:legacy|compat|deprecated|backwardCompat|forwardingShim)(?:[_\$A-Z0-9]|$)|(?:Legacy|Compat|Shim|Deprecated)$/;
const SHIM_REEXPORT =
  /export\s*\{[^}]*\bas\s+([a-zA-Z0-9_$]*(?:legacy|compat|shim|deprecated)[a-zA-Z0-9_$]*)[^}]*\}/i;

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
    const aliasMatch = SHIM_REEXPORT.exec(line),
      aliasName = aliasMatch?.[1];
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
        ),
      declName = declMatch?.[1];
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

const DIRTY_PATTERNS = [
  /^scratch/i,
  /^temp[_\-\.]/i,
  /^tmp[_\-\.]/i,
  /\.tmp$/i,
  /\.temp$/i,
  /\.bak$/i,
  /\.swp$/i,
  /~$/,
  /\.DS_Store$/i,
  /\.orig$/i,
  /^dirty/i,
  /^untracked/i,
  /\.log$/i,
];

function checkCapsuleEntry(name: string, fullPath: string): CapsuleHygieneViolation | null {
  for (const p of DIRTY_PATTERNS) {
    if (p.test(name))
      return {
        path: fullPath,
        reason: `Forbidden scratch or temporary artifact '${name}' in capsule directory`,
        patternMatched: p.toString(),
      };
  }
  return null;
}

export function validateCapsuleDiskHygiene(
  capsulesDir: string | readonly string[],
): CapsuleHygieneValidationResult {
  const violations: CapsuleHygieneViolation[] = [],
    inspectedPaths: string[] = [];
  if (typeof capsulesDir === "string") {
    if (existsSync(capsulesDir)) {
      const scan = (dir: string): void => {
        inspectedPaths.push(dir);
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const itemPath = join(dir, entry.name);
          inspectedPaths.push(itemPath);
          const v = checkCapsuleEntry(entry.name, itemPath);
          if (v) violations.push(v);
          if (entry.isDirectory()) scan(itemPath);
        }
      };
      scan(capsulesDir);
    } else {
      inspectedPaths.push(capsulesDir);
      const v = checkCapsuleEntry(basename(capsulesDir), capsulesDir);
      if (v) violations.push(v);
    }
  } else {
    for (const p of capsulesDir) {
      inspectedPaths.push(p);
      const v = checkCapsuleEntry(basename(p), p);
      if (v) violations.push(v);
    }
  }
  return { valid: violations.length === 0, inspectedPaths, violations };
}

export function validateRepositoryCodingConventions(
  options: RepoConventionsCheckOptions,
): RepoConventionsValidationResult {
  const allViolations: string[] = [];
  let commentsValid = true;
  const commentViolations: CommentViolation[] = [];
  if (options.targetFiles) {
    for (const f of options.targetFiles) {
      const res = validateZeroCommentsInCode(f.content, f.path);
      if (!res.valid) {
        commentsValid = false;
        commentViolations.push(...res.violations);
        for (const v of res.violations)
          allViolations.push(
            `Comment violation in ${f.path}:${v.line}:${v.column} (${v.type}): ${v.snippet}`,
          );
      }
    }
  }
  const densityResult = validateDensityBudgets({
    ...(options.targetFiles
      ? { files: options.targetFiles.map((f) => ({ path: f.path, content: f.content })) }
      : {}),
    ...(options.directories !== undefined ? { directories: options.directories } : {}),
    ...(options.maxLinesPerFile !== undefined ? { maxLinesPerFile: options.maxLinesPerFile } : {}),
    ...(options.maxFilesPerDirectory !== undefined
      ? { maxFilesPerDirectory: options.maxFilesPerDirectory }
      : {}),
  });
  if (!densityResult.valid) {
    for (const fv of densityResult.fileViolations)
      allViolations.push(`File density exceeded: ${fv.filePath} (${fv.lineCount} > ${fv.limit})`);
    for (const dv of densityResult.directoryViolations)
      allViolations.push(
        `Directory density exceeded: ${dv.directoryPath} (${dv.fileCount} > ${dv.limit})`,
      );
  }
  const facadeResults: FacadeValidationResult[] = [],
    shimResults: ShimValidationResult[] = [];
  if (options.targetFiles) {
    for (const f of options.targetFiles) {
      if (basename(f.path) === "index.ts") {
        const res = validateFacadeExports(f.content, f.path);
        facadeResults.push(res);
        if (!res.valid)
          for (const v of res.violations)
            allViolations.push(`Facade violation in ${f.path}:${v.line}: ${v.reason}`);
      }
      const sRes = validateNoBackwardsCompatibilityShims(f.content, f.path);
      shimResults.push(sRes);
      if (!sRes.valid)
        for (const v of sRes.violations)
          allViolations.push(`Shim violation in ${f.path}:${v.line}: ${v.reason}`);
    }
  }
  const capsuleHygieneResult = options.capsulesDir
    ? validateCapsuleDiskHygiene(options.capsulesDir)
    : { valid: true, inspectedPaths: [], violations: [] };
  if (!capsuleHygieneResult.valid) {
    for (const v of capsuleHygieneResult.violations)
      allViolations.push(`Capsule hygiene violation: ${v.path} - ${v.reason}`);
  }
  const valid =
    commentsValid &&
    densityResult.valid &&
    facadeResults.every((r) => r.valid) &&
    shimResults.every((r) => r.valid) &&
    capsuleHygieneResult.valid;
  return {
    valid,
    commentsResult: { valid: commentsValid, violations: commentViolations },
    densityResult,
    facadeResults,
    shimResults,
    capsuleHygieneResult,
    allViolations,
  };
}
