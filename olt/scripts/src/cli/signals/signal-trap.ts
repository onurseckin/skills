import { runShutdownHooks } from "./shutdown-registry.ts";
import {
  SIGNAL_EXIT_CODES,
  type ProcessSignal,
  type SignalTrapOptions,
  type SignalTrapState,
} from "./types.ts";

export class SignalTrapManager {
  private static instance: SignalTrapManager | null = null;
  private isTrapping = false;
  private isShuttingDown = false;
  private readonly boundHandlers = new Map<ProcessSignal, () => void>();
  private readonly defaultSignals: readonly ProcessSignal[] = ["SIGINT", "SIGTERM", "SIGHUP"];

  public static getInstance(): SignalTrapManager {
    if (!SignalTrapManager.instance) {
      SignalTrapManager.instance = new SignalTrapManager();
    }
    return SignalTrapManager.instance;
  }

  public static resetInstance(): void {
    if (SignalTrapManager.instance) {
      SignalTrapManager.instance.teardown();
      SignalTrapManager.instance = null;
    }
  }

  public setup(options: SignalTrapOptions = {}): () => void {
    if (this.isTrapping) return () => this.teardown();
    this.isTrapping = true;
    this.isShuttingDown = false;

    const signalsToTrap = options.signals ?? this.defaultSignals;
    const shouldExit = options.exitOnSignal ?? true;

    for (const sig of signalsToTrap) {
      const handler = () => {
        void this.handleSignal(sig, shouldExit, options);
      };
      this.boundHandlers.set(sig, handler);
      process.once(sig, handler);
    }

    return () => this.teardown();
  }

  public async handleSignal(
    signal: ProcessSignal,
    shouldExit: boolean,
    options: SignalTrapOptions = {},
  ): Promise<number> {
    if (this.isShuttingDown) return SIGNAL_EXIT_CODES[signal] ?? 128;
    this.isShuttingDown = true;

    const exitCode = SIGNAL_EXIT_CODES[signal] ?? 128;

    const timeout = options.timeoutMs ?? 5000;
    const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, timeout));
    const shutdownPromise = runShutdownHooks(signal);

    await Promise.race([shutdownPromise, timeoutPromise]);

    if (options.onSignalHandled) {
      options.onSignalHandled(signal, exitCode);
    }

    if (shouldExit && process.exitCode === undefined) {
      process.exitCode = exitCode;
      process.exit(exitCode);
    }

    return exitCode;
  }

  public teardown(): void {
    for (const [sig, handler] of this.boundHandlers.entries()) {
      process.off(sig, handler);
    }
    this.boundHandlers.clear();
    this.isTrapping = false;
    this.isShuttingDown = false;
  }

  public getState(): SignalTrapState {
    return {
      active: this.isTrapping,
      shuttingDown: this.isShuttingDown,
      trappedSignals: Array.from(this.boundHandlers.keys()),
      hookCount: this.boundHandlers.size,
    };
  }
}

export function setupSignalTraps(options: SignalTrapOptions = {}): () => void {
  return SignalTrapManager.getInstance().setup(options);
}

export function teardownSignalTraps(): void {
  SignalTrapManager.getInstance().teardown();
}

export function getSignalTrapState(): SignalTrapState {
  return SignalTrapManager.getInstance().getState();
}

export async function withSignalTrap<T>(
  action: () => Promise<T>,
  cleanup?: () => void | Promise<void>,
): Promise<T> {
  const cleanupRegistered = cleanup
    ? (await import("./shutdown-registry.ts")).registerShutdownHook(cleanup)
    : undefined;
  const teardown = setupSignalTraps({ exitOnSignal: false });

  try {
    return await action();
  } finally {
    if (cleanupRegistered) cleanupRegistered();
    teardown();
  }
}
