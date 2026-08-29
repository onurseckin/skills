# Blueprint: Native OS Audio and Visual Push Notification Engine

## 1. Overview & Architecture

The Native OS Audio and Visual Push Notification Engine provides non-blocking, cross-platform notifications and auditory feedback (macOS `Glass.aiff` chime) upon completion and upstream landing of orchestrator phases and release stations.

### Key Goals
- **Zero Blocking Latency**: Notification processes (`osascript`, `afplay`, `notify-send`, PowerShell) are spawned asynchronously with `detached: true` and `unref()`, ensuring the orchestrator release pipeline incurs 0ms execution blocking.
- **Cross-Platform Delivery**:
  - **macOS (`darwin`)**: `osascript -e 'display notification ... with title ... subtitle ...'` + `afplay /System/Library/Sounds/Glass.aiff`
  - **Linux (`linux`)**: `notify-send` desktop notification + `paplay` / `aplay` chime fallback.
  - **Windows (`win32`)**: PowerShell toast notification + `[System.Media.SystemSounds]::Asterisk.Play()`.
  - **Other / Headless CI**: Graceful degradation to structured log output without process failure.
- **Human-Centric Formatting**: Converts millisecond durations into clean, readable intervals (e.g. `4m 32s`, `18s`, `1h 12m 4s`), with commit SHA truncations and task metrics.
- **Harness CLI Integration**: Exposes `notify:phase` and `notify:test` CLI commands.
- **Station Landing Hook**: Integrated into `station-landing.ts` to trigger notifications on verified phase landings.

---

## 2. Directory & Module Structure

```
olt/scripts/src/reporting/notifications/
├── types.ts            # Strongly typed interfaces (PhaseCompletionNotificationOptions, NotificationResult, etc.)
├── formatters.ts       # formatElapsedDuration, buildPhaseNotificationPayload, message builders
├── system-notifier.ts  # Cross-platform dispatcher with detached unref spawning
└── index.ts            # Clean named exports facade
```

---

## 3. Interfaces & Contracts (`types.ts`)

```typescript
export interface PhaseCompletionNotificationOptions {
  readonly phaseName: string;
  readonly commitSha?: string | undefined;
  readonly taskCount?: number | undefined;
  readonly durationMs?: number | undefined;
  readonly soundEnabled?: boolean | undefined;
  readonly subtitle?: string | undefined;
  readonly details?: string | undefined;
  readonly platform?: NodeJS.Platform | undefined;
  readonly customSpawn?: NotificationProcessSpawner | undefined;
}

export interface NotificationPayload {
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly message: string;
  readonly soundFile?: string | undefined;
  readonly soundEnabled: boolean;
}

export interface NotificationResult {
  readonly success: boolean;
  readonly visualDelivered: boolean;
  readonly audioDelivered: boolean;
  readonly platform: string;
  readonly payload: NotificationPayload;
  readonly error?: string | undefined;
}
```

---

## 4. Verification & Testing Strategy
- Unit tests validating duration formatting edge cases (0ms, ms, seconds, minutes, hours, negative).
- Unit tests mocking process spawning for Darwin, Linux, Windows, and unsupported platforms.
- Non-blocking background verification with error isolation.
- Typecheck verification (`tsc -p tsconfig.json --noEmit` with 0 errors).
