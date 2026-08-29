import { existsSync } from "node:fs";
import { parseConfigFile, type ResolvedHarnessConfig } from "./index.ts";

export interface HarnessConfigFileInspection {
  readonly status: "valid_custom" | "invalid_custom" | "auto_detected";
  readonly partial: Partial<ResolvedHarnessConfig>;
  readonly filePath: string;
  readonly error?: string;
}

export function inspectHarnessConfigFile(filePath: string): HarnessConfigFileInspection {
  if (!existsSync(filePath)) {
    return {
      status: "auto_detected",
      partial: {},
      filePath,
    };
  }
  try {
    const partial = parseConfigFile(filePath);
    if (partial === null) {
      return {
        status: "auto_detected",
        partial: {},
        filePath,
      };
    }
    return {
      status: "valid_custom",
      partial,
      filePath,
    };
  } catch (error) {
    return {
      status: "invalid_custom",
      partial: {},
      filePath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
