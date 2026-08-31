export { createTestDefect, createTestEventPayload } from "./fixture.ts";

export const STORE_SUITES = [
  "store",
  "capsule-init",
  "capsule-full",
  "hierarchy-full",
  "content-normalization-full",
  "events-full",
  "defect-store",
  "projections-recovery-integrity-layout",
] as const;
