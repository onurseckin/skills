import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type { ScopedExecutionPolicy } from "../../../olt/scripts/src/testing/scoped-execution.ts";

export function createSampleScopedPolicy(
  overrides: Partial<ScopedExecutionPolicy> = {},
): ScopedExecutionPolicy {
  return {
    allowedDomains: ["testing", "engine"],
    maxAllowedTestFiles: 1,
    maxDurationMs: 5000,
    maxMemoryMb: 512,
    maxCpuPercent: 100,
    allowFullSuite: false,
    ...overrides,
  };
}

export interface SpawnMockOptions {
  readonly status?: number | undefined;
  readonly stderr?: string | undefined;
}

export function createSpawnMock(options: SpawnMockOptions = {}): () => ChildProcess {
  const status = options.status !== undefined ? options.status : 0;
  const stderrText = options.stderr !== undefined ? options.stderr : "";
  return (): ChildProcess => {
    const stderrStream = new EventEmitter();
    const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
    child.stderr = stderrStream;
    setTimeout(() => {
      if (stderrText.length > 0) {
        stderrStream.emit("data", Buffer.from(stderrText));
      }
      setTimeout(() => {
        child.emit("close", status);
      }, 0);
    }, 0);
    return child as unknown as ChildProcess;
  };
}
