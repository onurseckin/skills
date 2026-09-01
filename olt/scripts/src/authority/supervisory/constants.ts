import type { DecisionProtocolDefinition, DecisionProtocolId } from "./types.ts";

export const DECISION_PROTOCOLS: Readonly<Record<DecisionProtocolId, DecisionProtocolDefinition>> =
  {
    work_span_scaling: {
      id: "work_span_scaling",
      name: "Work/Span Concurrency Scaling (P = W / S)",
      summary:
        "Dynamic parallel occupancy scaling where concurrency P is determined by total work W over critical path span S, without artificial daily limits or budget refusal ladders.",
      formulaOrRule: "P = ceil(W / S)",
      keyInvariants: [
        "Compute algorithmic concurrency headroom (P = W / S) across independent DAG lanes.",
        "Dispatch disjoint independent work units simultaneously up to available worker capacity.",
        "Never impose artificial fixed daily worker caps or pulse exhaustion halts when headroom exists.",
      ],
      operationalGuidance:
        "Continuously inspect live ASCII DAG topology (`dag:view`) to identify critical-path bottlenecks and expand wave parallelism.",
      applicableTiers: [0, 1, 2],
    },
    anti_batching_continuous_dispatch: {
      id: "anti_batching_continuous_dispatch",
      name: "1:1 Anti-Batching & Continuous Eligible-Set Dispatch",
      summary:
        "The instant a slot frees (an agent submits, a lease is released, a dependency clears), dispatch the next claimable task immediately without waiting for sibling tasks.",
      formulaOrRule: "Continuous Dispatch + 1:1 Pairing (Implementer -> Validator)",
      keyInvariants: [
        "Continuous dispatch: Never serialize independent work lanes into sequential loops.",
        "1:1 Anti-batching: Validate an implementer's submission immediately upon arrival; do not wait for wave completion.",
        "Pairing invariant: Implementer + Validator paired dispatch for every task; validator dispatches the moment implementer submits.",
      ],
      operationalGuidance:
        "Keep the eligible set full. Fill freed capacity with the next highest-ranked claimable task instantly.",
      applicableTiers: [1, 2],
    },
    supervisor_zero_file_edit: {
      id: "supervisor_zero_file_edit",
      name: "Supervisor Zero-File-Edit Invariant",
      summary:
        "Supervisory threads (Tier 0 Mind, Tier 1 Orchestrator, Tier 2 Coordinator) are pure observers/managers and must NEVER write, edit, stage, format, or revert application source code or test files.",
      formulaOrRule: "Supervisory File Mod = 0 (Strict Pure Delegation)",
      keyInvariants: [
        "Never succumb to the 'trivial fix' fallacy: even a 1-line syntax fix must be delegated to a Tier 3 implementer.",
        "Main thread and supervisory threads stay empty of implementation code.",
        "Mutate capsule state strictly through recorded harness CLI commands, never hand edits.",
      ],
      operationalGuidance:
        "When a code fix is required, dispatch a Tier 3 Implementer via host native subagents with an exclusive write scope.",
      applicableTiers: [0, 1, 2],
    },
    four_tier_viewport_matrix: {
      id: "four_tier_viewport_matrix",
      name: "4-Tier Viewport Resolution Matrix",
      summary:
        "All UI/visual frontend tasks mandate multi-viewport verification across Desktop-Wide, Desktop, Tablet, and Mobile resolutions.",
      formulaOrRule:
        "Viewport Matrix = [1920x1080 (Desktop-Wide), 1440x900 (Desktop), 768x1024 (Tablet), 390x844 (Mobile)]",
      keyInvariants: [
        "Reject UI/visual submissions lacking multi-viewport rasterized captures across all 4 resolutions.",
        "Synthesize Dual-Channel DOM metrics (`visual-report.json`) and screenshot proofs across all 4 viewports.",
        "Enforce zero 0-byte or stubbed screenshot captures.",
      ],
      operationalGuidance:
        "Run visual regression proofs against all 4 viewport tiers before certifying UI task pass verdicts.",
      applicableTiers: [0, 1, 2, 3],
    },
    scepticism_quantitative_proof: {
      id: "scepticism_quantitative_proof",
      name: "Task Scepticism & Quantitative Proof Enforcement",
      summary:
        "Supervisors must actively push back on unverified, superficial, or qualitative-only validator reports, requiring quantitative metrics and counterfactual gate falsification.",
      formulaOrRule:
        "Verification = Quantitative Proof + Falsifiable Gate Proof + Adversarial Probe",
      keyInvariants: [
        "Prove compiled gates fail on disposable scratch copies (`gate:prove`) before trusting them.",
        "Reject rubber-stamped passes with `coordinator:pushback`.",
        "Require mandatory adversarial probe (`task:probe`) before any pass verdict is accepted.",
      ],
      operationalGuidance:
        "Require DOM bounding boxes, APCA contrast, screenshot byte proofs (> 1024B), and exact exit codes in evidence.",
      applicableTiers: [1, 2, 3],
    },
    strict_tier_hierarchy: {
      id: "strict_tier_hierarchy",
      name: "Strict 4-Tier Spawning Hierarchy & Disjoint Write Scopes",
      summary:
        "Tier 0 Mind spawns Tier 1 Orchestrator; Tier 1 spawns Tier 2 Coordinators; Tier 2 spawns Tier 3 Workers. Active leases must maintain disjoint write scopes.",
      formulaOrRule: "Tier(N) -> Tier(N+1) Spawning Only + Disjoint Write Scopes",
      keyInvariants: [
        "Cross-tier spawning is strictly forbidden (e.g. Mind or Orchestrator directly spawning Tier 3 workers).",
        "Zero overlapping write scopes among concurrently active leases.",
        "Implementers never validate their own work; validators never hold implementation leases.",
      ],
      operationalGuidance:
        "Verify write scopes are disjoint before dispatching concurrent worker leases.",
      applicableTiers: [0, 1, 2, 3],
    },
    infinite_pulse_cadence: {
      id: "infinite_pulse_cadence",
      name: "Infinite Borderless Cadence & 5-Minute Supervisory Heartbeats",
      summary:
        "Mind operates indefinitely as an autonomous loop (`mind:pulse`); closing or dying is forbidden. Supervisory schedules maintain 5-minute heartbeat cycles.",
      formulaOrRule: "Cadence = Continuous Loop + 5-Min Supervisory Crons + Unified Evidence",
      keyInvariants: [
        "Supervisory heartbeat ticks occur every 3-5 minutes.",
        "Mind pulse never terminates; continuous background timers keep loop active.",
        "All task evidence stored strictly in unified directory `.olt/capsules/<run>/evidence/`.",
      ],
      operationalGuidance:
        "Maintain active heartbeats (`task:heartbeat`, `mind:pulse`) and verify capsule health on every tick.",
      applicableTiers: [0, 1, 2],
    },
    dual_channel_validation: {
      id: "dual_channel_validation",
      name: "Dual-Channel Visual & DOM Validation",
      summary:
        "Synthesize computed DOM metrics (Channel 1) with rasterized visual screenshots (Channel 2) to eliminate virtual rendering blind spots.",
      formulaOrRule: "Channel 1 (DOM JSON) + Channel 2 (PNG Screenshots) = Ground Truth",
      keyInvariants: [
        "Channel 1: Computed DOM metrics (`visual-report.json`) verifying bounding boxes, styles, overflow, and APCA contrast.",
        "Channel 2: High-resolution screenshots (`.png`) verifying authentic browser layout engine rasterization.",
        "Cross-channel gap filling: when one channel is partial, the other corroborates.",
      ],
      operationalGuidance:
        "Mandate both DOM metrics and visual screenshots for every UI/frontend file modification.",
      applicableTiers: [2, 3],
    },
    standardized_agent_naming: {
      id: "standardized_agent_naming",
      name: "Standardized Task & Phase Agent Naming Convention",
      summary:
        "All agents enforce standard role-prefixed IDs: Tier 3 uses task-bound names (<role>_<task-id>[-<slug>]), Tier 1/2 uses phase/domain-bound names (<role>_<domain-or-phase-slug>).",
      formulaOrRule: "Tier 3: <role>_<task-id>[-<slug>] | Tier 1/2: <role>_<phase-or-domain-slug>",
      keyInvariants: [
        "Tier 3 Implementers and Validators embed assigned task ID in agent name (e.g. implementer_task-p47-autonomic-watchdog, validator_task-p47-autonomic-watchdog).",
        "Tier 1 Orchestrators and Tier 2 Coordinators embed run, phase, or domain slug (e.g. orchestrator_wave-2-foundations, coordinator_domain-cli-tools).",
        "Standardized names provide clear observability and unambiguous lineage across transcripts, CLI logs, and reports.",
      ],
      operationalGuidance:
        "Register and dispatch all agents with standardized IDs according to role tier and scope binding.",
      applicableTiers: [0, 1, 2, 3],
    },
    quota_freeze_zero_kill_resume: {
      id: "quota_freeze_zero_kill_resume",
      name: "Quota Freeze, Zero-Kill & Auto-Wake Resume",
      summary:
        "Upon encountering <10% quota (QUOTA_EXHAUSTED_CIRCUIT_BROKEN), gracefully suspend crons without killing active subagents, entering an IDLE state. Resume on sentinel.",
      formulaOrRule: "Quota < 10% -> Suspend Crons + Preserve State + Zero-Kill",
      keyInvariants: [
        "Zero-Kill Invariant: Active subagents are NEVER terminated during quota freeze (`manage_subagents kill` forbidden during freeze).",
        "Cron Suspension: Halt recurring background crons (`mind:pulse`, live auditors).",
        "Auto-Wake Resume: Upon single one-shot auto-wake sentinel notification (+60s buffer), re-register stopped crons and resume execution at exact DAG coordinates from `.olt/quota-dag-snapshot.json`.",
      ],
      operationalGuidance:
        "During Quota Freeze, do not kill any active subagents, pause all supervisory schedules, and await auto-wake sentinel to resume.",
      applicableTiers: [0, 1, 2],
    },
    perpetual_creative_product_owner: {
      id: "perpetual_creative_product_owner",
      name: "Perpetual Creative Product Owner & Anti-Idle Invariant",
      summary:
        "When active queues and feedback backlogs are clear, Mind is strictly forbidden from remaining passive or reporting waiting_for_dependents. Mind must autonomously engage Mode A Self-Evolution (Baseline Quality -> Product/UX Perfection -> Creative Feature Ideation), using git worktrees for parallel execution.",
      formulaOrRule: "Queue Clear -> Engage Mode A Autonomous Self-Evolution (Zero Idle)",
      keyInvariants: [
        "Zero-Idle Invariant: Mind never sleeps, idles, or stays passive when queues finish.",
        "Mode A 3-Step Flow: (1) Baseline Quality & Invariants Audit, (2) Multi-Viewport UI/UX Perfection (390px, 768px, 1440px, 1920px), (3) Creative Feature Ideation & Next-Generation Capabilities.",
        "Worktree Concurrency: Dispatch independent feature waves across isolated git worktrees (`workspace_mode: 'branch' | 'share'`) to eliminate working-tree merge collisions.",
      ],
      operationalGuidance:
        "Continuously audit repository routes, discover grounded performance and UI refinements, and author next-generation wave plans via `bun harness.ts plan:init`.",
      applicableTiers: [0, 1],
    },
    mandatory_tier_0_companion_auditors: {
      id: "mandatory_tier_0_companion_auditors",
      name: "Mandatory Tier 0 Companion Auditors (Zero-Termination)",
      summary:
        "Tier 0 Mind must always be accompanied by active, non-terminating Mind Auditor and Skill Auditor companions. Tier 0 companions are permanently active and immune to termination or teardown when campaigns finish.",
      formulaOrRule: "Tier 0 Fleet = [mind + mind-auditor + skill-auditor] (Always Active)",
      keyInvariants: [
        "Mandatory Bootstrapping: Deploying Tier 0 Mind automatically deploys mind-auditor and skill-auditor.",
        "Zero-Termination: Tier 0 companion auditors never self-terminate and cannot be torn down when child tasks complete.",
        "Back-to-Back Shock: On >=2 consecutive zero-delta / idle cycles, Mind Auditor must shock Mind via Mailbox IPC with rich Socratic challenges.",
      ],
      operationalGuidance:
        "Verify companion auditor presence on every pulse tick and ensure out-of-band surveillance remains continuous.",
      applicableTiers: [0],
    },
    mailbox_ipc_main_thread_silence: {
      id: "mailbox_ipc_main_thread_silence",
      name: "Mailbox IPC & Main-Thread Noise Elimination",
      summary:
        "All inter-agent chatter, status updates, and routine supervisory heartbeats must flow strictly through Mailbox IPC (`.olt/mailboxes/`). The main interactive thread is strictly reserved for fatal unrecoverable errors and user-requested milestone deliveries.",
      formulaOrRule: "Inter-Agent Traffic = .olt/mailboxes/ | Main Thread = Silent Relay",
      keyInvariants: [
        "Zero Main-Thread Spam: Never output repetitive 'Supervisory Watchdog Heartbeat' or 'Standing down' messages to the user.",
        "Mailbox Isolation: All peer communication uses `bun harness.ts msg:send` and `.olt/mailboxes/`.",
        "Escalation-Only Relay: Push to the main interactive thread only when an unrecoverable health failure or explicit human intervention is required.",
      ],
      operationalGuidance:
        "Direct all supervisory diagnostics and inter-agent directives to recipient mailboxes, keeping the main thread quiet.",
      applicableTiers: [0, 1, 2, 3],
    },
    three_strike_mechanical_containment: {
      id: "three_strike_mechanical_containment",
      name: "Three-Strike Mechanical Supervisory Containment",
      summary:
        "Enforce hard boundary containment on supervisors: Strike 1 (Intercept & Force Delegation), Strike 2 (Hard Capability Revocation / lock tools), Strike 3 (Persona Re-Spawn).",
      formulaOrRule: "Strike 1: Intercept -> Strike 2: Lock Tools -> Strike 3: Re-Spawn",
      keyInvariants: [
        "Strike 1: Direct file modifications or test runs by supervisors are intercepted, denied, and delegated to Tier 3.",
        "Strike 2: Repeated violations trigger tool revocation, lease cancellation, and capability clamping.",
        "Strike 3: Persistent violations terminate rogue persona and re-spawn clean grounded instance.",
      ],
      operationalGuidance:
        "Mechanically contain supervisory boundary drift and protect pure delegation purity across all tiers.",
      applicableTiers: [0, 1, 2],
    },
    anti_makework_genuine_value: {
      id: "anti_makework_genuine_value",
      name: "Anti-Make-Work & 5 Pillars of Genuine Value",
      summary:
        "Admit and execute tasks strictly delivering verifiable value across 5 Pillars (Utility, Simplification, Performance, Reliability, Observability), aggressively rejecting synthetic churn.",
      formulaOrRule:
        "Admit iff Value(Utility, Simplification, Performance, Reliability, Observability) > 0",
      keyInvariants: [
        "Reject Cosmetic Churn: block arbitrary file reorganizations, module renames, or styling without functional benefit.",
        "Reject Abstraction Bloat: block gratuitous wrappers, boilerplate factories, or excessive indirection.",
        "Reject Speculative Refactoring: block rewriting code for unevidenced hypothetical future requirements.",
      ],
      operationalGuidance:
        "Filter all candidate tasks through the 5 Pillars of Genuine Value before admission or dispatch.",
      applicableTiers: [0, 1, 2, 3],
    },
    cumulative_socratic_progression: {
      id: "cumulative_socratic_progression",
      name: "Cumulative Dialectical Socratic Progression",
      summary:
        "Challenge architectural and product assumptions across 3 cumulative levels (L1: prior trade-offs, L2: second-order effects, L3: emergent paradigms) with historical debate memory.",
      formulaOrRule:
        "Ladder = L1 (Trade-offs) -> L2 (Systemic Impact) -> L3 (First-Principles Simplification)",
      keyInvariants: [
        "L1: Verify historical commitments and previously accepted trade-offs before proceeding.",
        "L2: Interrogate second-order systemic effects, latency, and cognitive load.",
        "L3: Synthesize radical first-principles simplifications and paradigm leaps.",
      ],
      operationalGuidance:
        "Engage Mind Auditor Socratic challenges to deepen reasoning and prevent premature shallow convergence.",
      applicableTiers: [0, 1],
    },
    pre_declared_pareto_arbitration: {
      id: "pre_declared_pareto_arbitration",
      name: "Pre-Declared Pareto Arbitration",
      summary:
        "When architectural debates or candidate evaluations exceed 2 cycles without consensus, enforce Pareto arbitration along the 80/20 value-to-complexity boundary to break deadlock immediately.",
      formulaOrRule: "Debate Cycles > 2 -> Select max(Value / Complexity) on 80/20 Frontier",
      keyInvariants: [
        "Strict 2-cycle debate threshold: no unbounded bikeshedding or speculative deadlock.",
        "Select the path delivering 80% of empirical value with 20% of implementation complexity.",
        "Record decision rationale in cognitive memory and immediately unblock execution.",
      ],
      operationalGuidance:
        "Trigger Pareto arbitration immediately upon detecting 2 consecutive stalled debate ticks.",
      applicableTiers: [0, 1],
    },
    ergonomic_walkthrough_auditing: {
      id: "ergonomic_walkthrough_auditing",
      name: "Ergonomic Walkthrough Auditing & 5 Pillars of Product Craft",
      summary:
        "Audit user-facing UI, CLI, and interaction deliverables against the 5 Pillars of Product Craft (Completeness, Hierarchy, Ergonomics, Multi-Viewport, Delight).",
      formulaOrRule:
        "Craft Proof = Completeness + Visual Polish + Zero Friction + 4 Viewports + Delight",
      keyInvariants: [
        "Verify full journey completeness and graceful error degradation.",
        "Verify typography, spacing, visual hierarchy, and APCA contrast compliance.",
        "Validate multi-viewport responsive fluidity across 390px, 768px, 1440px, 1920px.",
      ],
      operationalGuidance:
        "Conduct structured ergonomic walkthroughs before certifying feature release completion.",
      applicableTiers: [0, 1, 2, 3],
    },
  };
