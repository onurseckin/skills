import { isRepoRelativePath } from "../requirements/predicates.ts";

const FILE_PREDICATES = new Set([
  "-b",
  "-c",
  "-d",
  "-e",
  "-f",
  "-h",
  "-L",
  "-p",
  "-r",
  "-s",
  "-S",
  "-w",
  "-x",
]);
const NON_PROOF_MODES = new Set([
  "--allow-no-tests",
  "--allownotests",
  "--collect-only",
  "--collectonly",
  "--dry-run",
  "--dryrun",
  "--help",
  "--if-present",
  "--ignore-scripts",
  "--list",
  "--list-tests",
  "--listtests",
  "--no-error-on-unmatched-pattern",
  "--no-run",
  "--pass-with-no-tests",
  "--passwithnotests",
  "--version",
  "--watch",
  "--watch-all",
  "--watchall",
  "dry-run",
  "dryrun",
  "help",
  "list",
  "version",
  "watch",
]);

function hasUnsafeWin32Component(value: string): boolean {
  return value
    .replaceAll("\\", "/")
    .split("/")
    .some((segment) => {
      if (segment === ".") return false;
      const normalized = segment.replace(/[ .]+$/u, "");
      return (
        normalized === "" ||
        normalized === "." ||
        normalized === ".." ||
        /^(?:aux|con|nul|prn|com[1-9]|lpt[1-9])(?::.*|\..*)?$/iu.test(normalized)
      );
    });
}

export function isUnsafeGatePath(value: string): boolean {
  if (value === "./...") return false;
  return (
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^[A-Za-z]:/u.test(value) ||
    /^file:/iu.test(value) ||
    hasUnsafeWin32Component(value)
  );
}

function flagPayload(value: string): string | null {
  const long = /^--[^=]+=(.*)$/u.exec(value);
  if (long) return long[1]!;
  const clustered = /^-[A-Za-z]*[cCIr](=?(?:[/\\]|\.\.[/\\]|[A-Za-z]:[/\\]).*)$/u.exec(value);
  if (clustered) return clustered[1]!;
  const short = /^-[A-Za-z]=?(.+)$/u.exec(value);
  return short?.[1] ?? null;
}

// Named export (rather than folding into a boolean) so callers can report *which* argv entry
// tripped path-form rejection instead of collapsing it into an undifferentiated weakness verdict.
export function unsafeOperand(argv: readonly string[]): string | null {
  for (const value of argv) {
    if (isUnsafeGatePath(value)) return value;
    const payload = flagPayload(value);
    if (payload !== null && isUnsafeGatePath(payload)) return payload;
  }
  return null;
}

export function hasUnsafeOperands(argv: readonly string[]): boolean {
  return unsafeOperand(argv) !== null;
}

export function hasOpaquePathOption(argv: readonly string[]): boolean {
  return argv.slice(1).some((value) => {
    if (!value.startsWith("-")) return false;
    return (
      value.includes("/") || value.includes("\\") || value.includes("=") || /\.\.$/u.test(value)
    );
  });
}

export function hasDashPrefixedArgument(argv: readonly string[]): boolean {
  return argv.slice(1).some((value) => value.startsWith("-"));
}

export function hasNonProofMode(argv: readonly string[]): boolean {
  return argv.slice(1).some((value) => {
    if (value.startsWith("-h") || value.startsWith("-V")) return true;
    const mode = value.split("=", 1)[0]!.toLowerCase();
    return NON_PROOF_MODES.has(mode);
  });
}

export function directTestCommandIsWeak(
  executable: string,
  argv: readonly string[],
): boolean | null {
  if (executable !== "test" && executable !== "[") return null;
  const args = argv.slice(1);
  const operands = executable === "[" && args.at(-1) === "]" ? args.slice(0, -1) : args;
  if (executable === "[" && args.at(-1) !== "]") return true;
  return !(
    operands.length === 2 &&
    FILE_PREDICATES.has(operands[0]!) &&
    isRepoRelativePath(operands[1])
  );
}

export function isRepoLocalExecutable(value: string): boolean {
  const normalized = value.startsWith("./") ? value.slice(2) : value;
  return normalized.includes("/") && isRepoRelativePath(normalized);
}
