import { type HookHardeningOptions, runHookHardener } from "./hook-template.ts";

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

export function parseHardenerArgs(args: readonly string[]): {
  readonly targetDir?: string;
  readonly options: HookHardeningOptions;
} {
  let failClosedOnBypass = false;
  let failClosedCommitMsg = false;
  let targetDir: string | undefined;

  for (const arg of args) {
    if (arg === "--fail-closed" || arg === "--fail-closed=all") {
      failClosedOnBypass = true;
    } else if (arg === "--fail-closed-commit-msg" || arg === "--fail-closed=commit-msg") {
      failClosedCommitMsg = true;
    } else if (!arg.startsWith("-") && targetDir === undefined) {
      targetDir = arg;
    }
  }

  return {
    ...(targetDir !== undefined ? { targetDir } : {}),
    options: {
      failClosedOnBypass,
      failClosedCommitMsg,
    },
  };
}

export function executeHardenHooksCli(args: readonly string[] = process.argv.slice(2)): number {
  const { targetDir, options } = parseHardenerArgs(args);
  const passArgs = targetDir ? [targetDir] : [];
  return runHookHardener(passArgs, options);
}

if (computeIsHardenHooksMain()) {
  const exitCode = executeHardenHooksCli();
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
