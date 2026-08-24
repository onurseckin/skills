# Plan 2: Non-Blocking Orchestrator Init & Anti-Hang Protection

## 1. Context & Problem Statement

During long-task orchestration, an orchestrator process hung for **3+ minutes** on the `harness orchestrate init` command. The command froze waiting for standard input, preventing the orchestrator from spawning coordinators or dispatching work lanes.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                          ORCHESTRATE INIT FREEZE FLOW                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Agent executes `bun harness.ts orchestrate init` ]                       │
│                         │                                                   │
│                         ▼                                                   │
│  [ Stdin Stream Detection: `!process.stdin.isTTY` ]                         │
│                         │                                                   │
│                         ▼                                                   │
│  [ Blocking `readAll(process.stdin)` / `fs.readFileSync(0)` ] ───► HANG!    │
│    • Subprocess waiting indefinitely on EOF from parent subshell            │
│    • No timeout guard or non-blocking polling                               │
│    • Self-scheduler / watchdog unable to wake the frozen thread             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Objectives & Acceptance Criteria

1. **Deterministic Non-Blocking Prompt Capture:**
   - When arguments are provided inline (e.g. `bun harness.ts orchestrate "My Task Prompt"`), the CLI must immediately use the inline string and never attempt to read from `stdin`.
2. **Bounded Non-Blocking Stdin Reader (500ms Timeout):**
   - When reading piped input via `--prompt-stdin` or stdin redirection, the reader must enforce a strict non-blocking timeout (default: 500ms). If no EOF or data is received within 500ms, it must immediately abort with `[INVALID_ARGUMENT] Stdin stream did not yield prompt within 500ms`.
3. **Autonomous Watchdog Freeze Recovery:**
   - If an orchestrator or coordinator background task is unresponsive for $> 60\text{s}$ during initialization, the supervisory watchdog must terminate the hung process, record an empirical defect to `.olt/defects.jsonl`, and notify the orchestrator.
4. **Zero-Interaction CLI Invariant:**
   - The CLI must never present interactive prompts, raw `readline` questions, or pause execution waiting for user confirmation during automated agent workflows.

---

## 3. Detailed Technical Architecture

### 3.1 Non-Blocking Prompt Stream Resolver (`olt/scripts/src/cli/prompt-capture.ts`)

```typescript
export async function capturePromptWithTimeout(
  inlineText: string | undefined,
  options: { promptFile?: string; promptStdin?: boolean; timeoutMs?: number } = {},
): Promise<string> {
  // 1. Explicit inline prompt takes immediate precedence
  if (inlineText && inlineText.trim().length > 0) {
    return inlineText.trim();
  }

  // 2. Explicit file prompt
  if (options.promptFile) {
    if (!existsSync(options.promptFile)) {
      throw new HarnessError("INVALID_ARGUMENT", `prompt file not found: ${options.promptFile}`);
    }
    return readFileSync(options.promptFile, "utf-8").trim();
  }

  // 3. Stdin with non-blocking race timeout
  const timeoutMs = options.timeoutMs ?? 500;
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new HarnessError(
          "INVALID_ARGUMENT",
          `orchestrate init timed out after ${timeoutMs}ms waiting on stdin input. Pass prompt as inline argument: bun harness.ts orchestrate "<prompt>"`,
        ),
      );
    }, timeoutMs);

    let buffer = "";
    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
    };

    const onEnd = () => {
      cleanup();
      if (buffer.trim().length === 0) {
        reject(
          new HarnessError(
            "INVALID_ARGUMENT",
            "received empty prompt from stdin. Pass prompt as inline argument.",
          ),
        );
      } else {
        resolve(buffer.trim());
      }
    };

    const onError = (err: Error) => {
      cleanup();
      reject(new HarnessError("INVALID_ARGUMENT", `failed reading stdin: ${err.message}`));
    };

    function cleanup() {
      clearTimeout(timer);
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.off("error", onError);
      process.stdin.pause();
    }

    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    process.stdin.on("error", onError);
    process.stdin.resume();
  });
}
```

### 3.2 Watchdog Freeze Detector (`olt/scripts/src/mind/watchdog-manager.ts`)

```typescript
export function auditProcessLiveness(
  pid: number,
  registeredAtMs: number,
  timeoutMs: number = 60_000,
): { isAlive: boolean; isFrozen: boolean } {
  const isAlive = isProcessRunning(pid);
  const elapsed = Date.now() - registeredAtMs;
  const isFrozen = isAlive && elapsed > timeoutMs;

  return { isAlive, isFrozen };
}
```

---

## 4. Implementation Steps

1. **Step 1:** Implement `capturePromptWithTimeout` in `olt/scripts/src/cli/prompt-capture.ts`.
2. **Step 2:** Refactor `orchestrateCommand` in `olt/scripts/src/cli/commands/plan.ts` to use `capturePromptWithTimeout`, completely removing unshielded synchronous `readAll(process.stdin)` calls.
3. **Step 3:** Add test suite in `tests/unit/cli/prompt-capture.test.ts` validating:
   - Immediate resolution for inline strings (0ms delay).
   - Fast timeout rejection (500ms) when stdin is unclosed.
   - Proper reading when stdin emits valid data and closes EOF promptly.
4. **Step 4:** Integrate freeze detection into `mind:rescue` and `watchdog:check`.
