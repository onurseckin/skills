export { ADMISSION_GATES_SUITES } from "./gates/index.ts";
export { ADMISSION_NEGATIVE_SUITES } from "./negative/index.ts";
export const FEEDBACK_ADMISSION_SUITES = ["gates", "negative", "anti-batching"] as const;
