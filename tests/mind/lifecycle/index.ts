export { LIFECYCLE_DEPLOY_SUITES } from "./deploy/index.ts";
export { LIFECYCLE_PURPOSE_SUITES } from "./purpose/index.ts";
export { LIFECYCLE_PULSE_SUITES } from "./pulse/index.ts";
export { LIFECYCLE_LIVENESS_SUITES } from "./liveness/index.ts";
export { LIFECYCLE_INIT_SUITES } from "./init/index.ts";

export const LIFECYCLE_DOMAINS = ["deploy", "purpose", "pulse", "liveness", "init"] as const;
