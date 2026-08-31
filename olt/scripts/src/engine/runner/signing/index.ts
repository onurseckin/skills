export { captureGateEnvironment, gateEnvironmentIssues } from "./gate-environment.ts";

export { TRUSTED_HOST_ASSURANCE, sameRepositoryObservation } from "./gate-observation.ts";

export {
  assertGatePathBindings,
  executionArgv,
  gatePathBindingIssues,
  inside,
  portableRelative,
  resolvePathExecutable,
} from "./gate-path-binding-verify.ts";

export { captureGatePathBindings } from "./gate-path-bindings.ts";

export {
  MAX_DIGEST_WORK_BYTES,
  MAX_FILE_BYTES,
  MAX_GATE_PATH_BINDINGS,
  MAX_TREE_BYTES,
  MAX_TREE_ENTRIES,
  createGateCaptureBudget,
  digestFile,
  metadata,
  openGatePath,
  type GateCaptureBudget,
  type GatePathHooks,
} from "./gate-path-file.ts";

export { configOperand, pathOperand, pathRole } from "./gate-path-operands.ts";

export {
  gateControlBindingScopeIssues,
  gateControlBindingsOverlapWriteScopes,
} from "./gate-path-overlap.ts";

export { captureOpenedPath } from "./gate-path-tree.ts";

export {
  embeddedCommandIssues,
  verifyCommandAttempt,
  verifyCommandRecord,
} from "./verify-command.ts";
