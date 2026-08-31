import { createServer } from "node:net";
import type {
  ComprehensivePortStatus,
  ConflictDetectionOptions,
  SocketConflictResult,
} from "./types.ts";
import {
  COMMON_INTERFACES,
  DEFAULT_PROBE_HOST,
  normalizeHost,
  resolveFamily,
  validatePort,
} from "./utils.ts";
import { probeAllInterfaces } from "./tcp-probe.ts";

/**
 * Detects socket binding conflicts by attempting to bind a server socket to the port.
 *
 * @param port - The port number to test (1-65535).
 * @param options - Options including the target host.
 * @returns Structured result indicating whether the socket is available, occupied (EADDRINUSE), or blocked.
 */
export function detectSocketConflict(
  port: number,
  options?: ConflictDetectionOptions | undefined,
): Promise<SocketConflictResult> {
  validatePort(port);

  const rawHost = options !== undefined ? options.host : undefined;
  const host = normalizeHost(rawHost);
  const family = resolveFamily(host);

  return new Promise<SocketConflictResult>((resolve) => {
    const server = createServer();
    let settled = false;

    const cleanup = (): void => {
      server.removeAllListeners();
    };

    server.once("listening", () => {
      if (settled) return;
      settled = true;
      cleanup();
      server.close(() => {
        resolve({
          port,
          address: host,
          family,
          status: "available",
          inUse: false,
          available: true,
        });
      });
    });

    server.once("error", (err: Error & { code?: string | undefined }) => {
      if (settled) return;
      settled = true;
      cleanup();

      const code = typeof err.code === "string" ? err.code : "";
      if (code === "EADDRINUSE") {
        resolve({
          port,
          address: host,
          family,
          status: "occupied",
          inUse: true,
          available: false,
          error: `Port ${port} on ${host} is already in use (EADDRINUSE)`,
        });
        return;
      }

      if (code === "EACCES") {
        resolve({
          port,
          address: host,
          family,
          status: "blocked",
          inUse: false,
          available: false,
          error: `Permission denied to bind port ${port} on ${host} (EACCES)`,
        });
        return;
      }

      let errorMessage: string;
      if (err.message.length > 0) {
        errorMessage = err.message;
      } else if (code.length > 0) {
        errorMessage = code;
      } else {
        errorMessage = "Unknown binding error";
      }

      resolve({
        port,
        address: host,
        family,
        status: "error",
        inUse: false,
        available: false,
        error: errorMessage,
      });
    });

    try {
      server.listen({ port, host, exclusive: true });
    } catch (err: unknown) {
      if (settled) return;
      settled = true;
      cleanup();
      const message = err instanceof Error ? err.message : String(err);
      resolve({
        port,
        address: host,
        family,
        status: "error",
        inUse: false,
        available: false,
        error: message,
      });
    }
  });
}

/**
 * Checks whether a given port is available for binding on the host.
 */
export async function checkPortAvailability(
  port: number,
  host?: string | undefined,
): Promise<boolean> {
  const options: ConflictDetectionOptions | undefined = host !== undefined ? { host } : undefined;
  const result = await detectSocketConflict(port, options);
  return result.available;
}

/**
 * Finds the first available port starting from `startPort` up to `endPort`.
 *
 * @param startPort - Initial port to check (default: 3000).
 * @param endPort - Upper bound port to check (default: 65535).
 * @param options - Additional conflict detection options.
 * @returns The first available port number found.
 */
export async function findAvailablePort(
  startPort = 3000,
  endPort = 65535,
  options?: ConflictDetectionOptions | undefined,
): Promise<number> {
  validatePort(startPort);
  validatePort(endPort);

  if (startPort > endPort) {
    throw new RangeError(`startPort (${startPort}) cannot be greater than endPort (${endPort})`);
  }

  const targetHost = options !== undefined ? options.host : undefined;

  for (let port = startPort; port <= endPort; port++) {
    const isAvailable = await checkPortAvailability(port, targetHost);
    if (isAvailable) {
      return port;
    }
  }

  const hostDisplay = targetHost !== undefined ? targetHost : DEFAULT_PROBE_HOST;
  throw new Error(
    `No available ports found in range ${startPort}-${endPort} on host ${hostDisplay}`,
  );
}

/**
 * Checks binding conflicts across common network interfaces (IPv4 and IPv6).
 */
export async function detectInterfaceConflicts(
  port: number,
): Promise<readonly SocketConflictResult[]> {
  return await Promise.all(COMMON_INTERFACES.map((host) => detectSocketConflict(port, { host })));
}

/**
 * Performs a comprehensive multi-interface inspection including both TCP probe
 * and socket binding conflict detection.
 */
export async function inspectComprehensivePort(port: number): Promise<ComprehensivePortStatus> {
  const [probeResults, conflictResults] = await Promise.all([
    probeAllInterfaces(port),
    detectInterfaceConflicts(port),
  ]);

  const anyProbeInUse = probeResults.some((r) => r.inUse);
  const anyConflictInUse = conflictResults.some((c) => c.inUse);
  let inUse = false;
  if (anyProbeInUse) {
    inUse = true;
  } else if (anyConflictInUse) {
    inUse = true;
  }

  const available = conflictResults.every((c) => c.available);

  return {
    port,
    inUse,
    available,
    probeResults,
    conflictResults,
  };
}
