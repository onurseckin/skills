import { homedir } from "node:os";
import { readFile, stat } from "node:fs/promises";
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

    if (port === "0" || port === "mock") {
      return null;
    }

    // Default to local cached fixture to avoid rate-limiting/spamming live server during report formatting.
    // Set OLT_LIVE_RPC=true to execute live Connect-RPC call directly against the active Language Server.
    const useLiveRpc = this.env.OLT_LIVE_RPC === "true";

    if (!useLiveRpc) {
      if (this.overrides.readFile && !this.overrides.fetchUserStatus) {
        return null;
      }
      try {
        const fixturePath = new URL("../fixtures/antigravity-sample.json", import.meta.url)
          .pathname;
        const raw = await readFile(fixturePath, "utf8");
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // Fall back to live RPC if fixture read fails
      }
    }

    /* =========================================================================
     * REAL LIVE CONNECT-RPC LANGUAGE SERVER QUERY
     * Connects to Antigravity Language Server on 127.0.0.1:<port>
     * ========================================================================= */
    try {
      const requestOptions = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        tls: { rejectUnauthorized: false },
        signal: AbortSignal.timeout(600),
      };
      const res = await fetch(
        `https://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/GetUserStatus`,
        // Cast via unknown to RequestInit for Bun TLS extension support
        requestOptions as unknown as RequestInit,
      );
      if (!res.ok) {
        return null;
      }
      const data = (await res.json()) as Record<string, unknown>;
      return data;
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

    // Default to local cached fixture to avoid rate-limiting/spamming live server during report formatting.
    // Set OLT_LIVE_CLAUDE_RPC=true to execute live Anthropic API call directly against the OAuth endpoint.
    const useLiveRpc = this.env.OLT_LIVE_CLAUDE_RPC === "true";

    if (!useLiveRpc) {
      if (this.overrides.readFile && !this.overrides.fetchClaudeUsage) {
        return null;
      }
      // 1. Try reading the local cached fixture first
      try {
        const fixturePath = new URL("../fixtures/claude-sample.json", import.meta.url).pathname;
        const raw = await readFile(fixturePath, "utf8");
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // Fall back to reading ~/.claude.json directly
      }

      // 2. Try reading ~/.claude.json directly
      try {
        const claudeJsonPath = join(this.homedir, ".claude.json");
        const raw = await readFile(claudeJsonPath, "utf8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (parsed.cachedUsageUtilization || parsed.oauthAccount) {
          return parsed;
        }
      } catch {
        // Fall back to live call
      }
    }

    /* =========================================================================
     * REAL LIVE ANTHROPIC OAUTH USAGE QUERY
     * Connects to https://api.anthropic.com/api/oauth/usage
     * ========================================================================= */
    try {
      const token = this.env.CLAUDE_CODE_OAUTH_TOKEN || this.env.ANTHROPIC_OAUTH_TOKEN;
      if (!token) {
        return null;
      }
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
      if (!res.ok) {
        return null;
      }
      const data = (await res.json()) as Record<string, unknown>;
      return { cachedUsageUtilization: { utilization: data } };
    } catch {
      return null;
    }
  }
}
