import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { findRepoRoot, resolveScratchDir } from "../../core/shared/paths.ts";
import { resolveGlobalSessionsDir } from "../../authority/session/paths.ts";
import { resolveActiveSession } from "../../authority/session/resolver.ts";
import type { SessionIdentity } from "../../authority/session/types.ts";

export function matchesWriteScope(file: string, scopes: readonly string[]): boolean {
  const normFile = file.replace(/\\/g, "/").replace(/^\.\//, "");
  return scopes.some((scope) => {
    const s = scope.replace(/\\/g, "/").replace(/^\.\//, "");
    if (s === "*" || s === "**" || s === "") return true;
    if (s.endsWith("/")) return normFile.startsWith(s) || normFile === s.slice(0, -1);
    if (s.endsWith("/*") || s.endsWith("/**")) {
      const p = s.replace(/\/\*+$/, "");
      return normFile.startsWith(p + "/") || normFile === p;
    }
    return normFile === s || normFile.startsWith(s + "/");
  });
}

export function findSessionByToken(
  token: string,
  file?: string,
  options?: { readonly runRoot?: string; readonly cwd?: string },
): SessionIdentity | null {
  const cur = resolveActiveSession({
    explicitToken: token,
    ...(options?.runRoot ? { runRoot: options.runRoot } : {}),
    ...(options?.cwd ? { cwd: options.cwd } : {}),
  });
  if (cur && cur.token === token) return cur;

  const dirs = new Set<string>();
  if (options?.runRoot) {
    dirs.add(resolveGlobalSessionsDir(options.runRoot));
    dirs.add(join(options.runRoot, ".olt", ".sessions"));
    dirs.add(join(options.runRoot, "runtime", "sessions"));
  }
  if (options?.cwd) {
    dirs.add(resolveGlobalSessionsDir(options.cwd));
    dirs.add(join(options.cwd, ".olt", ".sessions"));
  }
  if (file) {
    try {
      let p = dirname(resolve(file));
      while (p && p !== dirname(p)) {
        const sDir = join(p, ".olt", ".sessions");
        if (existsSync(sDir)) {
          dirs.add(sDir);
          break;
        }
        p = dirname(p);
      }
    } catch {}
  }
  try {
    dirs.add(resolveGlobalSessionsDir());
    dirs.add(resolveGlobalSessionsDir(findRepoRoot()));
    dirs.add(join(findRepoRoot(), ".olt", ".sessions"));
    dirs.add(join(resolveScratchDir(), ".sessions"));
    dirs.add(join(process.cwd(), ".olt", ".sessions"));
  } catch {}

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".json")) continue;
        try {
          const parsed = JSON.parse(readFileSync(join(dir, f), "utf8")) as SessionIdentity;
          if (parsed && typeof parsed === "object" && parsed.token === token) return parsed;
        } catch {}
      }
    } catch {}
  }
  return null;
}

export function assertLeaseTokenForFileMutation(
  file: string,
  token: string,
  options?: { readonly runRoot?: string; readonly cwd?: string },
): void {
  if (typeof file !== "string" || !file.trim()) {
    throw new HarnessError("INVALID_ARGUMENT", "Target file path must be a nonempty string");
  }
  if (
    !token ||
    typeof token !== "string" ||
    !token.trim() ||
    token.trim() === "unauthenticated" ||
    token.trim() === "none"
  ) {
    throw new HarnessError(
      "PERMISSION_DENIED",
      "Mutation interlock violation: active lease token required for file mutation",
    );
  }

  const session = findSessionByToken(token, file, options);
  if (!session) {
    throw new HarnessError(
      "PERMISSION_DENIED",
      `Mutation interlock violation: unauthenticated or invalid lease token '${token}'`,
    );
  }

  if (session.can_edit_files === false) {
    throw new HarnessError(
      "PERMISSION_DENIED",
      `Actor role '${session.role}' is not permitted to mutate files`,
    );
  }
  if (
    session.write_scope &&
    session.write_scope.length > 0 &&
    !matchesWriteScope(file, session.write_scope)
  ) {
    throw new HarnessError(
      "PERMISSION_DENIED",
      `Target file '${file}' is outside leased write scope: ${session.write_scope.join(", ")}`,
    );
  }
}
