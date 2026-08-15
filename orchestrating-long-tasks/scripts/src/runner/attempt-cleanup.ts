import type { ActivityRecord } from "./activity-record.ts";
import {
  probeAttemptProcess,
  strongAttemptTerminalProof,
  type AttemptProcessProof,
  type AttemptTerminalProof,
} from "./attempt-intent.ts";
import { settleBounded } from "./attempt-support.ts";
import type { DescendantTracker, ProcessIdentity } from "./descendant-tracker.ts";
import { terminateProcessGroup } from "./process-group.ts";
import type { BunSubprocess, OutputSummary } from "./types.ts";

interface CleanupAttemptResult {
  issues: string[];
  signals: NodeJS.Signals[];
  terminalProof?: AttemptTerminalProof;
}

interface CleanupAttemptOptions {
  child: BunSubprocess | undefined;
  descendants: DescendantTracker | undefined;
  rootIdentity: ProcessIdentity | undefined;
  trackerReady: Promise<ProcessIdentity | undefined> | undefined;
  activityRecord: ActivityRecord | undefined;
  pumps: Promise<OutputSummary>[];
  pumpAbort: AbortController;
  graceMs: number;
  drainTimeoutMs: number;
  signalsSent?: readonly NodeJS.Signals[];
  signalsRecorded?: readonly NodeJS.Signals[];
  processGroupSignalsSent?: readonly NodeJS.Signals[];
  beforeCleanup?: () => void;
  onSignal?: (signal: NodeJS.Signals) => void;
  persistSignal?: (signal: NodeJS.Signals) => void;
  probeProcess?: (identity: ProcessIdentity) => AttemptProcessProof;
  terminateGroup?: typeof terminateProcessGroup;
}

async function exitedWithin(exited: Promise<number>, milliseconds: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), Math.max(0, milliseconds));
    const settle = () => { clearTimeout(timer); resolve(true); };
    void exited.then(settle, settle);
  });
}

export async function cleanupFailedAttempt(options: CleanupAttemptOptions): Promise<CleanupAttemptResult> {
  options.beforeCleanup?.();
  options.pumpAbort.abort();
  const issues: string[] = [];
  const signals: NodeJS.Signals[] = [...(options.signalsSent ?? [])];
  const durableSignals: NodeJS.Signals[] = [...(options.signalsRecorded ?? options.signalsSent ?? [])];
  const processGroupSignals: NodeJS.Signals[] = [...(options.processGroupSignalsSent ?? [])];
  const issue = (message: string): void => { if (!issues.includes(message)) issues.push(message); };
  const persist = (signal: NodeJS.Signals): void => {
    if (durableSignals.includes(signal)) return;
    (options.persistSignal ?? options.onSignal)?.(signal);
    durableSignals.push(signal);
  };
  const persistUndurable = (): void => { for (const signal of signals) persist(signal); };
  let signalPersistenceFailed = false;
  const delivered = (signal: NodeJS.Signals): void => {
    if (!signals.includes(signal)) signals.push(signal);
    try { persist(signal); } catch (error) { signalPersistenceFailed = true; throw error; }
  };
  persistUndurable();
  let rootSettled = false;
  let rootProof: AttemptProcessProof = "unknown";
  let descendantsAbsent = false;
  try { await options.descendants?.stop(); } catch (error) { issue(String(error)); }
  const rootIdentity = options.rootIdentity ?? (await options.trackerReady?.catch((error) => { issue(String(error)); return undefined; }));
  if (options.child) {
    if (!rootIdentity) {
      await exitedWithin(options.child.exited, options.graceMs);
      issue(`termination withheld because strong root identity was unavailable; residual pid ${options.child.pid} requires inspection`);
    } else {
      for (let resume = 0; resume < 3; resume += 1) {
        signalPersistenceFailed = false;
        try {
          await (options.terminateGroup ?? terminateProcessGroup)(options.child.pid, options.graceMs, options.child.exited, rootIdentity, {
            signalsSent: processGroupSignals,
            onSignal: (signal) => {
              if (!processGroupSignals.includes(signal)) processGroupSignals.push(signal);
              delivered(signal);
            },
          });
          break;
        } catch (error) {
          if (signalPersistenceFailed) {
            try { persistUndurable(); continue; } catch (persistError) {
              issue(`signal delivery ledger could not be persisted: ${String(persistError)}`);
              break;
            }
          }
          issue(String(error));
          break;
        }
      }
      rootSettled = await exitedWithin(options.child.exited, options.graceMs);
      try { rootProof = (options.probeProcess ?? probeAttemptProcess)(rootIdentity); } catch (error) { issue(String(error)); }
      if (!rootSettled || rootProof !== "absent") {
        issue(`root process absence was not proven for pid ${options.child.pid}: exited=${rootSettled}, identity=${rootProof}`);
      }
    }
  }
  if (options.descendants && !issues.some((value) => value.includes("ledger could not be persisted"))) {
    try {
      for (let resume = 0; resume < 3; resume += 1) {
        signalPersistenceFailed = false;
        try {
          await options.descendants.terminate(options.graceMs, delivered);
          break;
        } catch (error) {
          if (signalPersistenceFailed) {
            try { persistUndurable(); continue; } catch (persistError) {
              issue(`signal delivery ledger could not be persisted: ${String(persistError)}`);
              break;
            }
          }
          throw error;
        }
      }
    } catch (error) { issue(String(error)); }
    try {
      descendantsAbsent = await options.descendants.proveAbsent();
      if (!descendantsAbsent) issue("tracked descendant absence was not proven after cleanup");
    } catch (error) {
      issue(String(error));
      issue("tracked descendant absence was not proven after cleanup");
    }
  } else if (options.child) {
    issue("tracked descendant absence was not proven because the tracker was unavailable");
  }
  if (!(await settleBounded(options.pumps, options.drainTimeoutMs))) {
    issue("command output pumps did not settle after abort");
  }
  try { options.activityRecord?.complete("failed"); } catch (error) { issue(String(error)); }
  const terminalProof = rootIdentity && rootSettled && rootProof === "absent" && descendantsAbsent
    ? strongAttemptTerminalProof(rootIdentity)
    : undefined;
  return { issues, signals: [...new Set(signals)], ...(terminalProof ? { terminalProof } : {}) };
}
