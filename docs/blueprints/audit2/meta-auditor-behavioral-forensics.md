# Meta-Auditor Behavioral Forensics

## 1. What Calls What?

The Behavioral Forensics layer primarily operates post-run or post-wave to evaluate subagent actions against defined role constraints.

- `behavioral-auditor.ts` acts as the primary scanning engine. It ingests the `AgentLedger`, `CommandRecord`, and `RunState` and systematically compares agent actions (tool usage and command execution) against sets of forbidden operations like `FILE_EDIT_TOOLS` and `GRAPH_MUTATION_COMMANDS`.
- `socratic-validator.ts` (Socratic Reflexive Self-Questioning Engine) evaluates states against 5 quantitative and qualitative dimensions (e.g., `Premise Verification`, `Edge Case Exploration`, `Hierarchy Invariant Preservation`) to synthesize structured issues and verdicts.
- `subagent-watchdog-monitor.ts` evaluates telemetry real-time during loops, checking for anomalies like `POLLING_WASTE` (too many sleeps) and `STRAGGLER` (turn counts exceeding thresholds) and recommending resets.

## 2. Behavioral Forensics Analysis

- **Role Boundary Violations:** The `behavioral-auditor.ts` specifically tracks `BehavioralViolationType`s like `coordinator_code_writing`, `orchestrator_direct_implementation`, and `implementer_self_grading`. It scans the tool arrays for instances where a `coordinator` calls `replace_file_content` or an `implementer` submits a `task:review` command to self-grade.
- **7 Anomaly Detection Heuristics:** The watchdog and socratic checks codify the heuristic audits. Token burning (excessive turns), false serialization, role boundary deviation (file editing supervisors), polling waste (sleep loops), and ghost leases are directly mitigated through these structural checks.
- **Efficiency Scoring:** The `socratic-validator.ts` tracks a strict matrix of evaluations (`questions_passed / questions_evaluated`), yielding deterministic `OPTIMAL` or `DEFECT_FLAGGED` verdicts instead of relying on LLM vibes.

## 3. Cognitive vs Mechanic Boundary Analysis

These audit scripts act as a Meta-Mechanic layer over the Cognitive actors. Because cognitive reviewers cannot execute commands, the behavioral auditor mechanically proves that they obeyed this constraint by scanning the ledger for zero usage of terminal or edit tools by these personas.

## 4. Current Live Code Verification Assessment

- **Finding Count:** 4 unconstrained core findings.
- **Evidence Collection Trace:** The tool relies on rigorous telemetry inputs—reading from the `AgentLedger` and `CommandRecord` json payloads to assert truths.
- **Verification Assessment:** The Meta-Auditor logic effectively prevents role drift by mechanically flagging `DEFECT_FLAGGED` when supervisors attempt to bypass their tier constraints, ensuring the 4-tier hierarchy is strictly preserved.
