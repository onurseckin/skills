import { HarnessError } from "../core/errors/index.ts";

export function readOwnDataString(error: unknown, property: string): string | null {
  if (error === null || (typeof error !== "object" && typeof error !== "function")) {
    return null;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, property);
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") {
      return null;
    }
    return descriptor.value;
  } catch {
    return null;
  }
}

export function hasOwnFilesystemCode(error: unknown, code: string): boolean {
  try {
    return error instanceof Error && readOwnDataString(error, "code") === code;
  } catch {
    return false;
  }
}

export function isTrustedIntegrityError(error: unknown): error is HarnessError {
  try {
    return error instanceof HarnessError && readOwnDataString(error, "code") === "INTEGRITY";
  } catch {
    return false;
  }
}

export function formatSafeErrorCause(error: unknown): string {
  return readOwnDataString(error, "message") ?? "unknown error";
}

export function throwDefectLogIntegrityError(
  operation: string,
  filePath: string,
  error: unknown,
): never {
  if (isTrustedIntegrityError(error)) {
    throw error;
  }
  throw new HarnessError(
    "INTEGRITY",
    `failed to ${operation} defect log at '${filePath}': ${formatSafeErrorCause(error)}`,
  );
}
