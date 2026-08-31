export {
  createCleanTypeScriptCode,
  createSampleTaskInput,
} from "./fixture.ts";

export const PRE_ENHANCER_SUITES = [
  "pre-enhancer-core",
  "pre-enhancer-ast",
  "pre-enhancer-plan",
] as const;
