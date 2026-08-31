import { homedir } from "node:os";
import { readFile, readdir, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

export interface ProcessExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CollectorEnvironment {
  exec?: (command: string, args: string[]) => Promise<ProcessExecResult | null>;
  readFile?: (filePath: string) => Promise<string | null>;
  exists?: (filePath: string) => Promise<boolean>;
  env?: Record<string, string | undefined>;
  homedir?: string;
  fetchUserStatus?: (port: string) => Promise<Record<string, unknown> | null>;
  fetchClaudeUsage?: () => Promise<Record<string, unknown> | null>;
  fetchCodexUsage?: () => Promise<Record<string, unknown> | null>;
}

export class DefaultCollectorEnvironment implements Required<CollectorEnvironment> {
  private readonly overrides: CollectorEnvironment;

  constructor(overrides: CollectorEnvironment = {}) {
    this.overrides = overrides;
  }

  public get homedir(): string {
    return this.overrides.homedir ?? homedir();
  }

  public get env(): Record<string, string | undefined> {
    return this.overrides.env ?? process.env;
  }

  public async exec(command: string, args: string[]): Promise<ProcessExecResult | null> {
    if (this.overrides.exec) {
      return this.overrides.exec(command, args);
    }
    try {
      const { stdout, stderr } = await execFileAsync(command, args, {
        timeout: 1000,
        encoding: "utf8",
        env: this.env as NodeJS.ProcessEnv,
        windowsHide: true,
      });
      return { stdout, stderr, exitCode: 0 };
    } catch {
      return null;
    }
  }

  public async readFile(filePath: string): Promise<string | null> {
    if (this.overrides.readFile) {
      return this.overrides.readFile(filePath);
    }
    try {
      return await readFile(filePath, "utf8");
    } catch {
      return null;
    }
  }

  public async exists(filePath: string): Promise<boolean> {
    if (this.overrides.exists) {
      return this.overrides.exists(filePath);
    }
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
    if (this.overrides.fetchUserStatus) {
      return this.overrides.fetchUserStatus(port);
    }

    if (this.overrides.readFile) {
      return null;
    }

    if (port === "0" || port === "mock") {
      return null;
    }

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
      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        if (data) return data;
      }
    } catch {}

    return null;
  }

  public async fetchAntigravityFixture(): Promise<Record<string, unknown> | null> {
    try {
      const fixturePath = new URL("../fixtures/antigravity-sample.json", import.meta.url).pathname;
      const raw = await readFile(fixturePath, "utf8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  public get hasFetchClaudeUsageOverride(): boolean {
    return typeof this.overrides.fetchClaudeUsage === "function";
  }

  public async fetchClaudeUsage(): Promise<Record<string, unknown> | null> {
    if (this.overrides.fetchClaudeUsage) {
      return this.overrides.fetchClaudeUsage();
    }

    if (this.overrides.readFile) {
      return null;
    }

    try {
      const claudeJsonPath = join(this.homedir, ".claude.json");
      const raw = await readFile(claudeJsonPath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed && (parsed.cachedUsageUtilization || parsed.oauthAccount || parsed.utilization)) {
        return parsed;
      }
    } catch {}

    try {
      const token = this.env.CLAUDE_CODE_OAUTH_TOKEN ?? this.env.ANTHROPIC_OAUTH_TOKEN;
      if (token) {
        const requestOptions = {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "anthropic-beta": "oauth-2025-04-20",
            "User-Agent": "claude-code/2.1.241",
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(1500),
        };
        const res = await fetch("https://api.anthropic.com/api/oauth/usage", requestOptions);
        if (res.ok) {
          const data = (await res.json()) as Record<string, unknown>;
          if (data) {
            return { cachedUsageUtilization: { utilization: data } };
          }
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
    if (this.overrides.fetchCodexUsage) {
      return this.overrides.fetchCodexUsage();
    }

    if (this.overrides.readFile) {
      return null;
    }

    try {
      const sessionsDir = join(this.homedir, ".codex", "sessions");
      const entries = await readdir(sessionsDir, { recursive: true, withFileTypes: true });
      const rolloutFiles = entries
        .filter((e) => e.isFile() && e.name.startsWith("rollout-") && e.name.endsWith(".jsonl"))
        .map((e) => ({
          name: e.name,
          fullPath: join(e.parentPath ?? (e as { path?: string }).path ?? sessionsDir, e.name),
        }))
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
                parsed &&
                (payload?.type === "token_count" ||
                  parsed.type === "token_count" ||
                  payload?.rate_limits ||
                  parsed.rate_limits)
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

  public async fetchCodexFixture(): Promise<Record<string, unknown> | null> {
    try {
      const fixturePath = new URL("../fixtures/openai-sample.json", import.meta.url).pathname;
      const raw = await readFile(fixturePath, "utf8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
