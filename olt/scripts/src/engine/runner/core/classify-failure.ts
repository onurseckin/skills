import type { FailureClass } from "../types/types";

const TRANSIENT = [
  /connection (?:reset|refused)/i,
  /dns/i,
  /eai_again/i,
  /enotfound/i,
  /network is unreachable/i,
  /service unavailable/i,
  /temporary failure/i,
];
const AUTH = [/401\b/, /403\b/, /authentication/i, /permission denied/i, /unauthorized/i];
const TEST = [
  /\bassertionerror\b/i,
  /\btests? failed\b/i,
  /\bcompiler errors?\b/i,
  /\berror TS\d+:/i,
  /\btypecheck failed\b/i,
];

export interface FailureSignals {
  authorization: boolean;
  networkTransient: boolean;
  testFailure: boolean;
}

export function inspectFailureText(text: string): FailureSignals {
  return {
    authorization: AUTH.some((pattern) => pattern.test(text)),
    testFailure: TEST.some((pattern) => pattern.test(text)),
    networkTransient: TRANSIENT.some((pattern) => pattern.test(text)),
  };
}

export function classifySignals(
  exitCode: null | number,
  signals: FailureSignals,
  timedOut: null | "idle" | "wall",
  hostInterrupted = false,
): FailureClass | undefined {
  if (exitCode === 0 && timedOut === null && !hostInterrupted) return undefined;
  if (timedOut) return "timeout";
  if (signals.authorization) return "authorization";
  if (signals.testFailure) return "test_failure";
  if (hostInterrupted) return "host_interruption";
  if (signals.networkTransient) return "network_transient";
  return "unknown";
}
