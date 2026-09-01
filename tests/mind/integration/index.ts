/**
 * @file index.ts
 * Barrel exports for Wave 5 Mind System Integration Test Suites.
 *
 * Suites:
 * - anti-stagnation-e2e.test.ts: Multi-hour sovereign simulation and anti-stagnation loop.
 * - sovereign-lifecycle.test.ts: Single-touch startup to perpetual autonomous loop.
 * - conversational-engagement-protocols.test.ts: Mandatory 3-round Socratic laddering and 1-on-1 swarm audits.
 */

export const MIND_INTEGRATION_SUITES = [
  "anti-stagnation-e2e",
  "sovereign-lifecycle",
  "conversational-engagement-protocols",
] as const;

export type MindIntegrationSuiteName = (typeof MIND_INTEGRATION_SUITES)[number];
