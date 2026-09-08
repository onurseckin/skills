export { behavioralHealthSetupSuiteName } from "./behavioral-health-setup.test.ts";
export { behavioralHealthCoreSuiteName } from "./behavioral-health-core.test.ts";
export { behavioralHealthEdgeSuiteName } from "./behavioral-health-edge.test.ts";
export { capsuleRootSuiteName } from "./capsule-root.test.ts";
export { doctorSuiteName } from "./doctor.test.ts";
export { doctorUnifiedSuiteName } from "./doctor-unified.test.ts";
export { socraticValidatorSuiteName } from "./socratic-validator.test.ts";
export { statusDoctorGapsSuiteName } from "./status-doctor-gaps.test.ts";
export { planQualityEngineSuiteName } from "./plan-quality-engine.test.ts";
export { suiteName as roleBoundaryShellSuiteName } from "./role-boundary-shell.test.ts";
export {
  engineVerdictsPlanningSuiteName,
  engineVerdictsBoundarySuiteName,
  engineVerdictsWorkspaceSuiteName,
} from "./verdicts/index.ts";
export { engineWiringSuiteName, engineWiringPredicateSuiteName } from "./wiring/index.ts";

export const REPORTING_DOCTOR_SUITES = [
  "tier-confinement",
  "rules-socratic",
  "pre-completion",
  "planning-dag-engine",
  "state-machine",
  "lock-cleaner",
  "anti-stagnation",
  "check-runner",
  "doctor-companion-auditors",
  "adversarial-diagnostics",
] as const;
