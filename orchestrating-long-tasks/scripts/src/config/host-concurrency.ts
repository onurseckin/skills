import { availableParallelism, cpus } from "node:os";
import {
  detectHostTelemetry,
  type DetectHostIdentityOptions,
} from "../summary/host-telemetry.ts";

/**
 * B27.2: "read the host's declared concurrency limit where it publishes one... the harness must not
 * hardcode a number." `summary/host-telemetry.ts` is already the one place that knows how to read a
 * host's own configuration (env vars, per-host config files) for a session-wide concurrency ceiling
 * (`codex`'s `max_concurrent_threads_per_session`, Claude Code's `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`),
 * so this module asks it rather than re-reading those sources itself - one place stays the source of
 * truth for what a host publishes about itself.
 */
export interface HostConcurrencyCeiling {
  readonly value: number;
  /** Which host reported it, so a resolved config can say why it picked this number. */
  readonly hostTool: string;
}

/**
 * Ceiling discovery is session-wide, not per-agent: neither host that publishes one
 * (`codex`, `claude-code`) keys it by agent id. A fixed, honestly-named probe id stands in for "no
 * particular agent" rather than borrowing a real agent's identity for a query that isn't about one.
 */
const CONFIG_RESOLUTION_PROBE_ID = "harness-config-resolution";

/**
 * Returns null when the host publishes nothing usable - never a guessed number standing in for an
 * absent one. Callers decide what "the host said nothing" means for them (B27.2: "unset means use
 * what the host allows").
 */
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
  } catch {
    // Fall through to cpus() below.
  }
  try {
    const count = cpus().length;
    if (Number.isInteger(count) && count >= 1) return count;
  } catch {
    // A sandboxed or restricted host may refuse both queries.
  }
  // Neither query answered. One lane is always safe, and it is a floor, not a guess at the real
  // count - the caller (deriveGateConcurrencyCeiling) still applies its own halving on top of it.
  return 1;
}

/**
 * B27.2's "separate, lower ceiling for gate-running agents... the number worth deriving from
 * cores": gate work (tsc, full test suites) is local-CPU-bound, unlike reasoning which waits on a
 * provider and costs the host almost nothing while it waits. Measured during this overhaul: load
 * average 33 on 10 cores with ~10 concurrent gate-running agents - each gate agent's own test/tsc
 * subprocesses meant one agent per core already oversubscribed the box by roughly 3x. Halving the
 * core count is the cheapest correction that measurement supports, not a tuned constant - revisit
 * against real runs, and let `gate_max_parallel` in harness.config.json override it per repo.
 */
export function deriveGateConcurrencyCeiling(cpuCount?: number): number {
  const cores = cpuCount ?? safeParallelism();
  return Math.max(1, Math.floor(cores / 2));
}
