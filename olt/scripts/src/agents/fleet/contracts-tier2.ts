import type { AgentOperationalContract } from "./types.ts";
import {
  ORCHESTRATION_CONTRACTS,
  SPECIALIST_CONTRACTS,
  EXECUTION_GENERIC_CONTRACTS,
} from "./contracts/index.ts";

export const CONTRACTS_TIER_2: readonly AgentOperationalContract[] = [
  ...ORCHESTRATION_CONTRACTS,
  ...SPECIALIST_CONTRACTS,
  ...EXECUTION_GENERIC_CONTRACTS,
];

export { ORCHESTRATION_CONTRACTS, SPECIALIST_CONTRACTS, EXECUTION_GENERIC_CONTRACTS };
