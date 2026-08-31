import { Socket } from "node:net";
import type { MultiProbeOptions, ProbeOptions, TcpProbeResult } from "./types.ts";
import {
  chunkArray,
  COMMON_INTERFACES,
  DEFAULT_PROBE_TIMEOUT_MS,
  normalizeHost,
  resolveFamily,
  validatePort,
} from "./utils.ts";

/**
 * High-speed non-blocking TCP port probe that attempts a connection to detect
 * whether a port is currently open and actively listening.
 *
 * @param port - Port number to probe (1-65535).
 * @param options - Configuration options including host and timeout in milliseconds.
 * @returns Structured probe results containing occupancy status, latency, and diagnostics.
 */
export function probeTcpPort(
  port: number,
  options?: ProbeOptions | undefined,
): Promise<TcpProbeResult> {
  validatePort(port);

  const rawHost = options !== undefined ? options.host : undefined;
  const host = normalizeHost(rawHost);
  const timeoutMs =
    options !== undefined && options.timeoutMs !== undefined
      ? options.timeoutMs
      : DEFAULT_PROBE_TIMEOUT_MS;
  const family = resolveFamily(host);

  return new Promise<TcpProbeResult>((resolve) => {
    const socket = new Socket();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = performance.now();

    const cleanup = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      socket.removeAllListeners();
      socket.destroy();
      socket.unref();
    };

    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const latencyMs = Math.round(performance.now() - start);
      cleanup();
      resolve({
        port,
        inUse: false,
        address: host,
        family,
        latencyMs,
        status: "timeout",
        error: `Connection timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    if (typeof timer.unref === "function") {
      timer.unref();
    }

    socket.once("connect", () => {
      if (settled) return;
      settled = true;
      const latencyMs = Math.round(performance.now() - start);
      cleanup();
      resolve({
        port,
        inUse: true,
        address: host,
        family,
        latencyMs,
        status: "listening",
      });
    });

    socket.once("error", (err: Error & { code?: string | undefined }) => {
      if (settled) return;
      settled = true;
      const latencyMs = Math.round(performance.now() - start);
      cleanup();

      const code = typeof err.code === "string" ? err.code : "";
      if (code === "ECONNREFUSED") {
        resolve({
          port,
          inUse: false,
          address: host,
          family,
          latencyMs,
          status: "refused",
        });
        return;
      }

      if (code === "ETIMEDOUT") {
        resolve({
          port,
          inUse: false,
          address: host,
          family,
          latencyMs,
          status: "timeout",
          error: err.message,
        });
        return;
      }

      let errorMessage: string;
      if (err.message.length > 0) {
        errorMessage = err.message;
      } else if (code.length > 0) {
        errorMessage = code;
      } else {
        errorMessage = "Unknown connection error";
      }

      resolve({
        port,
        inUse: false,
        address: host,
        family,
        latencyMs,
        status: "error",
        error: errorMessage,
      });
    });

    try {
      socket.connect({ port, host });
    } catch (err: unknown) {
      if (settled) return;
      settled = true;
      const latencyMs = Math.round(performance.now() - start);
      cleanup();
      const message = err instanceof Error ? err.message : String(err);
      resolve({
        port,
        inUse: false,
        address: host,
        family,
        latencyMs,
        status: "error",
        error: message,
      });
    }
  });
}

/**
 * Checks if a specific port is in use on the target host.
 */
export async function isPortInUse(
  port: number,
  optionsOrHost?: ProbeOptions | string | undefined,
): Promise<boolean> {
  let options: ProbeOptions | undefined;
  if (typeof optionsOrHost === "string") {
    options = { host: optionsOrHost };
  } else {
    options = optionsOrHost;
  }
  const result = await probeTcpPort(port, options);
  return result.inUse;
}

/**
 * Probes multiple ports concurrently with batched concurrency control.
 */
export async function probePorts(
  ports: readonly number[],
  options?: MultiProbeOptions | undefined,
): Promise<readonly TcpProbeResult[]> {
  const concurrency =
    options !== undefined && options.concurrency !== undefined ? options.concurrency : 50;
  const chunks = chunkArray(ports, concurrency);
  const results: TcpProbeResult[] = [];

  for (const chunk of chunks) {
    const chunkResults = await Promise.all(chunk.map((port) => probeTcpPort(port, options)));
    for (const r of chunkResults) {
      results.push(r);
    }
  }

  return results;
}

/**
 * Probes all common loopback and bind interfaces (IPv4 127.0.0.1, 0.0.0.0 and IPv6 ::1, ::) for a given port.
 */
export async function probeAllInterfaces(
  port: number,
  options?: Omit<ProbeOptions, "host"> | undefined,
): Promise<readonly TcpProbeResult[]> {
  const baseTimeout =
    options !== undefined && options.timeoutMs !== undefined ? options.timeoutMs : undefined;

  return await Promise.all(
    COMMON_INTERFACES.map((host) => {
      const probeOpts: ProbeOptions =
        baseTimeout !== undefined ? { host, timeoutMs: baseTimeout } : { host };
      return probeTcpPort(port, probeOpts);
    }),
  );
}

/**
 * Probes both IPv4 (127.0.0.1) and IPv6 (::1) loopback addresses for a given port.
 */
export async function probeAddressFamilies(
  port: number,
  options?: ProbeOptions | undefined,
): Promise<{ readonly ipv4: TcpProbeResult; readonly ipv6: TcpProbeResult }> {
  const baseTimeout =
    options !== undefined && options.timeoutMs !== undefined ? options.timeoutMs : undefined;

  const buildOpts = (host: string): ProbeOptions => {
    if (baseTimeout !== undefined) {
      return { host, timeoutMs: baseTimeout };
    }
    return { host };
  };

  const [ipv4, ipv6] = await Promise.all([
    probeTcpPort(port, buildOpts("127.0.0.1")),
    probeTcpPort(port, buildOpts("::1")),
  ]);
  return { ipv4, ipv6 };
}
