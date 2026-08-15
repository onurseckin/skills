import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_REPAIR_ROUNDS, MIN_ADVERSARIAL_REJECTIONS } from "./constants.ts";

export interface HarnessConfig {
  min_adversarial_rejections: number;
  max_repair_rounds: number;
  max_output_bytes: number;
  default_lease_seconds: number;
  default_max_parallel: number;
  strict_validation: boolean;
}

export const DEFAULT_CONFIG: HarnessConfig = {
  min_adversarial_rejections: MIN_ADVERSARIAL_REJECTIONS,
  max_repair_rounds: MAX_REPAIR_ROUNDS,
  max_output_bytes: 10 * 1024 * 1024,
  default_lease_seconds: 1800,
  default_max_parallel: 4,
  strict_validation: true,
};

function parseConfigFile(filePath: string): Partial<HarnessConfig> | null {
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const partial: Partial<HarnessConfig> = {};

    if (
      typeof record.min_adversarial_rejections === "number" &&
      Number.isInteger(record.min_adversarial_rejections) &&
      record.min_adversarial_rejections >= 0
    ) {
      partial.min_adversarial_rejections = record.min_adversarial_rejections;
    }

    if (
      typeof record.max_repair_rounds === "number" &&
      Number.isInteger(record.max_repair_rounds) &&
      record.max_repair_rounds >= 1
    ) {
      partial.max_repair_rounds = record.max_repair_rounds;
    }

    if (
      typeof record.max_output_bytes === "number" &&
      Number.isInteger(record.max_output_bytes) &&
      record.max_output_bytes >= 1024
    ) {
      partial.max_output_bytes = record.max_output_bytes;
    }

    if (
      typeof record.default_lease_seconds === "number" &&
      Number.isInteger(record.default_lease_seconds) &&
      record.default_lease_seconds >= 5 &&
      record.default_lease_seconds <= 86_400
    ) {
      partial.default_lease_seconds = record.default_lease_seconds;
    }

    if (
      typeof record.default_max_parallel === "number" &&
      Number.isInteger(record.default_max_parallel) &&
      record.default_max_parallel >= 1
    ) {
      partial.default_max_parallel = record.default_max_parallel;
    }

    if (typeof record.strict_validation === "boolean") {
      partial.strict_validation = record.strict_validation;
    }

    return partial;
  } catch {
    return null;
  }
}

export function loadHarnessConfig(repoRoot?: string, capsuleRoot?: string): HarnessConfig {
  const root = repoRoot ?? process.cwd();
  let repoConfig: Partial<HarnessConfig> | null = null;
  const standardRepo = join(root, "harness.config.json");
  const dotRepo = join(root, ".harness.config.json");

  if (existsSync(standardRepo)) {
    repoConfig = parseConfigFile(standardRepo);
  } else if (existsSync(dotRepo)) {
    repoConfig = parseConfigFile(dotRepo);
  }

  let capsuleConfig: Partial<HarnessConfig> | null = null;
  if (capsuleRoot) {
    const standardCap = join(capsuleRoot, "config.json");
    const harnessCap = join(capsuleRoot, "harness.config.json");
    if (existsSync(standardCap)) {
      capsuleConfig = parseConfigFile(standardCap);
    } else if (existsSync(harnessCap)) {
      capsuleConfig = parseConfigFile(harnessCap);
    }
  }

  return {
    ...DEFAULT_CONFIG,
    ...(capsuleConfig ?? {}),
    ...(repoConfig ?? {}),
  };
}
