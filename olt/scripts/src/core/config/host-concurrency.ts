import { availableParallelism, cpus } from "node:os";
import {
  detectHostTelemetry,
  type DetectHostIdentityOptions,
} from "../../summary/metrics/index.ts";

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

export interface ParallelismProbes {
  readonly availableParallelism?: () => number;
  readonly cpuCount?: () => number;
}

function safeParallelism(probes: ParallelismProbes = {}): number {
  let probeAvailableParallelism: (() => number) | undefined;
  if (probes.availableParallelism !== undefined) {
    probeAvailableParallelism = probes.availableParallelism;
  } else {
    probeAvailableParallelism = availableParallelism;
  }
  try {
    if (typeof probeAvailableParallelism === "function") {
      const detected = probeAvailableParallelism();
      if (Number.isInteger(detected) && detected >= 1) return detected;
    }
  } catch {}
  let probeCpuCount: () => number;
  if (probes.cpuCount !== undefined) {
    probeCpuCount = probes.cpuCount;
  } else {
    probeCpuCount = () => cpus().length;
  }
  try {
    const count = probeCpuCount();
    if (Number.isInteger(count) && count >= 1) return count;
  } catch {}
  return 1;
}

export function deriveGateConcurrencyCeiling(
  cpuCount?: number,
  probes?: ParallelismProbes,
): number {
  let cores: number;
  if (cpuCount !== undefined) {
    cores = cpuCount;
  } else {
    cores = safeParallelism(probes);
  }
  return Math.max(1, Math.floor(cores / 2));
}
