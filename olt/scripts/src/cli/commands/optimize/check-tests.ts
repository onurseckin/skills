import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { HarnessError } from "../../../core/errors/index.ts";
import { assertFlags, boolFlag, textFlag, type CommandContext, type Flags } from "../../index.ts";

export interface CheckTestsPrePostFile {
  readonly filename?: string | undefined;
  readonly pre: string;
  readonly post: string;
}

export interface CheckTestsDiffFile {
  readonly filename?: string | undefined;
  readonly diff: string;
}

export interface CheckTestsPrePostInput {
  readonly pre: string;
  readonly post: string;
  readonly filename?: string | undefined;
  readonly target?: string | undefined;
  readonly throwOnBreach?: boolean | undefined;
}

export interface CheckTestsDiffInput {
  readonly diff: string;
  readonly filename?: string | undefined;
  readonly target?: string | undefined;
  readonly throwOnBreach?: boolean | undefined;
}

export interface CheckTestsFilesInput {
  readonly files: readonly (CheckTestsPrePostFile | CheckTestsDiffFile)[];
  readonly target?: string | undefined;
  readonly throwOnBreach?: boolean | undefined;
}

export interface CheckTestsCliOptionsInput {
  readonly target?: string | undefined;
  readonly base?: string | undefined;
  readonly diff?: string | undefined;
  readonly json?: boolean | undefined;
  readonly throwOnBreach?: boolean | undefined;
}

export interface CheckTestsContext extends CommandContext {
  readonly gitRunner?: ((args: readonly string[], cwd?: string) => string) | undefined;
}

export type CheckTestsInput =
  | string
  | CheckTestsPrePostInput
  | CheckTestsDiffInput
  | CheckTestsFilesInput
  | CheckTestsCliOptionsInput;

export interface CheckTestsResult {
  readonly ok: boolean;
  readonly passed: boolean;
  readonly filesChecked: number;
  readonly totalChecked: number;
  readonly violations: readonly string[];
  readonly markdown: string;
}

interface DiffHunkFile {
  filename: string;
  isNew: boolean;
  lines: string[];
}

const ASSERTION_PATTERN = /\b(?:expect|assert)(?:\.|\s*\()/;
const COMMENT_LINE_PATTERN = /^\s*(?:\/\/|\/\*|\*)/;
const COMMENTED_ASSERTION_PATTERN = /(?:\/\/|\/\*|\*)\s*.*?\b(?:expect|assert)(?:\.|\s*\()/;

function computeLineDiff(pre: string, post: string): string {
  if (pre === post) return "";
  const a = pre.length === 0 ? [] : pre.split("\n");
  const b = post.length === 0 ? [] : post.split("\n");
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0),
  );

  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      dp[i + 1]![j + 1] = a[i] === b[j] ? dp[i]![j]! + 1 : Math.max(dp[i]![j + 1]!, dp[i + 1]![j]!);
    }
  }

  const outLines: string[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      outLines.push(" " + a[i - 1]!);
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      outLines.push("+" + b[j - 1]!);
      j--;
    } else if (i > 0 && (j === 0 || dp[i]![j - 1]! < dp[i - 1]![j]!)) {
      outLines.push("-" + a[i - 1]!);
      i--;
    }
  }

  return outLines.reverse().join("\n");
}

function parseDiffFiles(diffContent: string): DiffHunkFile[] {
  const files: DiffHunkFile[] = [];
  const lines = diffContent.split("\n");
  let currentFile: DiffHunkFile | undefined;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git\/(.*?) b\/(.*?)$/);
      const filename = match ? match[2] || match[1] || "unknown" : "unknown";
      currentFile = { filename, isNew: false, lines: [] };
      files.push(currentFile);
      continue;
    }
    if (line.startsWith("new file mode ") || line.startsWith("--- /dev/null")) {
      if (currentFile) currentFile.isNew = true;
      continue;
    }
    if (line.startsWith("--- ") && !line.startsWith("--- /dev/null") && !currentFile) {
      currentFile = {
        filename: line.slice(4).replace(/^a\//, "").trim(),
        isNew: false,
        lines: [],
      };
      files.push(currentFile);
      continue;
    }
    if (line.startsWith("+++ ") && !line.startsWith("+++ /dev/null")) {
      const fn = line.slice(4).replace(/^b\//, "").trim();
      if (currentFile && currentFile.filename === "unknown") {
        currentFile.filename = fn;
      } else if (!currentFile) {
        currentFile = { filename: fn, isNew: false, lines: [] };
        files.push(currentFile);
      }
      continue;
    }
    if (currentFile) {
      currentFile.lines.push(line);
    } else if (line.startsWith("-") || line.startsWith("+") || line.startsWith(" ")) {
      currentFile = { filename: "anonymous.test.ts", isNew: false, lines: [line] };
      files.push(currentFile);
    }
  }
  return files;
}

function isTestFile(filename: string): boolean {
  if (filename === "anonymous.test.ts") return true;
  const lower = filename.toLowerCase();
  return (
    lower.endsWith(".test.ts") ||
    lower.endsWith(".test.tsx") ||
    lower.endsWith(".test.js") ||
    lower.endsWith(".test.jsx") ||
    lower.endsWith(".spec.ts") ||
    lower.endsWith(".spec.tsx") ||
    lower.endsWith(".spec.js") ||
    lower.endsWith(".spec.jsx") ||
    /(?:^|\/)(?:tests?|__tests__)\//.test(lower)
  );
}

function matchesTarget(filename: string, target?: string): boolean {
  if (!target || filename === "anonymous.test.ts") return true;
  const normFile = filename.replace(/^\.\//, "");
  const normTarget = target.replace(/^\.\//, "").replace(/\/$/, "");
  return (
    normFile === normTarget ||
    normFile.startsWith(normTarget + "/") ||
    normFile.endsWith(normTarget)
  );
}

function addParsedHunks(
  diffHunkFiles: DiffHunkFile[],
  diffText: string,
  explicitFilename?: string,
): void {
  const parsed = parseDiffFiles(diffText);
  if (parsed.length === 0 && diffText.length > 0) {
    diffHunkFiles.push({
      filename: explicitFilename ?? "anonymous.test.ts",
      isNew: false,
      lines: diffText.split("\n"),
    });
  } else {
    for (const p of parsed) {
      if (explicitFilename && p.filename === "anonymous.test.ts") {
        p.filename = explicitFilename;
      }
      diffHunkFiles.push(p);
    }
  }
}

export function checkTestInvariants(diffOrPrePost: CheckTestsInput): CheckTestsResult {
  let targetFilter: string | undefined;
  let shouldThrow = true;
  const diffHunkFiles: DiffHunkFile[] = [];

  if (typeof diffOrPrePost === "string") {
    addParsedHunks(diffHunkFiles, diffOrPrePost);
  } else if (typeof diffOrPrePost === "object" && diffOrPrePost !== null) {
    if ("throwOnBreach" in diffOrPrePost && typeof diffOrPrePost.throwOnBreach === "boolean") {
      shouldThrow = diffOrPrePost.throwOnBreach;
    }
    if ("target" in diffOrPrePost && typeof diffOrPrePost.target === "string") {
      targetFilter = diffOrPrePost.target;
    }

    const items =
      "files" in diffOrPrePost && Array.isArray(diffOrPrePost.files)
        ? diffOrPrePost.files
        : ("pre" in diffOrPrePost && "post" in diffOrPrePost) ||
            ("diff" in diffOrPrePost && typeof diffOrPrePost.diff === "string")
          ? [diffOrPrePost]
          : [];

    for (const item of items) {
      if ("pre" in item && "post" in item) {
        const diffText = computeLineDiff(item.pre, item.post);
        addParsedHunks(diffHunkFiles, diffText, item.filename);
      } else if ("diff" in item && typeof item.diff === "string") {
        addParsedHunks(diffHunkFiles, item.diff, item.filename);
      }
    }
  }

  const violations: string[] = [];
  let filesChecked = 0;
  let totalChecked = 0;

  for (const file of diffHunkFiles) {
    if (!matchesTarget(file.filename, targetFilter) || !isTestFile(file.filename)) {
      continue;
    }
    filesChecked++;

    for (const line of file.lines) {
      if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("@@")) {
        continue;
      }
      totalChecked++;

      if (line.startsWith("-")) {
        const raw = line.slice(1);
        if (!COMMENT_LINE_PATTERN.test(raw) && ASSERTION_PATTERN.test(raw)) {
          violations.push(`deleted assertion in ${file.filename}: "${line.trim()}"`);
        }
        continue;
      }

      if (line.startsWith("+")) {
        const raw = line.slice(1);
        if (COMMENTED_ASSERTION_PATTERN.test(raw)) {
          violations.push(`commented-out assertion added in ${file.filename}: "${line.trim()}"`);
        }
        continue;
      }
    }
  }

  if (violations.length > 0 && shouldThrow) {
    throw new HarnessError(
      "INVALID_STATE",
      `ASSERTION_DELETION_BREACH: ${violations.join("; ")}`,
      violations,
    );
  }

  const passed = violations.length === 0;
  const markdown = [
    `### Test Invariant Verification`,
    `- **Status**: ${passed ? "✅ PASSED" : "❌ BREACH"}`,
    `- **Files Evaluated**: ${filesChecked}`,
    `- **Lines Evaluated**: ${totalChecked}`,
    `- **Assertion Violations**: ${violations.length}`,
  ].join("\n");

  return { ok: passed, passed, filesChecked, totalChecked, violations, markdown };
}

export async function optimizeCheckTestsCommand(
  flags: Flags,
  context?: CheckTestsContext,
): Promise<Record<string, unknown>> {
  assertFlags(flags, ["target", "base", "diff", "json"]);

  const target = textFlag(flags, "target", false);
  const base = textFlag(flags, "base", false);
  const diffFlag = textFlag(flags, "diff", false);
  const jsonOutput = boolFlag(flags, "json");

  let diffContent: string;
  const baseRef = base ?? "HEAD";

  if (diffFlag !== undefined) {
    diffContent = existsSync(diffFlag) ? readFileSync(diffFlag, "utf-8") : diffFlag;
  } else {
    const gitArgs = target ? ["diff", baseRef, "--", target] : ["diff", baseRef];
    const customRunner = context?.gitRunner;

    if (customRunner) {
      diffContent = customRunner(gitArgs, process.cwd());
    } else {
      const res = spawnSync("git", gitArgs, {
        cwd: process.cwd(),
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (res.error) {
        throw new HarnessError("INVALID_STATE", `git diff failed: ${res.error.message}`);
      }
      if (res.status !== 0) {
        const err = (res.stderr ?? "").trim();
        throw new HarnessError(
          "INVALID_STATE",
          `git diff exited with status ${res.status}: ${err}`,
        );
      }
      diffContent = res.stdout ?? "";
    }
  }

  const result = checkTestInvariants({ diff: diffContent, target });

  return {
    ok: result.ok,
    passed: result.passed,
    command: "optimize:check-tests",
    target: target ?? "all",
    base: baseRef,
    files_checked: result.filesChecked,
    assertions_checked: result.totalChecked,
    json: jsonOutput,
    markdown: result.markdown,
  };
}
