import { homedir } from "node:os";
import { readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

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
}
