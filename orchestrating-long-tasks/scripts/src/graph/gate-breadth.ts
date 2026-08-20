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
export function gateBreadthWarning(gate: string, writeScope: readonly string[]): string | undefined {
  if (!looksWholeSuite(gate) || !scopeIsNarrow(writeScope)) return undefined;
  return (
    `gate "${gate}" looks like a whole-suite run while the write scope is ${writeScope.join(", ")}. ` +
    `A task gate should prove its own scope; the run-wide suite belongs to --completion-gate.`
  );
}
