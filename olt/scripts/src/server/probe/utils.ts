import { isIP } from "node:net";
import type { IpFamily } from "./types.ts";

export const DEFAULT_PROBE_TIMEOUT_MS = 200;
export const DEFAULT_PROBE_HOST = "127.0.0.1";
export const COMMON_INTERFACES: readonly string[] = ["127.0.0.1", "0.0.0.0", "::1", "::"] as const;

/**
 * Validates that a port number is a safe positive integer within the 1-65535 range.
 */
export function validatePort(port: number): void {
  if (!Number.isInteger(port)) {
    throw new RangeError(
      `Invalid port number: ${port}. Port must be an integer between 1 and 65535.`,
    );
  }
  if (port < 1) {
    throw new RangeError(
      `Invalid port number: ${port}. Port must be an integer between 1 and 65535.`,
    );
  }
  if (port > 65535) {
    throw new RangeError(
      `Invalid port number: ${port}. Port must be an integer between 1 and 65535.`,
    );
  }
}

/**
 * Normalizes a host string to a standard IP address or hostname.
 */
export function normalizeHost(host?: string | undefined): string {
  if (host === undefined) {
    return DEFAULT_PROBE_HOST;
  }
  const trimmed = host.trim();
  if (trimmed === "") {
    return DEFAULT_PROBE_HOST;
  }
  return trimmed;
}

/**
 * Determines whether a given host is an IPv6 address.
 */
export function isIpv6(host: string): boolean {
  const normalized = normalizeHost(host);
  if (normalized.includes(":")) {
    return true;
  }
  return isIP(normalized) === 6;
}

/**
 * Resolves the IP family ("IPv4" | "IPv6") for a host string.
 */
export function resolveFamily(host: string): IpFamily {
  if (isIpv6(host)) {
    return "IPv6";
  }
  return "IPv4";
}

/**
 * Splits an array into chunks of a specified size for concurrent batching.
 */
export function chunkArray<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  if (size <= 0) {
    throw new RangeError("Chunk size must be greater than 0");
  }
  const chunks: (readonly T[])[] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
