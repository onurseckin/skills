import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const FAIL_CLOSED_ERROR_MESSAGE =
  "Can't find lefthook in PATH. Verification runner is required; refusing to proceed.";

export const STANDARD_HOOK_NAMES: readonly string[] = [
  "pre-commit",
  "commit-msg",
  "pre-push",
  "prepare-commit-msg",
];

export function buildGitHookTemplate(hookName: string): string {
  return `#!/bin/sh

if [ "$LEFTHOOK_VERBOSE" = "1" -o "$LEFTHOOK_VERBOSE" = "true" ]; then
  set -x
fi

if [ "$LEFTHOOK" = "0" ]; then
  exit 0
fi

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

export function isHookFailingClosed(content: string): boolean {
  if (!content.includes("Can't find lefthook in PATH")) {
    return true;
  }
  return content.includes("exit 1") || content.includes("return 1");
}

export function hardenHookScript(content: string): string {
  if (isHookFailingClosed(content)) {
    return content;
  }
  const failOpenPattern = /(echo\s+["']Can't find lefthook in PATH["']\s*(?:>&2)?\s*)\n(\s*fi)/g;
  if (failOpenPattern.test(content)) {
    return content.replace(
      failOpenPattern,
      `echo "${FAIL_CLOSED_ERROR_MESSAGE}" >&2\n      exit 1\n$2`,
    );
  }
  const genericEchoPattern =
    /(echo\s+["']Can't find lefthook in PATH[^"']*["'])(?!\s*>&2\s*\n\s*exit\s+1)/g;
  if (genericEchoPattern.test(content)) {
    return content.replace(
      genericEchoPattern,
      `echo "${FAIL_CLOSED_ERROR_MESSAGE}" >&2\n      exit 1`,
    );
  }
  return content;
}

export function hardenHookFile(filePath: string): boolean {
  if (!existsSync(filePath)) {
    return false;
  }
  const original = readFileSync(filePath, "utf-8");
  const hardened = hardenHookScript(original);
  if (hardened === original) {
    return false;
  }
  writeFileSync(filePath, hardened, { mode: 0o755 });
  return true;
}

export function installGitHook(hooksDir: string, hookName: string): string {
  const targetPath = join(hooksDir, hookName);
  const content = buildGitHookTemplate(hookName);
  writeFileSync(targetPath, content, { mode: 0o755 });
  return targetPath;
}

export function hardenGitHooksDirectory(hooksDir: string): readonly string[] {
  if (!existsSync(hooksDir)) {
    return [];
  }
  const hardened: string[] = [];
  const entries = readdirSync(hooksDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const fullPath = join(hooksDir, entry.name);
    if (hardenHookFile(fullPath)) {
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

export function runHookHardener(args: readonly string[] = process.argv.slice(2)): number {
  const targetDir = args[0] ?? join(process.cwd(), ".git", "hooks");
  hardenGitHooksDirectory(targetDir);
  return 0;
}

if (computeIsHookTemplateMain(import.meta.main, process.argv[1])) {
  const exitCode = runHookHardener();
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
