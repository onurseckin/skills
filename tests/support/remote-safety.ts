/**
 * List of environment variable keys that could carry ambient push credentials or git hooks.
 */
export const SENSITIVE_PUSH_ENV_VARS: readonly string[] = [
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "GIT_AUTH_TOKEN",
  "GIT_PASSWORD",
  "GIT_ASKPASS",
  "GIT_SSH_COMMAND",
  "GIT_CONFIG_PARAMETERS",
  "GL_TOKEN",
  "GITLAB_TOKEN",
  "BITBUCKET_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
];

export interface RemoteUrlAuditResult {
  readonly ok: boolean;
  readonly remotes: Readonly<Record<string, { readonly fetch?: string; readonly push?: string }>>;
  readonly issues: readonly string[];
}

export interface EnvironmentSafetyAuditResult {
  readonly ok: boolean;
  readonly violations: readonly string[];
}

/**
 * Known inert dummy URLs that structurally block git push at the transport layer.
 */
const INERT_PUSH_TARGETS = new Set([
  "no_push",
  "no-push",
  "disabled",
  "disabled://push-prohibited",
  "/dev/null",
  "file:///dev/null",
]);

/**
 * Checks whether a configured git push URL is safe (inert/dummy or explicitly disabled).
 */
export function isPushTargetInert(pushUrl: string | undefined): boolean {
  if (!pushUrl || pushUrl.trim() === "") {
    return false;
  }
  const trimmed = pushUrl.trim();
  if (INERT_PUSH_TARGETS.has(trimmed)) {
    return true;
  }
  if (trimmed.startsWith("disabled://") || trimmed.startsWith("dummy://")) {
    return true;
  }
  return false;
}

/**
 * Audits git remote URLs in a repository directory to ensure no push capability exists.
 */
export function auditRemoteUrls(repoDir: string): RemoteUrlAuditResult {
  const proc = Bun.spawnSync(["git", "remote", "-v"], {
    cwd: repoDir,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  if (proc.exitCode !== 0) {
    const errText = Buffer.from(proc.stderr).toString("utf-8").trim();
    return {
      ok: false,
      remotes: {},
      issues: [`git remote -v failed with exit code ${proc.exitCode}: ${errText}`],
    };
  }

  const stdout = Buffer.from(proc.stdout).toString("utf-8");
  const lines = stdout.split("\n").filter((line) => line.trim().length > 0);

  const remotesMap: Record<string, { fetch?: string; push?: string }> = {};

  for (const line of lines) {
    const match = /^([^\s]+)\s+([^\s]+)\s+\((fetch|push)\)$/u.exec(line.trim());
    if (match) {
      const name = match[1] ?? "";
      const url = match[2] ?? "";
      const kind = match[3] ?? "";

      const existing = remotesMap[name] ?? {};
      if (kind === "fetch") {
        existing.fetch = url;
      } else if (kind === "push") {
        existing.push = url;
      }
      remotesMap[name] = existing;
    }
  }

  const issues: string[] = [];

  for (const [name, urls] of Object.entries(remotesMap)) {
    if (urls.push) {
      if (!isPushTargetInert(urls.push)) {
        issues.push(
          `Remote '${name}' has active push URL '${urls.push}'; must be inert (e.g. 'no_push')`,
        );
      }
    } else if (urls.fetch) {
      if (!isPushTargetInert(urls.fetch)) {
        issues.push(
          `Remote '${name}' has fetch URL '${urls.fetch}' without an explicit inert push URL configured`,
        );
      }
    }
  }

  return {
    ok: issues.length === 0,
    remotes: remotesMap,
    issues,
  };
}

/**
 * Audits an environment object for ambient credentials and push-enabling variables.
 */
export function auditEnvironmentCredentials(
  env: Readonly<Record<string, string | undefined>>,
): EnvironmentSafetyAuditResult {
  const violations: string[] = [];

  for (const key of SENSITIVE_PUSH_ENV_VARS) {
    const val = env[key];
    if (val !== undefined && val.trim() !== "") {
      violations.push(`Environment variable '${key}' is present with non-empty credential value`);
    }
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}
