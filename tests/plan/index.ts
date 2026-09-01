import { PRE_ENHANCER_SUITES } from "./pre-enhancer/index.ts";
import { REPLAN_SUITES } from "./replan/index.ts";
import { ANALYSIS_SUITES } from "./analysis/index.ts";

export {
  SCRATCH_BASE,
  setupVirtualPlanFS,
  cleanupVirtualPlanFS,
  getVirtualPlanFS,
  scratchRoot,
  createSandboxDir,
  createInMemoryPreEnhancedTask,
  createInMemoryPlanFinding,
  createInMemoryScopePair,
} from "./plan-fixture.ts";

export {
  createCleanTypeScriptCode,
  createSampleTaskInput,
  PRE_ENHANCER_SUITES,
} from "./pre-enhancer/index.ts";

export { createSampleFinding, createSampleOpenTaskFinding, REPLAN_SUITES } from "./replan/index.ts";

export { createSampleScopePair, ANALYSIS_SUITES } from "./analysis/index.ts";

export const PLAN_DOMAIN_SUITES = {
  preEnhancer: PRE_ENHANCER_SUITES,
  replan: REPLAN_SUITES,
  analysis: ANALYSIS_SUITES,
} as const;
