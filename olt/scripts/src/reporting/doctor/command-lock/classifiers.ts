export const isTestFile = (arg: string): boolean => {
  if (arg.startsWith("-")) return false;
  return (
    arg.includes(".test.") ||
    arg.includes(".spec.") ||
    arg.endsWith(".test.ts") ||
    arg.endsWith(".spec.ts") ||
    arg.endsWith(".test.js") ||
    arg.endsWith(".spec.js") ||
    arg.endsWith(".test.tsx") ||
    arg.endsWith(".spec.tsx") ||
    /(\.(test|spec)\.[cm]?[jt]sx?|([/_]test|^test)[^/]*\.py|_test\.py|_spec\.rb)$/iu.test(arg)
  );
};

export const isWholeSuite = (argv: readonly string[]): boolean => {
  if (argv.length === 0) return false;
  const f = (argv[0] ?? "").toLowerCase(),
    s = (argv[1] ?? "").toLowerCase();
  if (["vitest", "jest", "pytest"].includes(f)) return !argv.slice(1).some(isTestFile);
  if (f === "npx" && (s === "vitest" || s === "jest")) return !argv.slice(2).some(isTestFile);
  if (
    ["npm", "pnpm", "yarn"].includes(f) &&
    (s === "test" || s === "t" || (s === "run" && (argv[2] ?? "").toLowerCase().startsWith("test")))
  )
    return !argv.slice(2).some(isTestFile);
  if (f === "bun" && s === "test") return !argv.slice(2).some(isTestFile);
  if (f === "bun" && s === "run" && (argv[2] ?? "").toLowerCase() === "test")
    return !argv.slice(3).some(isTestFile);
  if (f === "bun-test") return !argv.slice(1).some(isTestFile);
  return false;
};

export const isBadGit = (argv: readonly string[]): boolean => {
  if (argv.length === 0 || (argv[0] ?? "").toLowerCase() !== "git") return false;
  const sub = (argv[1] ?? "").toLowerCase();
  if (sub === "checkout" || sub === "reset") return true;
  if (sub === "push")
    return argv.slice(2).some((a) => a === "--force" || a === "-f" || a === "--force-with-lease");
  if (sub === "clean")
    return argv
      .slice(2)
      .some(
        (a) =>
          a === "-f" ||
          a === "-fd" ||
          a === "-fx" ||
          a === "-fxd" ||
          a === "-df" ||
          a === "--force" ||
          (a.startsWith("-") && a.includes("f")),
      );
  return false;
};

export const parseArgv = (entry: Record<string, unknown>): readonly string[] => {
  if (Array.isArray(entry.argv) && entry.argv.every((a) => typeof a === "string"))
    return entry.argv as string[];
  if (typeof entry.command === "string")
    return entry.command
      .trim()
      .split(/\s+/u)
      .filter((s) => s.length > 0);
  if (typeof entry.id === "string")
    return entry.id
      .trim()
      .split(/\s+/u)
      .filter((s) => s.length > 0);
  return [];
};
