import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * A task gate proves ITS task. When a narrow write scope is paired with a command that walks the whole
 * repository, every task in a run pays for every other task's tests — on a large repo that dominates the
 * run and starves the local CPU the scheduler depends on. The run-wide suite belongs to the completion
 * gate, which runs once.
 *
 * This warns rather than refuses: a broad gate is occasionally the honest choice, and the coordinator is
 * the one who can tell. Silence would let the expensive default win by accident.
 */

/** Path-like arguments that name a specific target rather than a whole tree. */
function namesATarget(token: string): boolean {
  if (token.startsWith("-")) return false;
  return token.includes("/") || token.includes(".") || token.includes("*");
}

/**
 * True when the command appears to run a whole test tree: a runner invoked with no path-like argument
 * at all, so it falls back to discovering everything.
 */
export function looksWholeSuite(gate: string): boolean {
  const tokens = gate.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  const verbs = new Set(["test", "check", "spec", "vitest", "jest", "pytest", "cargo"]);
  const hasVerb = tokens.some((t) => verbs.has(t) || t.endsWith(":test") || t.endsWith(":unit"));
  if (!hasVerb) return false;
  return !tokens.some(namesATarget);
}

/** A scope is narrow when it names concrete paths rather than the repository root. */
export function scopeIsNarrow(writeScope: readonly string[]): boolean {
  if (writeScope.length === 0) return false;
  return writeScope.every((s) => {
    const trimmed = s.trim();
    return trimmed !== "" && trimmed !== "." && trimmed !== "/" && trimmed !== "**";
  });
}

/**
 * Returns the warning to surface on the brief, or undefined when the pairing is unremarkable. The
 * caller decides where it appears; nothing here blocks the declaration.
 */
export function gateBreadthWarning(
  gate: string,
  writeScope: readonly string[],
): string | undefined {
  if (!looksWholeSuite(gate) || !scopeIsNarrow(writeScope)) return undefined;
  return (
    `gate "${gate}" looks like a whole-suite run while the write scope is ${writeScope.join(", ")}. ` +
    `A task gate should prove its own scope; the run-wide suite belongs to --completion-gate.`
  );
}

/** A file name a test runner would collect, across the conventions this repository has actually met. */
const TEST_FILE_PATTERN = /(\.(test|spec)\.[cm]?[jt]sx?|_test\.py|_spec\.rb)$/u;

/** Sibling directory names a test lives under, beside the source it covers. */
const COLOCATED_TEST_DIRS: readonly string[] = ["__tests__", "tests", "test"];

/**
 * B29.3: the mirror roots this check tries, in the order a coordinator would most likely find useful
 * first. Trying several is the honest response to "every repo names its test root differently" —
 * the ones that exist on disk survive the filter below, the rest cost one `existsSync` and vanish.
 */
const MIRROR_TEST_ROOTS: readonly string[] = ["tests/unit", "tests", "test", "spec"];

function isTestFileName(name: string): boolean {
  return TEST_FILE_PATTERN.test(name);
}

/** Test-named files sitting directly inside one directory — never recurses, so cost stays O(entries). */
function testFileNamesIn(absDir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(absDir);
  } catch {
    return [];
  }
  return entries.filter(isTestFileName).map((name) => join(absDir, name));
}

/** True when the path exists on disk and is a directory; false for anything else, including a broken link. */
function isExistingDirectory(absPath: string): boolean {
  try {
    return statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * A scope's own path with everything up to and including its last `src` segment dropped. `src/db`
 * and `packages/api/src/db` both mirror onto `db`; a scope with no `src` segment mirrors on its full
 * path, since guessing which arbitrary prefix to drop would as often discard the part that actually
 * named the module.
 */
function mirrorStem(segments: readonly string[]): string[] {
  const srcAt = segments.lastIndexOf("src");
  return srcAt === -1 ? [...segments] : segments.slice(srcAt + 1);
}

/**
 * Test paths this repository already keeps for a write-scope path — discovered on disk, never guessed
 * from the scope's name. Three conventions are checked: tests co-located beside the source they cover
 * (a matching file, or a sibling `__tests__`/`tests`/`test` directory); a mirrored directory under a
 * top-level test root that reproduces the scope's own path underneath it; and a same-named test file
 * beside that mirrored location (`tests/db.test.ts` for a scope of `src/db`). A scope with nothing
 * found under any of them contributes no suggestion — absent renders "unknown", never a guessed path
 * presented as if it were confirmed.
 */
export function discoverGatePaths(repoRoot: string, writeScope: readonly string[]): string[] {
  const found = new Set<string>();
  const record = (absPath: string): void => {
    found.add(relative(repoRoot, absPath) || ".");
  };
  for (const raw of writeScope) {
    const trimmed = raw.trim();
    if (!scopeIsNarrow([trimmed])) continue; // the repository root has no single mirror to suggest
    const absScope = resolve(repoRoot, trimmed);
    if (!existsSync(absScope)) continue; // a scope that does not exist yet has nothing to discover
    for (const path of testFileNamesIn(absScope)) record(path);
    for (const dirName of COLOCATED_TEST_DIRS) {
      const colocated = join(absScope, dirName);
      if (isExistingDirectory(colocated)) record(colocated);
    }
    const stem = mirrorStem(trimmed.split("/").filter(Boolean));
    const leaf = stem.at(-1);
    const parentStem = stem.slice(0, -1);
    for (const root of MIRROR_TEST_ROOTS) {
      const mirroredDir = resolve(repoRoot, ...root.split("/"), ...stem);
      if (mirroredDir !== absScope && isExistingDirectory(mirroredDir)) record(mirroredDir);
      if (leaf === undefined) continue;
      const mirroredParent = resolve(repoRoot, ...root.split("/"), ...parentStem);
      for (const path of testFileNamesIn(mirroredParent)) {
        if (path.split(/[/\\]/u).at(-1)?.startsWith(`${leaf}.`) === true) record(path);
      }
    }
  }
  return [...found].sort();
}
