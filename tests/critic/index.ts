/**
 * @file index.ts
 * Root Facade for Critic domain
 */

export { CRITIC_FIXTURES_SUITES, scratchRoot, createSandboxDir } from "./fixtures/index.ts";
export { CRITIC_SYNTHESIS_SUITES } from "./synthesis/index.ts";
export { CRITIC_EVALUATION_SUITES } from "./evaluation/index.ts";
export { CRITIC_VALIDATION_SUITES } from "./validation/index.ts";

export const CRITIC_DOMAINS = ["fixtures", "synthesis", "evaluation", "validation"] as const;
