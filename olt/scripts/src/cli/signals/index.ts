export type {
  ProcessSignal,
  RegisteredShutdownHook,
  ShutdownHook,
  SignalTrapOptions,
  SignalTrapState,
} from "./types.ts";

export { SIGNAL_EXIT_CODES } from "./types.ts";

export {
  ShutdownRegistry,
  clearShutdownHooks,
  getShutdownHookCount,
  registerShutdownHook,
  runShutdownHooks,
} from "./shutdown-registry.ts";

export {
  SignalTrapManager,
  getSignalTrapState,
  setupSignalTraps,
  teardownSignalTraps,
  withSignalTrap,
} from "./signal-trap.ts";

export {
  formatCliError,
  mapErrorToExitCode,
  propagateCliExitCode,
} from "./error-propagation.ts";
