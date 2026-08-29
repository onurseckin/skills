import { HarnessError } from "../errors/harness-error.ts";
import type { HostProvider } from "../../platform/host/types.ts";
import { HOST_PROVIDERS, isHostProvider } from "../../platform/host/types.ts";
import type { ExternallyAttestedFact } from "./provenance.ts";
import { attestedFact, unattestedFact, unreadableFact } from "./provenance.ts";

export type CanonicalHost = HostProvider;

export const CANONICAL_HOSTS: readonly CanonicalHost[] = HOST_PROVIDERS;

const HOST_ID_ALIASES: Readonly<Record<string, CanonicalHost>> = {
  antigravity: "antigravity",
  "claude-code": "claude-code",
  claude: "claude-code",
  cursor: "cursor",
  codex: "codex",
  chatgpt: "chatgpt",
};

export const KNOWN_UNRESOLVABLE_HOST_IDS = [
  "generic",
  "openai",
  "initialization",
  "custom",
] as const;

export type KnownUnresolvableHostId = (typeof KNOWN_UNRESOLVABLE_HOST_IDS)[number];

function isKnownUnresolvableHostId(value: string): value is KnownUnresolvableHostId {
  return (KNOWN_UNRESOLVABLE_HOST_IDS as readonly string[]).includes(value);
}

export type HostCanonicalizationOutcome =
  | { readonly kind: "resolved"; readonly host: CanonicalHost }
  | { readonly kind: "known_unresolvable"; readonly rawId: KnownUnresolvableHostId }
  | { readonly kind: "unrecognized"; readonly rawId: string }
  | { readonly kind: "absent" };

export function canonicalizeHostId(
  rawHostId: string | null | undefined,
): HostCanonicalizationOutcome {
  if (typeof rawHostId !== "string" || rawHostId.trim().length === 0) {
    return { kind: "absent" };
  }
  const normalized = rawHostId.trim();
  if (isHostProvider(normalized)) {
    return { kind: "resolved", host: normalized };
  }
  const alias = HOST_ID_ALIASES[normalized];
  if (alias !== undefined) {
    return { kind: "resolved", host: alias };
  }
  if (isKnownUnresolvableHostId(normalized)) {
    return { kind: "known_unresolvable", rawId: normalized };
  }
  return { kind: "unrecognized", rawId: normalized };
}

export function resolveHostProviderLoose(
  rawHost: string | null | undefined,
): CanonicalHost | "unknown" {
  if (typeof rawHost !== "string" || rawHost.trim().length === 0) {
    return "unknown";
  }
  const normalized = rawHost.trim().toLowerCase();
  if (isHostProvider(normalized)) {
    return normalized;
  }
  const alias = HOST_ID_ALIASES[normalized];
  if (alias !== undefined) {
    return alias;
  }
  if (normalized.includes("claude") || normalized.includes("anthropic")) {
    return "claude-code";
  }
  if (normalized.includes("cursor")) {
    return "cursor";
  }
  if (normalized.includes("codex")) {
    return "codex";
  }
  if (
    normalized.includes("chatgpt") ||
    normalized.includes("gpt") ||
    normalized.includes("openai")
  ) {
    return "chatgpt";
  }
  if (normalized.includes("antigravity") || normalized.includes("gemini")) {
    return "antigravity";
  }
  return "unknown";
}

export function canonicalHostFromOutcome(
  outcome: HostCanonicalizationOutcome,
): ExternallyAttestedFact<CanonicalHost | null> {
  if (outcome.kind === "resolved") {
    return attestedFact<CanonicalHost | null>(outcome.host);
  }
  if (outcome.kind === "absent") {
    return unattestedFact<CanonicalHost | null>(null);
  }
  return unreadableFact<CanonicalHost | null>(null);
}

export type TimerArmingMechanism = "host_scheduler" | "systemd" | "bash_floor_loop" | "none";

export const TIMER_ARMING_MECHANISMS: readonly TimerArmingMechanism[] = [
  "host_scheduler",
  "systemd",
  "bash_floor_loop",
  "none",
];

export function isTimerArmingMechanism(value: unknown): value is TimerArmingMechanism {
  return (
    typeof value === "string" && (TIMER_ARMING_MECHANISMS as readonly string[]).includes(value)
  );
}

export interface HostProfile {
  readonly timer_arming_mechanism: ExternallyAttestedFact<TimerArmingMechanism>;
  readonly wake_driver_present: ExternallyAttestedFact<boolean>;
  readonly self_wake_supported: ExternallyAttestedFact<boolean>;
  readonly models_available: ExternallyAttestedFact<readonly string[]>;
}

function attestOptionalMechanism(raw: unknown): ExternallyAttestedFact<TimerArmingMechanism> {
  if (raw === undefined) return unattestedFact<TimerArmingMechanism>("none");
  if (isTimerArmingMechanism(raw)) return attestedFact(raw);
  return unreadableFact<TimerArmingMechanism>("none");
}

function attestOptionalBoolean(raw: unknown): ExternallyAttestedFact<boolean> {
  if (raw === undefined) return unattestedFact(false);
  if (typeof raw === "boolean") return attestedFact(raw);
  return unreadableFact(false);
}

function attestOptionalModelsAvailable(raw: unknown): ExternallyAttestedFact<readonly string[]> {
  if (raw === undefined) return unattestedFact<readonly string[]>([]);
  if (Array.isArray(raw)) {
    return attestedFact(raw.filter((entry): entry is string => typeof entry === "string"));
  }
  return unreadableFact<readonly string[]>([]);
}

function parseHostProfileEntry(raw: unknown): HostProfile | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  return {
    timer_arming_mechanism: attestOptionalMechanism(record.timer_arming_mechanism),
    wake_driver_present: attestOptionalBoolean(record.wake_driver_present),
    self_wake_supported: attestOptionalBoolean(record.self_wake_supported),
    models_available: attestOptionalModelsAvailable(record.models_available),
  };
}

export function parseHostProfiles(
  raw: unknown,
  sourceFilePath: string,
): Partial<Record<CanonicalHost, HostProfile>> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  const result: Partial<Record<CanonicalHost, HostProfile>> = {};
  for (const [rawHostId, rawProfile] of Object.entries(record)) {
    const outcome = canonicalizeHostId(rawHostId);
    if (outcome.kind !== "resolved") {
      throw new HarnessError(
        "INVALID_STATE",
        `host_profiles in ${sourceFilePath} keys an entry on '${rawHostId}', which does not canonicalize to a known host provider (${outcome.kind}); refusing rather than silently dropping this profile`,
      );
    }
    const profile = parseHostProfileEntry(rawProfile);
    if (profile !== null) {
      result[outcome.host] = profile;
    }
  }
  return result;
}
