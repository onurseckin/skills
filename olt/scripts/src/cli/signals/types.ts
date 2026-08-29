export type ProcessSignal = "SIGINT" | "SIGTERM" | "SIGHUP";

export type ShutdownHook = (signal?: ProcessSignal) => void | Promise<void>;

export interface RegisteredShutdownHook {
  readonly id: string;
  readonly hook: ShutdownHook;
  readonly priority: number;
}

export interface SignalTrapOptions {
  readonly exitOnSignal?: boolean | undefined;
  readonly timeoutMs?: number | undefined;
  readonly signals?: readonly ProcessSignal[] | undefined;
  readonly onSignalHandled?: ((signal: ProcessSignal, code: number) => void) | undefined;
}

export interface SignalTrapState {
  readonly active: boolean;
  readonly shuttingDown: boolean;
  readonly trappedSignals: readonly ProcessSignal[];
  readonly hookCount: number;
}

export const SIGNAL_EXIT_CODES: Readonly<Record<ProcessSignal, number>> = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
};
