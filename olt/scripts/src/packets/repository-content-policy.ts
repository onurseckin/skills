import type { JsonObject } from "../core/contracts/json.ts";
import { HarnessError } from "../core/errors/harness-error.ts";

export interface RepositoryContentLimits {
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  maxListingBytes?: number;
  maxPathBytes?: number;
  maxPathDepth?: number;
}

export interface RepositoryContentScanPolicy extends JsonObject {
  schema: "harness.repository-content-scan-policy";
  version: 1;
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxListingBytes: number;
  maxPathBytes: number;
  maxPathDepth: number;
}

export const DEFAULT_REPOSITORY_CONTENT_POLICY: Readonly<RepositoryContentScanPolicy> =
  Object.freeze({
    schema: "harness.repository-content-scan-policy",
    version: 1,
    maxFiles: 50_000,
    maxFileBytes: 64 * 1024 * 1024,
    maxTotalBytes: 256 * 1024 * 1024,
    maxListingBytes: 8 * 1024 * 1024,
    maxPathBytes: 4096,
    maxPathDepth: 128,
  });

function positive(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1)
    throw new HarnessError("INVALID_ARGUMENT", `${name} must be a positive integer`);
  return resolved;
}

export function resolveRepositoryContentPolicy(
  limits: RepositoryContentLimits,
): RepositoryContentScanPolicy {
  return {
    schema: "harness.repository-content-scan-policy",
    version: 1,
    maxFiles: positive(limits.maxFiles, DEFAULT_REPOSITORY_CONTENT_POLICY.maxFiles, "maxFiles"),
    maxFileBytes: positive(
      limits.maxFileBytes,
      DEFAULT_REPOSITORY_CONTENT_POLICY.maxFileBytes,
      "maxFileBytes",
    ),
    maxTotalBytes: positive(
      limits.maxTotalBytes,
      DEFAULT_REPOSITORY_CONTENT_POLICY.maxTotalBytes,
      "maxTotalBytes",
    ),
    maxListingBytes: positive(
      limits.maxListingBytes,
      DEFAULT_REPOSITORY_CONTENT_POLICY.maxListingBytes,
      "maxListingBytes",
    ),
    maxPathBytes: positive(
      limits.maxPathBytes,
      DEFAULT_REPOSITORY_CONTENT_POLICY.maxPathBytes,
      "maxPathBytes",
    ),
    maxPathDepth: positive(
      limits.maxPathDepth,
      DEFAULT_REPOSITORY_CONTENT_POLICY.maxPathDepth,
      "maxPathDepth",
    ),
  };
}

export function validateRepositoryContentPath(
  path: string,
  policy: Readonly<RepositoryContentScanPolicy>,
): string {
  if (
    path === "" ||
    path.includes("\0") ||
    path.includes("\\") ||
    path.startsWith("/") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  )
    throw new HarnessError("INTEGRITY", `repository listing contains an unsafe path: ${path}`);
  if (Buffer.byteLength(path, "utf8") > policy.maxPathBytes)
    throw new HarnessError("INTEGRITY", `repository content path byte limit exceeded: ${path}`);
  if (path.split("/").length > policy.maxPathDepth)
    throw new HarnessError("INTEGRITY", `repository content path depth limit exceeded: ${path}`);
  return path;
}

export function decodeRepositoryContentPath(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new HarnessError("INTEGRITY", `repository content path is not UTF-8: ${String(error)}`);
  }
}
