import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { scratchRoot as makeScratchRoot } from "../../support/scratch-root.ts";
import { AGENT_ROLES, type AgentRole } from "../../../orchestrating-long-tasks/scripts/src/contracts/packets.ts";
import { loadRoleContract } from "../../../orchestrating-long-tasks/scripts/src/packets/role-contract.ts";
import { loadMindContract } from "../../../orchestrating-long-tasks/scripts/src/mind/deploy.ts";

function scratchRoot(label: string): string {
  return makeScratchRoot(import.meta.path, label);
}

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
        issues.push(`Remote '${name}' has active push URL '${urls.push}'; must be inert (e.g. 'no_push')`);
      }
    } else if (urls.fetch) {
      // In Git, if push URL is not explicitly set, push defaults to fetch URL.
      // If fetch URL is a network or writable target, that constitutes an implicit push vulnerability.
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

/**
 * Initializes a scratch git repository for testing.
 */
function initTestRepo(root: string): void {
  Bun.spawnSync(["git", "init", "-b", "main"], { cwd: root });
  Bun.spawnSync(["git", "config", "user.name", "Safety Test User"], { cwd: root });
  Bun.spawnSync(["git", "config", "user.email", "safety@example.local"], { cwd: root });
  writeFileSync(join(root, "README.md"), "# Safety Test\n", "utf-8");
  Bun.spawnSync(["git", "add", "README.md"], { cwd: root });
  Bun.spawnSync(["git", "commit", "-m", "chore: initial commit"], { cwd: root });
}

describe("PHASE-6 W6.4: Remote Container Safety & Capability Removal", () => {
  describe("1. Remote URL Configuration and Inert Push Targets", () => {
    test("isPushTargetInert identifies safe dummy push targets", () => {
      expect(isPushTargetInert("no_push")).toBe(true);
      expect(isPushTargetInert("no-push")).toBe(true);
      expect(isPushTargetInert("disabled")).toBe(true);
      expect(isPushTargetInert("disabled://push-prohibited")).toBe(true);
      expect(isPushTargetInert("/dev/null")).toBe(true);
      expect(isPushTargetInert("file:///dev/null")).toBe(true);
      expect(isPushTargetInert("dummy://inert")).toBe(true);

      // Active / writable push targets are NOT inert
      expect(isPushTargetInert("git@github.com:org/repo.git")).toBe(false);
      expect(isPushTargetInert("https://github.com/org/repo.git")).toBe(false);
      expect(isPushTargetInert("ssh://git@gitlab.com/org/repo.git")).toBe(false);
      expect(isPushTargetInert("")).toBe(false);
      expect(isPushTargetInert(undefined)).toBe(false);
    });

    test("auditRemoteUrls passes when no remotes are configured", () => {
      const root = scratchRoot("audit-no-remotes");
      initTestRepo(root);

      const audit = auditRemoteUrls(root);
      expect(audit.ok).toBe(true);
      expect(audit.issues).toEqual([]);
      expect(Object.keys(audit.remotes).length).toBe(0);
    });

    test("auditRemoteUrls passes when push URL is set to 'no_push'", () => {
      const root = scratchRoot("audit-inert-push");
      initTestRepo(root);

      Bun.spawnSync(["git", "remote", "add", "origin", "git@github.com:org/repo.git"], {
        cwd: root,
      });
      Bun.spawnSync(["git", "remote", "set-url", "--push", "origin", "no_push"], {
        cwd: root,
      });

      const audit = auditRemoteUrls(root);
      expect(audit.ok).toBe(true);
      expect(audit.issues).toEqual([]);
      expect(audit.remotes.origin?.fetch).toBe("git@github.com:org/repo.git");
      expect(audit.remotes.origin?.push).toBe("no_push");
    });

    test("auditRemoteUrls detects missing explicit push URL on writable fetch remote", () => {
      const root = scratchRoot("audit-missing-push-override");
      initTestRepo(root);

      Bun.spawnSync(["git", "remote", "add", "origin", "git@github.com:org/repo.git"], {
        cwd: root,
      });

      const audit = auditRemoteUrls(root);
      expect(audit.ok).toBe(false);
      expect(audit.issues.length).toBeGreaterThan(0);
      expect(audit.issues[0]).toMatch(/has active push URL|without an explicit inert push URL configured/u);
    });

    test("auditRemoteUrls detects active/writable push URL", () => {
      const root = scratchRoot("audit-active-push");
      initTestRepo(root);

      Bun.spawnSync(["git", "remote", "add", "origin", "https://github.com/org/repo.git"], {
        cwd: root,
      });
      Bun.spawnSync(
        ["git", "remote", "set-url", "--push", "origin", "git@github.com:org/repo.git"],
        { cwd: root },
      );

      const audit = auditRemoteUrls(root);
      expect(audit.ok).toBe(false);
      expect(audit.issues.length).toBe(1);
      expect(audit.issues[0]).toContain("has active push URL 'git@github.com:org/repo.git'");
    });
  });

  describe("2. Transport-Layer Git Push Execution Failures", () => {
    test("git push fails at transport/git layer when no remote exists", async () => {
      const root = scratchRoot("push-fail-no-remote");
      initTestRepo(root);

      const proc = Bun.spawn(["git", "push", "origin", "main"], {
        cwd: root,
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const stderr = await new Response(proc.stderr).text();

      // Must fail with non-zero exit code
      expect(exitCode).not.toBe(0);
      // Failure must come directly from Git's fatal transport error
      expect(stderr.toLowerCase()).toContain("fatal:");
      expect(stderr.toLowerCase()).toMatch(/('origin' does not appear to be a git repository|fatal: 'origin')/u);
    });

    test("git push fails at transport/git layer when push URL is 'no_push'", async () => {
      const root = scratchRoot("push-fail-inert-url");
      initTestRepo(root);

      Bun.spawnSync(["git", "remote", "add", "origin", "git@github.com:org/repo.git"], {
        cwd: root,
      });
      Bun.spawnSync(["git", "remote", "set-url", "--push", "origin", "no_push"], {
        cwd: root,
      });

      const proc = Bun.spawn(["git", "push", "origin", "main"], {
        cwd: root,
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const stderr = await new Response(proc.stderr).text();

      // Must exit non-zero
      expect(exitCode).not.toBe(0);
      // Git transport layer rejects the destination string
      expect(stderr).toContain("fatal:");
      expect(stderr).toContain("'no_push' does not appear to be a git repository");
    });

    test("git push fails at transport/git layer when push URL points to /dev/null", async () => {
      const root = scratchRoot("push-fail-dev-null");
      initTestRepo(root);

      Bun.spawnSync(["git", "remote", "add", "origin", "git@github.com:org/repo.git"], {
        cwd: root,
      });
      Bun.spawnSync(["git", "remote", "set-url", "--push", "origin", "/dev/null"], {
        cwd: root,
      });

      const proc = Bun.spawn(["git", "push", "origin", "main"], {
        cwd: root,
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const stderr = await new Response(proc.stderr).text();

      expect(exitCode).not.toBe(0);
      expect(stderr.toLowerCase()).toContain("fatal:");
    });

    test("capability removal structurally prevents push regardless of flags or branches", async () => {
      const root = scratchRoot("push-fail-force-flags");
      initTestRepo(root);

      Bun.spawnSync(["git", "remote", "add", "origin", "git@github.com:org/repo.git"], {
        cwd: root,
      });
      Bun.spawnSync(["git", "remote", "set-url", "--push", "origin", "no_push"], {
        cwd: root,
      });

      // Even with --force, --all, -u, or other push options, git transport layer fatal errors
      const proc = Bun.spawn(["git", "push", "--force", "--all", "origin"], {
        cwd: root,
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const stderr = await new Response(proc.stderr).text();

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("fatal:");
      expect(stderr).toContain("'no_push' does not appear to be a git repository");
    });
  });

  describe("3. Verification of 0 Ambient Push Credentials", () => {
    test("auditEnvironmentCredentials passes when environment is clean", () => {
      const cleanEnv: Record<string, string | undefined> = {
        PATH: "/usr/bin:/bin",
        HOME: "/home/mind-runner",
        LANG: "en_US.UTF-8",
        NODE_ENV: "production",
      };

      const audit = auditEnvironmentCredentials(cleanEnv);
      expect(audit.ok).toBe(true);
      expect(audit.violations).toEqual([]);
    });

    test("auditEnvironmentCredentials detects dangerous push tokens", () => {
      const dirtyEnvs: Array<Record<string, string>> = [
        { GITHUB_TOKEN: "ghp_1234567890abcdef" },
        { GH_TOKEN: "gho_secretToken" },
        { GIT_AUTH_TOKEN: "pat_secret_key" },
        { GIT_PASSWORD: "super_secret_password" },
        { GIT_ASKPASS: "/opt/bin/askpass.sh" },
        { GIT_SSH_COMMAND: "ssh -i /root/.ssh/id_rsa_write" },
        { GITLAB_TOKEN: "glpat-xxxxxx" },
        { AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
      ];

      for (const dirty of dirtyEnvs) {
        const audit = auditEnvironmentCredentials(dirty);
        expect(audit.ok).toBe(false);
        expect(audit.violations.length).toBe(1);
        const keyName = Object.keys(dirty)[0] ?? "";
        expect(audit.violations[0]).toContain(keyName);
      }
    });

    test("auditEnvironmentCredentials flags multiple ambient violations simultaneously", () => {
      const multiDirty = {
        GITHUB_TOKEN: "ghp_abc",
        GH_TOKEN: "gho_xyz",
        GIT_SSH_COMMAND: "ssh -i /path",
      };

      const audit = auditEnvironmentCredentials(multiDirty);
      expect(audit.ok).toBe(false);
      expect(audit.violations.length).toBe(3);
    });
  });

  describe("4. 3-Layer Security Model Architecture & Documentation Verification", () => {
    const safetyDocPath = resolve(import.meta.dir, "../../../deploy/SAFETY.md");

    test("deploy/SAFETY.md exists and is non-empty", () => {
      expect(existsSync(safetyDocPath)).toBe(true);
      const content = readFileSync(safetyDocPath, "utf-8");
      expect(content.length).toBeGreaterThan(1000);
    });

    test("deploy/SAFETY.md documents all 3 layers per PHASE-6 §3.4 and PLAN.md §11.4", () => {
      const content = readFileSync(safetyDocPath, "utf-8");

      // Verify Layer 1: Host Permission System
      expect(content).toContain("Layer 1: Host Permission System");
      expect(content).toMatch(/host.*permission/iu);

      // Verify Layer 2: Blast Radius Containment
      expect(content).toContain("Layer 2: Blast Radius Containment");
      expect(content).toMatch(/no push remote/iu);
      expect(content).toMatch(/pull-only credentials/iu);
      expect(content).toMatch(/branch protection/iu);

      // Verify Layer 3: Harness Rails
      expect(content).toContain("Layer 3: Harness Rails");
      expect(content).toMatch(/CLI door constrains harness commands.*not.*shell/iu);
    });

    test("deploy/SAFETY.md explains capability removal vs soft policy rules", () => {
      const content = readFileSync(safetyDocPath, "utf-8");
      expect(content).toMatch(/Remove the capability.*not.*merely forbid/iu);
      expect(content).toContain("no_push");
    });

    test("Mind role contract in Layer 3 enforces command boundaries", () => {
      const mindContract = loadMindContract();
      expect(mindContract.role).toBe("mind");
      expect(mindContract.tier).toBe(0);

      // Harness commands permitted for Mind
      const permittedCommands = new Set(mindContract.commands);
      expect(permittedCommands.has("mind:observe")).toBe(true);
      expect(permittedCommands.has("mind:admit")).toBe(true);
      expect(permittedCommands.has("orchestrator:supervise")).toBe(true);

      // Mind role is strictly prohibited from compilation, claim, implement, validate
      expect(permittedCommands.has("plan:compile")).toBe(false);
      expect(permittedCommands.has("task:claim")).toBe(false);
      expect(permittedCommands.has("task:submit")).toBe(false);
      expect(permittedCommands.has("task:review")).toBe(false);
    });
  });
});
