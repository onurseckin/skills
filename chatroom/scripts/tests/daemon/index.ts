export { DAEMON_HEALTH_TEST_MODULE } from "./health/index.ts";

export const daemonTestsSuite = ["health", "loop-health-persistence", "watcher"] as const;
