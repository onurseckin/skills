import { runHookHardener } from "./hook-template.ts";

export function computeIsHardenHooksMain(
  mainVal: boolean = import.meta.main,
  entryArg: string | undefined = process.argv[1],
): boolean {
  if (mainVal) return true;
  if (!entryArg) return false;
  return (
    entryArg.endsWith("git/harden-hooks.ts") ||
    entryArg.endsWith("git/harden-hooks") ||
    entryArg.endsWith("/harden-hooks.ts") ||
    entryArg.endsWith("/harden-hooks")
  );
}

export function executeHardenHooksCli(args: readonly string[] = process.argv.slice(2)): number {
  return runHookHardener(args);
}

if (computeIsHardenHooksMain()) {
  const exitCode = executeHardenHooksCli();
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
