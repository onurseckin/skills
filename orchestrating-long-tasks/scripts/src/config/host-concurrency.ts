import { availableParallelism, cpus } from "node:os";
import { detectHostTelemetry, type DetectHostIdentityOptions } from "../summary/host-telemetry.ts";

export interface HostConcurrencyCeiling {
  readonly value: number;
  readonly hostTool: string;
}

const CONFIG_RESOLUTION_PROBE_ID = "harness-config-resolution";

export function discoverHostConcurrencyCeiling(
  options?: DetectHostIdentityOptions,
): HostConcurrencyCeiling | null {
  const probe = detectHostTelemetry(CONFIG_RESOLUTION_PROBE_ID, options);
  if (probe === null) return null;
  const ceiling = probe.capabilities.concurrency_ceiling;
  if (ceiling === undefined) return null;
  const value = ceiling.value;
  if (!Number.isInteger(value) || value < 1) return null;
  return { value, hostTool: probe.host_tool };
}

function safeParallelism(): number {
  try {
    if (typeof availableParallelism === "function") {
      const detected = availableParallelism();
      if (Number.isInteger(detected) && detected >= 1) return detected;
    }
  } catch {}
  try {
    const count = cpus().length;
    if (Number.isInteger(count) && count >= 1) return count;
  } catch {}
  return 1;
}

export function deriveGateConcurrencyCeiling(cpuCount?: number): number {
  const cores = cpuCount ?? safeParallelism();
  return Math.max(1, Math.floor(cores / 2));
}
