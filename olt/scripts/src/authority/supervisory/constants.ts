import type { DecisionProtocolDefinition, DecisionProtocolId } from "./types.ts";

export const DECISION_PROTOCOLS: Readonly<Record<DecisionProtocolId, DecisionProtocolDefinition>> = {
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
      "Upon encountering <5% quota (QUOTA_EXHAUSTED_CIRCUIT_BROKEN), gracefully suspend crons without killing active subagents, entering an IDLE state. Resume on sentinel.",
    formulaOrRule: "Quota < 5% -> Suspend Crons + Preserve State + Zero-Kill",
    keyInvariants: [
      "Zero-Kill Invariant: Active subagents are NEVER terminated during quota freeze (`manage_subagents kill` forbidden during freeze).",
      "Cron Suspension: Halt recurring background crons (`mind:pulse`, live auditors).",
      "Auto-Wake Resume: Upon single one-shot auto-wake sentinel notification (+60s buffer), re-register stopped crons and resume execution at exact DAG coordinates from `.olt/quota-dag-snapshot.json`.",
    ],
    operationalGuidance:
      "During Quota Freeze, do not kill any active subagents, pause all supervisory schedules, and await auto-wake sentinel to resume.",
    applicableTiers: [0, 1, 2],
  },
};
