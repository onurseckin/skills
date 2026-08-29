import type { BunSubprocess } from "../types/types";

export type TimeoutKind = "idle" | "wall";
export interface WatchdogOutcome {
  code: null | number;
  timeout: null | TimeoutKind;
  interrupted: boolean;
}

const sleep = (milliseconds: number) =>
  new Promise<"tick">((resolve) => setTimeout(() => resolve("tick"), milliseconds));

export async function monitorProcess(
  child: BunSubprocess,
  started: number,
  activity: () => number,
  wallMs: number,
  idleMs: number,
  heartbeat: () => void,
  signal?: AbortSignal,
): Promise<WatchdogOutcome> {
  const poll = Math.min(50, Math.max(5, Math.floor(Math.min(wallMs, idleMs) / 4)));
  const exited = child.exited.then((code) => ({ kind: "exit" as const, code }));
  const interrupted = new Promise<{ kind: "interrupted" }>((resolve) => {
    if (signal?.aborted) resolve({ kind: "interrupted" });
    else signal?.addEventListener("abort", () => resolve({ kind: "interrupted" }), { once: true });
  });
  while (true) {
    const result = await Promise.race([
      exited,
      interrupted,
      sleep(poll).then(() => ({ kind: "tick" as const })),
    ]);
    if (result.kind === "exit") return { code: result.code, timeout: null, interrupted: false };
    if (result.kind === "interrupted") return { code: null, timeout: null, interrupted: true };
    heartbeat();
    const now = Date.now();
    if (now - started >= wallMs) return { code: null, timeout: "wall", interrupted: false };
    if (now - activity() >= idleMs) return { code: null, timeout: "idle", interrupted: false };
  }
}
