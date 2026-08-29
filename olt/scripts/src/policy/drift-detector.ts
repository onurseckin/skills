import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { generateDefaultRepoPolicy } from "./generator/index.ts";
import { resolvePolicyLocation } from "./io-safety.ts";
import { loadRepoPolicy } from "./repo-policy.ts";
import type { RepoPolicy } from "./types/index.ts";

export interface PolicyReloadEvent {
  readonly type: "POLICY_RELOAD_EVENT";
  readonly timestamp: string;
  readonly previous_checksum: string;
  readonly new_checksum: string;
  readonly policy_path: string;
}

export interface PolicyDriftCallbacks {
  readonly onDriftDetected?: (
    newPolicy: RepoPolicy,
    oldChecksum: string,
    newChecksum: string,
  ) => Promise<void> | void;
  readonly rearmScheduler?: (newPolicy: RepoPolicy) => Promise<void> | void;
  readonly logEvent?: (event: PolicyReloadEvent) => Promise<void> | void;
}

export interface PolicyDriftResult {
  readonly drifted: boolean;
  readonly currentChecksum: string;
}

export function computePolicyChecksum(repoRoot?: string, customPath?: string): string {
  const loc = resolvePolicyLocation(repoRoot, customPath);
  if (!existsSync(loc.filePath)) {
    const fallbackPolicy = generateDefaultRepoPolicy(loc.root);
    const content = JSON.stringify(fallbackPolicy, Object.keys(fallbackPolicy).sort(), 2);
    return createHash("sha256").update(content, "utf8").digest("hex");
  }
  const rawBytes = readFileSync(loc.filePath);
  return createHash("sha256").update(rawBytes).digest("hex");
}

export function detectPolicyDrift(
  lastChecksum: string,
  repoRoot?: string,
  customPath?: string,
): PolicyDriftResult {
  const currentChecksum = computePolicyChecksum(repoRoot, customPath);
  return {
    drifted: lastChecksum !== currentChecksum,
    currentChecksum,
  };
}

export async function handlePolicyDrift(
  newPolicy: RepoPolicy,
  options: {
    readonly previousChecksum: string;
    readonly currentChecksum: string;
    readonly repoRoot?: string | undefined;
    readonly customPath?: string | undefined;
    readonly callbacks?: PolicyDriftCallbacks | undefined;
    readonly eventsLogPath?: string | undefined;
  },
): Promise<void> {
  const loc = resolvePolicyLocation(options.repoRoot, options.customPath);
  const event: PolicyReloadEvent = {
    type: "POLICY_RELOAD_EVENT",
    timestamp: new Date().toISOString(),
    previous_checksum: options.previousChecksum,
    new_checksum: options.currentChecksum,
    policy_path: loc.filePath,
  };

  if (options.callbacks?.onDriftDetected) {
    await options.callbacks.onDriftDetected(
      newPolicy,
      options.previousChecksum,
      options.currentChecksum,
    );
  }

  if (options.callbacks?.rearmScheduler) {
    await options.callbacks.rearmScheduler(newPolicy);
  }

  if (options.callbacks?.logEvent) {
    await options.callbacks.logEvent(event);
  } else {
    const eventsPath = options.eventsLogPath ?? join(loc.root, ".olt", "events.jsonl");
    const parentDir = dirname(eventsPath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true, mode: 0o700 });
    }
    appendFileSync(eventsPath, JSON.stringify(event) + "\n", "utf8");
  }
}

export async function checkAndHandlePolicyDrift(
  lastChecksum: string,
  options?: {
    readonly repoRoot?: string | undefined;
    readonly customPath?: string | undefined;
    readonly callbacks?: PolicyDriftCallbacks | undefined;
    readonly eventsLogPath?: string | undefined;
  },
): Promise<PolicyDriftResult> {
  const { drifted, currentChecksum } = detectPolicyDrift(
    lastChecksum,
    options?.repoRoot,
    options?.customPath,
  );
  if (drifted) {
    const newPolicy = loadRepoPolicy(options?.repoRoot, options?.customPath);
    await handlePolicyDrift(newPolicy, {
      previousChecksum: lastChecksum,
      currentChecksum,
      repoRoot: options?.repoRoot,
      customPath: options?.customPath,
      callbacks: options?.callbacks,
      eventsLogPath: options?.eventsLogPath,
    });
  }
  return { drifted, currentChecksum };
}
