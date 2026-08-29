import { spawn, type ChildProcess } from "node:child_process";
import type { ChildProcessOptions, ChildProcessResult } from "./types.ts";

export class IsolatedChildProcessManager {
  private readonly runningProcesses = new Set<ChildProcess>();

  public async runIsolated(
    command: string,
    args: readonly string[] = [],
    options: ChildProcessOptions = {},
  ): Promise<ChildProcessResult> {
    const start = performance.now();
    const timeoutMs = options.timeoutMs ?? 30_000;
    const maxBufferBytes = options.maxBufferBytes ?? 10 * 1024 * 1024;
    const killSignal = options.killSignal ?? "SIGTERM";

    return new Promise<ChildProcessResult>((resolveProcess) => {
      let timedOut = false;
      let killed = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let forceKillTimer: ReturnType<typeof setTimeout> | null = null;

      let stdoutAccumulator = "";
      let stderrAccumulator = "";
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let stdoutTruncated = false;
      let stderrTruncated = false;

      const proc = spawn(command, [...args], {
        cwd: options.cwd,
        env: options.env,
        shell: options.shell ?? false,
        stdio: [options.stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
      });

      this.runningProcesses.add(proc);

      const cleanup = (): void => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (forceKillTimer) {
          clearTimeout(forceKillTimer);
          forceKillTimer = null;
        }
        this.runningProcesses.delete(proc);
      };

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          killed = true;
          this.terminateProcess(proc, killSignal);
          forceKillTimer = setTimeout(() => {
            if (!proc.killed) {
              try {
                proc.kill("SIGKILL");
              } catch {}
            }
          }, 2000);
        }, timeoutMs);
      }

      if (options.abortSignal) {
        if (options.abortSignal.aborted) {
          killed = true;
          this.terminateProcess(proc, "SIGKILL");
        } else {
          options.abortSignal.addEventListener("abort", () => {
            killed = true;
            this.terminateProcess(proc, "SIGKILL");
          });
        }
      }

      if (options.stdin !== undefined && proc.stdin) {
        try {
          proc.stdin.write(options.stdin);
          proc.stdin.end();
        } catch {}
      }

      if (proc.stdout) {
        proc.stdout.on("data", (chunk: Buffer | string) => {
          const str = chunk.toString();
          stdoutBytes += Buffer.byteLength(str);
          if (stdoutBytes <= maxBufferBytes) {
            stdoutAccumulator += str;
          } else if (!stdoutTruncated) {
            stdoutTruncated = true;
            stdoutAccumulator += "\n[STDOUT TRUNCATED: MAX BUFFER EXCEEDED]";
          }
        });
      }

      if (proc.stderr) {
        proc.stderr.on("data", (chunk: Buffer | string) => {
          const str = chunk.toString();
          stderrBytes += Buffer.byteLength(str);
          if (stderrBytes <= maxBufferBytes) {
            stderrAccumulator += str;
          } else if (!stderrTruncated) {
            stderrTruncated = true;
            stderrAccumulator += "\n[STDERR TRUNCATED: MAX BUFFER EXCEEDED]";
          }
        });
      }

      proc.on("error", (err) => {
        cleanup();
        resolveProcess({
          exitCode: 1,
          signal: null,
          stdout: stdoutAccumulator,
          stderr: stderrAccumulator ? `${stderrAccumulator}\n${err.message}` : err.message,
          durationMs: performance.now() - start,
          timedOut,
          killed,
        });
      });

      proc.on("close", (code, sig) => {
        cleanup();
        resolveProcess({
          exitCode: code,
          signal: sig,
          stdout: stdoutAccumulator,
          stderr: stderrAccumulator,
          durationMs: performance.now() - start,
          timedOut,
          killed: killed || sig !== null,
        });
      });
    });
  }

  private terminateProcess(proc: ChildProcess, signal: NodeJS.Signals): void {
    try {
      if (proc.pid) {
        process.kill(-proc.pid, signal);
      } else {
        proc.kill(signal);
      }
    } catch {
      try {
        proc.kill(signal);
      } catch {}
    }
  }

  public killAll(): void {
    for (const proc of this.runningProcesses) {
      try {
        proc.kill("SIGKILL");
      } catch {}
    }
    this.runningProcesses.clear();
  }

  public getActiveCount(): number {
    return this.runningProcesses.size;
  }
}

export async function spawnIsolatedProcess(
  command: string,
  args: readonly string[] = [],
  options: ChildProcessOptions = {},
): Promise<ChildProcessResult> {
  const manager = new IsolatedChildProcessManager();
  return manager.runIsolated(command, args, options);
}
