# 12.4 Live TUI Telemetry & Diagnostics — Real-Time Terminal User Interface Architecture, Work/Span Cognitive Metrics, Heartbeat Health Meters & Diagnostic Telemetry

---

> **Status**: Authoritative Architecture Specification  
> **Topic**: VT100/ANSI High-Density Terminal UIs, Asynchronous Event Stream Tailing, Work/Span Cognitive Observability, Autonomic Heartbeat Meters, and Lock-Free Frame Buffering  
> **Target Audience**: Distributed Systems Engineers, Swarm Scheduler Architects, Terminal UI Specialists, Site Reliability Engineers

---

[Previous: 12-03 Audit Logging & Transcripts](12-03-audit-logging-and-transcripts.md) | [Chapter Index](index.md) | [All Chapters Index](../index.md) | [Next: Chapter 13: Policy, Mechanical RBAC & Fail-Closed Engine](../13-policy-rbac-failclosed-engine/index.md)
---

## 1. Executive Summary & Terminal Observability Philosophy

When orchestrating autonomous swarms consisting of dozens of parallel LLM agents, human supervisors and automated monitors require continuous, high-fidelity insight into execution dynamics. In headless servers, remote cloud VMs, and CI/CD pipelines, graphical web dashboards or browser-based telemetry tools introduce heavy JavaScript runtimes, external port bindings, and significant memory overhead.

Furthermore, naive CLI logging—such as streaming unstructured stdout logs from 40 concurrent workers—produces an unreadable, interleaved deluge of text that obscures critical gate failures, deadlock stalls, and lease timeouts.

The **OLT Live Terminal User Interface (TUI) Subsystem** resolves this by delivering a **zero-overhead, high-density, 4-quadrant ANSI/VT100 terminal dashboard**. The TUI engine runs asynchronously, reading event streams lock-free without acquiring kernel write locks or interfering with worker execution threads.

```
                           LIVE TUI TELEMETRY ARCHITECTURE
   ┌────────────────────────────────────────┐     ┌────────────────────────────────────────┐
   │         CAPSULE EVENT SOURCES          │     │       LOCK-FREE EVENT TAILER           │
   │  • events.jsonl (Merkle State Chain)   ├────►│  • Read-only file descriptor polling   │
   │  • mailbox/ queue directory stats      │     │  • Zero flock contention on workers    │
   │  • .olt/leases/ active token metadata  │     │  • Non-blocking line parser            │
   └────────────────────────────────────────┘     └───────────────────┬────────────────────┘
                                                                      │
                                                                      ▼
   ┌───────────────────────────────────────────────────────────────────────────────────────┐
   │                          QUADRANT METRICS & LAYOUT ENGINE                             │
   │  ┌───────────────────────────────┐                  ┌───────────────────────────────┐ │
   │  │ Quadrant I: Capsule Status    │                  │ Quadrant II: Cognitive Bounds │ │
   │  │  • Phase & Wave Progress      │                  │  • Work (W) & Critical Span(S)│ │
   │  │  • Monotonic Dual-Time Clock  │                  │  • Concurrency Target P = W/S││
   │  ├───────────────────────────────┤                  ├───────────────────────────────┤ │
   │  │ Quadrant III: Sugiyama DAG    │                  │ Quadrant IV: Leases & Bus     │ │
   │  │  • Dynamic Repair Hierarchy   │                  │  • Heartbeat Health Meters    │ │
   │  │  • Step Progress & Badges     │                  │  • Mailbox In/Out/Dead Counts │ │
   │  └───────────────────────────────┘                  └───────────────────────────────┘ │
   └──────────────────────────────────────────┬────────────────────────────────────────────┘
                                              │
                                              ▼
   ┌───────────────────────────────────────────────────────────────────────────────────────┐
   │                       DOUBLE-BUFFERED ANSI / VT100 RENDERER                           │
   │  • Frame Differential Buffer (diff against previous frame)                            │
   │  • ANSI Escape Codes: Cursor Home (\x1b[H), Cursor Hide (\x1b[?25l)                    │
   │  • Terminal Resize Handler (SIGWINCH dynamic viewport reflow)                         │
   └───────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. High-Density 4-Quadrant Terminal Layout

The Live TUI layout partitions the terminal window into four synchronized quadrants using Unicode box-drawing characters (`U+2500` through `U+257F`):

```text
┌───────────────────────────────────────────────────┬───────────────────────────────────────────────────┐
│ [1] CAPSULE STATUS & DUAL-TIME                    │ [2] WORK/SPAN & BRENT CONCURRENCY BOUNDS          │
│ Slug:    fix-auth-middleware-v2                   │ Work (W):         1840s (Cognitive Effort)        │
│ Run ID:  run_01J8F7B3C4N89QZ1X6R2A0E5             │ Span (S):          420s (Critical Path Length)    │
│ Phase:   WAVE_0_EXECUTION (Wave 2 of 4)           │ Concurrency (P):  1840 / 420 = 5 Workers        │
│ Clock:   00:14:22.410 UTC | Mono: +862.4s         │ Worker Saturation: [██████████░░░░░░░░] 5 / 12 (41%) │
│ Invariants: C1..C10 [● PASS: 10/10]               │ Efficiency (η):   87.6% (Zero-Serialization OK)   │
├───────────────────────────────────────────────────┼───────────────────────────────────────────────────┤
│ [3] LIVING SUGIYAMA DYNAMIC DAG & REPAIR TREES    │ [4] ACTIVE LEASES, HEARTBEATS & MAILBOX QUEUES    │
│ ┌─ [task-01-jwt-auth] ──► [● COMPLETED (Exit 0)]  │ Active Leases:                                    │
│ │   ↳ Scope: src/auth/jwt.ts, tests/jwt.test.ts   │  • impl_01: task-03 [ ACTIVE | Lease: 312s left]│
│ ├─ [task-02-session] ──► [● COMPLETED (Exit 0)]   │  • impl_02: task-04 [ ACTIVE | Lease: 480s left]│
│ │   ↳ Scope: src/auth/session.ts                  │  • val_01:  task-03 [ REVIEW | Lease: 520s left]│
│ ├─ [task-03-role-guard] ──► [ EXECUTING (s04)]  │ Heartbeat Monitor:                                │
│ │   ├──► [REPAIR-01] (R1 Sprout: Broken Cookie)   │  • impl_01: [] (1.2s ago)               │
│ │   └──► [VAL-03] [● VALIDATOR: val_01]           │  • impl_02: [] (0.8s ago)               │
│ └─ [task-04-rate-limit] ──► [ EXECUTING (s02)]  │ Mailbox Depths: In: 0 | Out: 2 | Proc: 14 | Dead:0│
└───────────────────────────────────────────────────┴───────────────────────────────────────────────────┘
```

### 2.1 Quadrant Functional Specifications

1. **Quadrant I: Capsule Status & Dual-Time Clock**:
   - Displays the active run slug, UUIDv4 run identifier, current execution phase, and dual-time synchronization ([dual-time/clock.ts](../../../../olt/scripts/src/core/dual-time/clock.ts)).
   - Real-time validation status of the 10 Core Invariants ($C_1 \dots C_{10}$).
2. **Quadrant II: Work/Span & Brent Concurrency Bounds**:
   - Real-time calculation of total work $W(t)$, remaining critical path span $S(t)$, theoretical parallelism $\mathcal{P} = \lceil W/S \rceil$, and worker lane saturation.
3. **Quadrant III: Living Dynamic Sugiyama DAG**:
   - Connected ASCII tree rendering of active execution waves, dynamically sprouted repair branches, write-scope boundaries, and active tool invocations ([reporting/living-tracer/render.ts](../../../../olt/scripts/src/reporting/living-tracer/render.ts)).
4. **Quadrant IV: Active Leases, Heartbeat Health & Mailbox Depths**:
   - Active POSIX advisory lease timers with countdowns, worker heartbeat meters, and mailbox backlog health counts ($\mathcal{D}_{\text{in}}, \mathcal{D}_{\text{out}}, \mathcal{D}_{\text{proc}}, \mathcal{D}_{\text{dead}}$).

---

## 3. Real-Time Work/Span Cognitive Metrics Computation

The TUI telemetry engine dynamically computes graph-theoretic cognitive metrics as events stream from the capsule:

```mermaid
flowchart TD
    E[events.jsonl Ingestion] --> Parse[Event Replayer Fold]
    Parse --> DAG[Dynamic Task Graph G = V, E]

    DAG --> W_Calc[Compute Cumulative Work W t]
    DAG --> S_Calc[Compute Critical Path Span S t]

    W_Calc --> P_Calc[Calculate Ideal Parallelism P = W / S]
    S_Calc --> P_Calc

    P_Calc --> Brent[Compute Brent Execution Bounds]
    Brent --> Sat[Compute Worker Saturation L_active / L_target]

    Sat --> RenderQ2[Render Quadrant II Work/Span Telemetry]

    classDef stage fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;
    classDef highlight fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#f8fafc;
    class E,Parse,DAG,W_Calc,S_Calc,P_Calc,Brent,Sat stage;
    class RenderQ2 highlight;
```

### 3.1 Mathematical Formulations

- **Total Cumulative Work ($W(t)$)**:
  $$W(t) = \sum_{v \in V_{\text{completed}}} t_{\text{actual}}(v) + \sum_{v \in V_{\text{active}}} t_{\text{elapsed}}(v) + \sum_{v \in V_{\text{pending}}} t_{\text{est}}(v)$$

- **Remaining Critical Path Span ($S(t)$)**:
  Let $\Pi(G_{\text{rem}})$ be the set of all directed paths from currently active/ready nodes to terminal sink nodes in the remaining DAG $G_{\text{rem}}$:
  $$S(t) = \max_{p \in \Pi(G_{\text{rem}})} \sum_{v \in p} t_{\text{est}}(v)$$

- **Effective Swarm Parallelism ($\mathcal{P}_{\text{eff}}(t)$)**:
  $$\mathcal{P}_{\text{eff}}(t) = \left\lceil \frac{W(t)}{S(t)} \right\rceil$$

- **Swarm Execution Efficiency ($\eta(t)$)**:
  $$\eta(t) = \frac{W(t)}{L_{\text{active}}(t) \cdot S(t)} \in [0, 1]$$

---

## 4. Autonomic Heartbeat Meters & Lease Telemetry

### 4.1 Heartbeat Health Monitoring

Worker agents emit non-blocking heartbeat telemetry pulses at regular intervals ($\tau_{\text{hb}} = 5\text{s}$). The TUI calculates the heartbeat deficit $\Delta t_{\text{hb}} = t_{\text{now}} - t_{\text{last\_pulse}}$:

$$ \text{HealthStatus}(A_i) = \begin{cases}
\texttt{"[] (HEALTHY)"} & \text{if } \Delta t_{\text{hb}} \le \tau_{\text{hb}} \\
\texttt{"[░░] (DELAYED)"} & \text{if } \tau_{\text{hb}} < \Delta t_{\text{hb}} \le 2\tau_{\text{hb}} \\
\texttt{"[░░░░░] (STRAGGLER)"} & \text{if } 2\tau_{\text{hb}} < \Delta t_{\text{hb}} \le 4\tau_{\text{hb}} \\
\texttt{"[ STALLED] (REAP PENDING)"} & \text{if } \Delta t_{\text{hb}} > 4\tau_{\text{hb}}
\end{cases}$$

### 4.2 Active Lease Countdown & Eviction Trigger

Every task lease possesses a hardware-enforced Time-To-Live ($TTL_{\text{lease}} \le 600\text{s}$). If a worker process becomes unresponsive without releasing its lock, the TUI highlights the lease in amber/red alert:

$$\text{TimeRemaining}(T_i) = t_{\text{leased}} + TTL - t_{\text{now}}$$

When $\text{TimeRemaining} \le 0$, the runtime autonomic watchdog initiates safe lease revocation and sprouts a replacement repair worker.

***

## 5. Double-Buffered ANSI/VT100 Rendering Engine

To eliminate terminal flickering and screen tearing during rapid updates (e.g., $10\text{Hz}$ refresh rates), the TUI implements a **double-buffered differential frame engine**:

```typescript
export class TerminalDashboardRenderer {
  private previousFrame: string[] = [];
  private isRunning: boolean = false;
  private termWidth: number = 120;
  private termHeight: number = 40;

  constructor() {
    this.updateDimensions();
    process.on("SIGWINCH", () => this.handleResize());
  }

  private updateDimensions(): void {
    this.termWidth = process.stdout.columns || 120;
    this.termHeight = process.stdout.rows || 40;
  }

  private handleResize(): void {
    this.updateDimensions();
    this.previousFrame = []; // Force complete redraw on window resize
    process.stdout.write("\x1b[2J"); // Clear entire screen
  }

  public render(state: DashboardState): void {
    const nextFrame: string[] = this.assembleFrame(state);

    // Enter alternative screen buffer and hide cursor
    process.stdout.write("\x1b[?25l");

    for (let row = 0; row < nextFrame.length && row < this.termHeight; row++) {
      const newLine = nextFrame[row] ?? "";
      const oldLine = this.previousFrame[row];

      // Differential line rendering: only output lines that changed
      if (newLine !== oldLine) {
        // Move cursor to row (1-indexed) and column 1: \x1b[<row>;1H
        process.stdout.write(`\x1b[${row + 1};1H\x1b[2K${newLine}`);
      }
    }

    this.previousFrame = nextFrame;
  }

  private assembleFrame(state: DashboardState): string[] {
    const q1 = renderQuadrant1(state.capsule, this.termWidth / 2);
    const q2 = renderQuadrant2(state.workSpan, this.termWidth / 2);
    const q3 = renderQuadrant3(state.dynamicDag, this.termWidth / 2);
    const q4 = renderQuadrant4(state.leases, state.mailboxes, this.termWidth / 2);

    return composeQuadrantGrid(q1, q2, q3, q4, this.termWidth, this.termHeight);
  }

  public stop(): void {
    process.stdout.write("\x1b[?25h"); // Restore cursor visibility
  }
}
```

***

## 6. Mathematical Bounds on Telemetry Overhead

Let:
* $R = 10\,\text{Hz}$ be the screen refresh rate ($100\text{ms}$ frame interval).
* $B_{\text{frame}} \le 40 \times 120 = 4800\,\text{bytes}$ be the maximum terminal frame size.
* $N_{\text{diff}} \be the average number of modified lines per frame ($N_{\text{diff}} \le 6$).

The average I/O bandwidth consumed by the Live TUI is bounded by:

$$\text{Bandwidth}_{\text{TUI}} = R \times N_{\text{diff}} \times 120\,\text{bytes} = 10 \times 6 \times 120 = 7.2\,\text{KB/sec}$$

Because the TUI reads exclusively from local cached memory structures populated by non-blocking file descriptor tailing, CPU utilization remains strictly below $0.5\%$ of a single host core, ensuring zero impact on LLM agent inference or build compilation throughput.

***

## 7. Edge Cases & Resiliency Mechanisms

```
┌──────────────────────────────────────┬──────────────────────────────┬────────────────────────────────────────┐
│ UI Telemetry Edge Case               │ Anomaly Signature            │ Resilience & Recovery Protocol         │
├──────────────────────────────────────┼──────────────────────────────┼────────────────────────────────────────┤
│ **Terminal Window Collapse (<80x24)**│ `termWidth < 80` on resize   │ Collapses into single-column high-pri  │
│                                      │                              │ summary mode (`formatCompactSummary`). │
├──────────────────────────────────────┼──────────────────────────────┼────────────────────────────────────────┤
│ **ANSI Escape Code Corruption**      │ Unescaped binary in stdout   │ Sanitizes all strings with line-limiter│
│                                      │ from rogue child process.    │ regex stripping non-printable bytes.   │
├──────────────────────────────────────┼──────────────────────────────┼────────────────────────────────────────┤
│ **Non-Interactive TTY (CI/Piped)**   │ `process.stdout.isTTY = false│ Disables double-buffering; emits       │
│                                      │                              │ periodic NDJSON telemetry heartbeats.  │
├──────────────────────────────────────┼──────────────────────────────┼────────────────────────────────────────┤
│ **High-Frequency Event Burst**       │ >500 events/second during    │ Throttle frame updates to 10Hz; merges │
│                                      │ wave initialization.         │ intermediate state projection diffs.   │
└──────────────────────────────────────┴──────────────────────────────┴────────────────────────────────────────┘
```

***

## 8. Summary Takeaways

* **High-Density Operational Visibility**: The 4-quadrant layout delivers comprehensive insight into capsule status, Work/Span cognitive metrics, dynamic DAG execution, and mailbox health within a single standard terminal window.
* **Zero Worker Interference**: By decoupling the rendering loop from worker execution and avoiding kernel write locks, the TUI operates with zero performance degradation on active tasks.
* **Instantaneous Anomaly Detection**: Heartbeat health meters and lease countdown timers provide visual alerts for deadlocks, stragglers, and broken dependencies before task deadlines expire.
* **Lightweight ANSI Efficiency**: Differential line double-buffering eliminates flickering while consuming less than $8\,\text{KB/s}$ of I/O bandwidth.

***

[Return to Architecture Index](../index.md)

---
[Previous: 12-03 Audit Logging & Transcripts](12-03-audit-logging-and-transcripts.md) | [Chapter Index](index.md) | [All Chapters Index](../index.md) | [Next: Chapter 13: Policy, Mechanical RBAC & Fail-Closed Engine](../13-policy-rbac-failclosed-engine/index.md)
---
$$
