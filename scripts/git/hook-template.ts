import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const FAIL_CLOSED_ERROR_MESSAGE =
  "Can't find lefthook in PATH. Verification runner is required; refusing to proceed.";

export const LEFTHOOK_BYPASS_WARNING_MESSAGE =
  "[commit-msg-guard] WARNING: LEFTHOOK=0 bypass detected; commit integrity checks skipped.";

export const FAIL_CLOSED_BYPASS_ERROR_MESSAGE =
  "[commit-msg-guard] ERROR: LEFTHOOK=0 bypass is disabled; commit integrity checks cannot be skipped.";

export const STANDARD_HOOK_NAMES: readonly string[] = [
  "pre-commit",
  "commit-msg",
  "pre-push",
  "prepare-commit-msg",
];

export interface HookHardeningOptions {
  readonly failClosedOnBypass?: boolean;
  readonly failClosedCommitMsg?: boolean;
  readonly hookName?: string;
}

export interface HookTemplateOptions {
  readonly failClosedOnBypass?: boolean;
}

export function buildGitHookTemplate(hookName: string, options?: HookTemplateOptions): string {
  const failClosed = options?.failClosedOnBypass === true;
  const bypassBlock = failClosed
    ? `if [ "$LEFTHOOK" = "0" ]; then
  echo "${FAIL_CLOSED_BYPASS_ERROR_MESSAGE}" >&2
  exit 1
fi`
    : `if [ "$LEFTHOOK" = "0" ]; then
  echo "${LEFTHOOK_BYPASS_WARNING_MESSAGE}" >&2
  exit 0
fi`;

  return `#!/bin/sh

if [ "$LEFTHOOK_VERBOSE" = "1" -o "$LEFTHOOK_VERBOSE" = "true" ]; then
  set -x
fi

${bypassBlock}

call_lefthook()
{
  if test -n "$LEFTHOOK_BIN"
  then
    "$LEFTHOOK_BIN" "$@"
  elif lefthook -h >/dev/null 2>&1
  then
    lefthook "$@"
  else
    dir="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
    osArch=$(uname | tr '[:upper:]' '[:lower:]')
    cpuArch=$(uname -m | sed 's/aarch64/arm64/;s/x86_64/x64/')
    if test -f "$dir/node_modules/lefthook-\${osArch}-\${cpuArch}/bin/lefthook"
    then
      "$dir/node_modules/lefthook-\${osArch}-\${cpuArch}/bin/lefthook" "$@"
    elif test -f "$dir/node_modules/@evilmartians/lefthook/bin/lefthook-\${osArch}-\${cpuArch}/lefthook"
    then
      "$dir/node_modules/@evilmartians/lefthook/bin/lefthook-\${osArch}-\${cpuArch}/lefthook" "$@"
    elif test -f "$dir/node_modules/@evilmartians/lefthook-installer/bin/lefthook"
    then
      "$dir/node_modules/@evilmartians/lefthook-installer/bin/lefthook" "$@"
    elif test -f "$dir/node_modules/lefthook/bin/index.js"
    then
      "$dir/node_modules/lefthook/bin/index.js" "$@"
    elif go tool lefthook -h >/dev/null 2>&1
    then
      go tool lefthook "$@"
    elif bundle exec lefthook -h >/dev/null 2>&1
    then
      bundle exec lefthook "$@"
    elif yarn lefthook -h >/dev/null 2>&1
    then
      yarn lefthook "$@"
    elif pnpm lefthook -h >/dev/null 2>&1
    then
      pnpm lefthook "$@"
    elif swift package lefthook >/dev/null 2>&1
    then
      swift package --build-path .build/lefthook --disable-sandbox lefthook "$@"
    elif command -v mint >/dev/null 2>&1
    then
      mint run csjones/lefthook-plugin "$@"
    elif uv run lefthook -h >/dev/null 2>&1
    then
      uv run lefthook "$@"
    elif mise exec -- lefthook -h >/dev/null 2>&1
    then
      mise exec -- lefthook "$@"
    elif devbox run lefthook -h >/dev/null 2>&1
    then
      devbox run lefthook "$@"
    else
      echo "${FAIL_CLOSED_ERROR_MESSAGE}" >&2
      exit 1
    fi
  fi
}

call_lefthook run "${hookName}" "$@"
`;
}

const MISSING_RUNNER_FAIL_OPEN_PATTERN =
  /echo\s+["']Can't find lefthook in PATH[^"']*["'](?!\s*(?:>&2)?\s*(?:#[^\n]*)?\n\s*(?:exit|return)\s+[1-9])/;

const LEFTHOOK_BYPASS_ONE_LINER_PATTERN =
  /(?:\[\s*"?\$LEFTHOOK"?\s*=\s*"?0"?[^\]]*\]|test\s+"?\$LEFTHOOK"?\s*=\s*"?0"?)\s*&&\s*exit\s+0/;

export function isHookFailingClosed(content: string, options?: HookHardeningOptions): boolean {
  const hasLefthookRef =
    content.includes("lefthook") ||
    content.includes("LEFTHOOK") ||
    content.includes("Can't find lefthook in PATH");

  if (!hasLefthookRef) {
    return true;
  }

  if (MISSING_RUNNER_FAIL_OPEN_PATTERN.test(content)) {
    return false;
  }

  if (LEFTHOOK_BYPASS_ONE_LINER_PATTERN.test(content)) {
    return false;
  }

  const globalBypassPattern =
    /if\s+(?:\[\s*"?\$LEFTHOOK"?\s*=\s*"?0"?[^\]]*\]|test\s+"?\$LEFTHOOK"?\s*=\s*"?0"?)\s*;\s*then([\s\S]*?)\bfi\b/g;
  let match: RegExpExecArray | null = null;
  while ((match = globalBypassPattern.exec(content)) !== null) {
    const ifBody = match[1] ?? "";
    const shouldFailClosed =
      options?.failClosedOnBypass === true ||
      (options?.failClosedCommitMsg === true && options?.hookName === "commit-msg");

    if (shouldFailClosed) {
      if (/\bexit\s+0\b/.test(ifBody)) {
        return false;
      }
      if (!/\b(?:exit|return)\s+[1-9]/.test(ifBody)) {
        return false;
      }
    } else {
      if (/\bexit\s+0\b/.test(ifBody)) {
        const hasWarning =
          ifBody.includes(LEFTHOOK_BYPASS_WARNING_MESSAGE) ||
          ifBody.includes("WARNING: LEFTHOOK=0 bypass detected");
        if (!hasWarning) {
          return false;
        }
      }
    }
  }

  return true;
}

export function hardenHookScript(content: string, options?: HookHardeningOptions): string {
  if (isHookFailingClosed(content, options)) {
    return content;
  }

  let result = content;

  const failOpenPattern = /(echo\s+["']Can't find lefthook in PATH["']\s*(?:>&2)?\s*)\n(\s*fi)/g;
  if (failOpenPattern.test(result)) {
    result = result.replace(
      failOpenPattern,
      `echo "${FAIL_CLOSED_ERROR_MESSAGE}" >&2\n      exit 1\n$2`,
    );
  }
  const genericEchoPattern =
    /(echo\s+["']Can't find lefthook in PATH[^"']*["'])(?!\s*>&2\s*\n\s*exit\s+1)/g;
  if (genericEchoPattern.test(result)) {
    result = result.replace(
      genericEchoPattern,
      `echo "${FAIL_CLOSED_ERROR_MESSAGE}" >&2\n      exit 1`,
    );
  }

  const shouldFailClosed =
    options?.failClosedOnBypass === true ||
    (options?.failClosedCommitMsg === true && options?.hookName === "commit-msg");

  const replacementBypassBlock = shouldFailClosed
    ? `if [ "$LEFTHOOK" = "0" ]; then\n  echo "${FAIL_CLOSED_BYPASS_ERROR_MESSAGE}" >&2\n  exit 1\nfi`
    : `if [ "$LEFTHOOK" = "0" ]; then\n  echo "${LEFTHOOK_BYPASS_WARNING_MESSAGE}" >&2\n  exit 0\nfi`;

  const lefthookIfBlockPattern =
    /if\s+(?:\[\s*"?\$LEFTHOOK"?\s*=\s*"?0"?[^\]]*\]|test\s+"?\$LEFTHOOK"?\s*=\s*"?0"?)\s*;\s*then[\s\S]*?\bfi\b/g;
  if (lefthookIfBlockPattern.test(result)) {
    result = result.replace(lefthookIfBlockPattern, replacementBypassBlock);
  }

  const lefthookOneLinerPattern =
    /(?:\[\s*"?\$LEFTHOOK"?\s*=\s*"?0"?[^\]]*\]|test\s+"?\$LEFTHOOK"?\s*=\s*"?0"?)\s*&&\s*exit\s+0/g;
  if (lefthookOneLinerPattern.test(result)) {
    result = result.replace(lefthookOneLinerPattern, replacementBypassBlock);
  }

  return result;
}

export function hardenHookFile(filePath: string, options?: HookHardeningOptions): boolean {
  if (!existsSync(filePath)) {
    return false;
  }
  const hookName = options?.hookName ?? filePath.split("/").pop();
  const original = readFileSync(filePath, "utf-8");
  const hardened = hardenHookScript(original, {
    ...options,
    ...(hookName !== undefined ? { hookName } : {}),
  });
  if (hardened === original) {
    return false;
  }
  writeFileSync(filePath, hardened, { mode: 0o755 });
  return true;
}

export function installGitHook(
  hooksDir: string,
  hookName: string,
  options?: HookTemplateOptions,
): string {
  const targetPath = join(hooksDir, hookName);
  const content = buildGitHookTemplate(hookName, options);
  writeFileSync(targetPath, content, { mode: 0o755 });
  return targetPath;
}

export function hardenGitHooksDirectory(
  hooksDir: string,
  options?: HookHardeningOptions,
): readonly string[] {
  if (!existsSync(hooksDir)) {
    return [];
  }
  const hardened: string[] = [];
  const entries = readdirSync(hooksDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const fullPath = join(hooksDir, entry.name);
    if (hardenHookFile(fullPath, { ...options, hookName: entry.name })) {
      hardened.push(fullPath);
    }
  }
  return hardened;
}

export function computeIsHookTemplateMain(isDirectMain: boolean, entryPath?: string): boolean {
  if (isDirectMain) return true;
  if (!entryPath) return false;
  return entryPath.endsWith("/hook-template.ts") || entryPath.endsWith("/hook-template");
}

export function runHookHardener(
  args: readonly string[] = process.argv.slice(2),
  options?: HookHardeningOptions,
): number {
  let failClosedOnBypass = options?.failClosedOnBypass ?? false;
  let failClosedCommitMsg = options?.failClosedCommitMsg ?? false;
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

  const resolvedDir = targetDir ?? join(process.cwd(), ".git", "hooks");
  hardenGitHooksDirectory(resolvedDir, {
    ...options,
    failClosedOnBypass,
    failClosedCommitMsg,
  });
  return 0;
}

if (computeIsHookTemplateMain(import.meta.main, process.argv[1])) {
  const exitCode = runHookHardener();
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
