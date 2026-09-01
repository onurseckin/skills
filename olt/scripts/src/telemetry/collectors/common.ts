import { homedir } from "node:os";
import { readFile, readdir, stat } from "node:fs/promises";
import * as childProcess from "node:child_process";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { detectActiveHost, isPlatformMatchingHost, type CanonicalHost } from "./host-detection.ts";

const execFileAsync = promisify(execFile);

export const MAX_STORAGE_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes TTL for dynamic snapshots
export const MAX_FUTURE_CLOCK_SKEW_MS = 60 * 1000; // 60 seconds tolerance for clock drift

export interface CacheFreshnessResult {
  readonly isFresh: boolean;
  readonly reason?: "stale_cache_ttl_expired" | "future_clock_skew_exceeded" | undefined;
  readonly ageMs: number;
}

export function validateStorageCacheFreshness(
  timestamp: number | string | Date | undefined,
  nowMs: number = Date.now(),
  maxTtlMs: number = MAX_STORAGE_CACHE_TTL_MS,
  maxSkewMs: number = MAX_FUTURE_CLOCK_SKEW_MS,
): CacheFreshnessResult {
  if (timestamp === undefined) return { isFresh: true, ageMs: 0 };
  const timeMs = typeof timestamp === "number" ? timestamp : new Date(timestamp).getTime();
  if (isNaN(timeMs)) return { isFresh: true, ageMs: 0 };

  const diffMs = nowMs - timeMs;
  if (diffMs < -maxSkewMs) {
    return { isFresh: false, reason: "future_clock_skew_exceeded", ageMs: diffMs };
  }
  if (diffMs > maxTtlMs) {
    return { isFresh: false, reason: "stale_cache_ttl_expired", ageMs: diffMs };
  }
  return { isFresh: true, ageMs: Math.max(0, diffMs) };
}

export interface ProcessExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CollectorEnvironment {
  exec?: ((command: string, args: string[]) => Promise<ProcessExecResult | null>) | undefined;
  readFile?: ((filePath: string) => Promise<string | null>) | undefined;
  exists?: ((filePath: string) => Promise<boolean>) | undefined;
  env?: Record<string, string | undefined> | undefined;
  homedir?: string | undefined;
  fetchUserStatus?: ((port: string) => Promise<Record<string, unknown> | null>) | undefined;
  fetchClaudeUsage?: (() => Promise<Record<string, unknown> | null>) | undefined;
  fetchCodexUsage?: (() => Promise<Record<string, unknown> | null>) | undefined;
  activeHost?: CanonicalHost | string | undefined;
  activeModel?: string | undefined;
  processTree?: readonly string[] | string | undefined;
  isolateExternalCaches?: boolean | undefined;
}

export class DefaultCollectorEnvironment implements Required<CollectorEnvironment> {
  private readonly overrides: CollectorEnvironment;

  constructor(overrides: CollectorEnvironment = {}) {
    this.overrides = overrides;
  }

  public get homedir(): string {
    return this.overrides.homedir !== undefined ? this.overrides.homedir : homedir();
  }

  public get env(): Record<string, string | undefined> {
    return this.overrides.env !== undefined
      ? this.overrides.env
      : typeof process !== "undefined"
        ? process.env
        : {};
  }

  public get activeHost(): CanonicalHost | string | undefined {
    return this.overrides.activeHost;
  }

  public get activeModel(): string | undefined {
    return this.overrides.activeModel;
  }

  public get processTree(): readonly string[] | string | undefined {
    return this.overrides.processTree;
  }

  public get isolateExternalCaches(): boolean {
    return this.overrides.isolateExternalCaches !== undefined
      ? this.overrides.isolateExternalCaches
      : true;
  }

  public isHostActive(platformId: string): boolean {
    if (this.overrides.activeHost) {
      return isPlatformMatchingHost(platformId, this.overrides.activeHost);
    }
    const detected = detectActiveHost({
      env: this.env,
      processTree: this.processTree,
      model: this.activeModel,
    });
    return isPlatformMatchingHost(platformId, detected.activeHost);
  }

  public async exec(command: string, args: string[]): Promise<ProcessExecResult | null> {
    if (this.overrides.exec) return this.overrides.exec(command, args);
    if (
      process.env.NODE_ENV === "test" ||
      process.env.BUN_ENV === "test" ||
      process.env.OLT_VIRTUAL_FS === "1"
    ) {
      return null;
    }
    try {
      const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>(
        (resolve, reject) => {
          childProcess.execFile(
            command,
            args,
            {
              timeout: 1000,
              encoding: "utf8",
              env: this.env as NodeJS.ProcessEnv,
              windowsHide: true,
            },
            (error, stdout, stderr) => {
              if (error) reject(error);
              else resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
            },
          );
        },
      );
      return { stdout, stderr, exitCode: 0 };
    } catch {
      return null;
    }
  }

  public async readFile(filePath: string): Promise<string | null> {
    if (this.overrides.readFile) return this.overrides.readFile(filePath);
    try {
      return await readFile(filePath, "utf8");
    } catch {
      return null;
    }
  }

  public async exists(filePath: string): Promise<boolean> {
    if (this.overrides.exists) return this.overrides.exists(filePath);
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  public get hasFetchUserStatusOverride(): boolean {
    return typeof this.overrides.fetchUserStatus === "function";
  }

  public async fetchUserStatus(port: string): Promise<Record<string, unknown> | null> {
    if (this.overrides.fetchUserStatus) return this.overrides.fetchUserStatus(port);
    if (this.overrides.readFile || port === "0" || port === "mock") return null;

    try {
      const requestOptions = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        tls: { rejectUnauthorized: false },
        signal: AbortSignal.timeout(400),
      };
      const res = await fetch(
        `https://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/GetUserStatus`,
        requestOptions as unknown as RequestInit,
      );
      if (res.ok) return (await res.json()) as Record<string, unknown>;
    } catch {}

    return null;
  }

  public get hasFetchClaudeUsageOverride(): boolean {
    return typeof this.overrides.fetchClaudeUsage === "function";
  }

  public async fetchClaudeUsage(): Promise<Record<string, unknown> | null> {
    if (this.overrides.fetchClaudeUsage) return this.overrides.fetchClaudeUsage();
    if (this.overrides.readFile) return null;

    try {
      const claudeJsonPath = join(this.homedir, ".claude.json");
      const content = await readFile(claudeJsonPath, "utf8");
      const parsed = JSON.parse(content) as Record<string, unknown>;
      if (parsed.cachedUsageUtilization || parsed.oauthAccount || parsed.utilization) {
        return parsed;
      }
    } catch {}

    try {
      const token = this.env.CLAUDE_CODE_OAUTH_TOKEN ?? this.env.ANTHROPIC_OAUTH_TOKEN;
      if (token) {
        const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "anthropic-beta": "oauth-2025-04-20",
            "User-Agent": "claude-code/2.1.241",
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(1500),
        });
        if (res.ok) {
          const data = (await res.json()) as Record<string, unknown>;
          if (data) return { cachedUsageUtilization: { utilization: data } };
        }
      }
    } catch {}

    return null;
  }

  public async fetchClaudeFixture(): Promise<Record<string, unknown> | null> {
    try {
      const fixturePath = new URL("../fixtures/claude-sample.json", import.meta.url).pathname;
      const raw = await readFile(fixturePath, "utf8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  public get hasFetchCodexUsageOverride(): boolean {
    return typeof this.overrides.fetchCodexUsage === "function";
  }

  public async fetchCodexUsage(): Promise<Record<string, unknown> | null> {
    if (this.overrides.fetchCodexUsage) return this.overrides.fetchCodexUsage();
    if (this.overrides.readFile) return null;

    try {
      const sessionsDir = join(this.homedir, ".codex", "sessions");
      const entries = await readdir(sessionsDir, { recursive: true, withFileTypes: true });
      const rolloutFiles = entries
        .filter((e) => e.isFile() && e.name.startsWith("rollout-") && e.name.endsWith(".jsonl"))
        .map((e) => {
          const dir = e.parentPath ?? (e as { path?: string }).path ?? sessionsDir;
          return { name: e.name, fullPath: join(dir, e.name) };
        })
        .sort((a, b) => b.name.localeCompare(a.name));

      for (const file of rolloutFiles.slice(0, 20)) {
        try {
          const raw = await readFile(file.fullPath, "utf8");
          const lines = raw.split("\n").filter(Boolean);
          for (let i = lines.length - 1; i >= 0; i--) {
            try {
              const parsed = JSON.parse(lines[i]!) as Record<string, unknown>;
              const payload = parsed?.payload as Record<string, unknown> | undefined;
              if (
                payload?.type === "token_count" ||
                parsed.type === "token_count" ||
                payload?.rate_limits ||
                parsed.rate_limits
              ) {
                return parsed;
              }
            } catch {}
          }
        } catch {}
      }
    } catch {}

    return null;
  }
}
