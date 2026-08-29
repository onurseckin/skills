export {
  assertZeroTypescriptAny,
  scanSourceCodeForTypescriptAny,
  scanFileForTypescriptAny,
  scanDirectoryForTypescriptAny,
  collectTypescriptFiles,
  isTypeSafetyViolation,
  isTypeSafetyScanResult,
  type TypeSafetyViolation,
  type TypeSafetyScanResult,
  type TypeSafetyScanOptions,
} from "./scanner.ts";
