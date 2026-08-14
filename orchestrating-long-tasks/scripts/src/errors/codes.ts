export const ERROR_CODES = [
  "INTEGRITY",
  "INVALID_ARGUMENT",
  "INVALID_STATE",
  "LOCK_TIMEOUT",
  "NOT_IMPLEMENTED",
  "PATH_SAFETY",
  "UNSUPPORTED_PLATFORM",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
