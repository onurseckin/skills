export const LIAISON_PROTOCOL_TEST_SUITES = [
  "receipts",
  "expectations",
  "telemetry",
  "errors",
  "handshake",
] as const;

export type LiaisonProtocolTestSuite = (typeof LIAISON_PROTOCOL_TEST_SUITES)[number];
