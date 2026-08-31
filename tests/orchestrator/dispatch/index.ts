export { createSampleDispatchLogEvent } from "./fixture.ts";

export const DISPATCH_SUITES = [
  "capsule-chainer",
  "decision-policy",
  "dispatch-log",
  "dispatch-selection",
  "executor-required",
  "host-schedulers",
  "turn1",
] as const;
