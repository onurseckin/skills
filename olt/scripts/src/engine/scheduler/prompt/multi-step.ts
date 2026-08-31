import type {
  CognitiveDirectiveDimension,
  CognitivePromptOptions,
  CognitiveStep,
} from "./types.ts";

export function generateCognitiveSteps(
  dimension: CognitiveDirectiveDimension,
  options: CognitivePromptOptions = {},
): readonly CognitiveStep[] {
  const steps: CognitiveStep[] = [];

  switch (dimension) {
    case "socratic_forensics":
      steps.push(
        {
          stepNumber: 1,
          title: "Empirical State Inspection",
          action:
            "Inspect current state machine variables, error signals, and logs without assuming baseline health.",
          requiredProof:
            "Captured state values, defect entries from .olt/defects.jsonl, and command exit codes.",
          forbiddenShortcuts: [
            "Assuming state is valid without inspection",
            "Ignoring previous error codes",
          ],
        },
        {
          stepNumber: 2,
          title: "Causal Mechanism Hypothesis",
          action:
            "Formulate an explicit causal chain explaining why the system behaved as observed.",
          requiredProof:
            "A concrete hypothesis linking specific lines of code or state properties to the observed outcome.",
          forbiddenShortcuts: [
            "Speculative trial-and-error edits",
            "Masking errors with loose types",
          ],
        },
        {
          stepNumber: 3,
          title: "Atomic Invariant-Preserving Fix",
          action:
            "Apply targeted, atomic code modifications strictly within declared write scopes.",
          requiredProof: "Git diff showing clean, minimal changes with 0 type suppressions.",
          forbiddenShortcuts: ["Writing outside write scope", "Using any or @ts-ignore"],
        },
        {
          stepNumber: 4,
          title: "Deterministic Gate Proof",
          action:
            "Execute the exact file-scoped test suite and verify 100% green passing assertions.",
          requiredProof: "Test runner output showing 0 failures, 0 skipped, and clean exit code 0.",
          forbiddenShortcuts: ["Skipping gate test execution", "Accepting partial passes"],
        },
      );
      break;

    case "anti_stagnation_intervention":
      steps.push(
        {
          stepNumber: 1,
          title: "Idle Loop Diagnostics",
          action:
            "Inspect the task queue and pulse history to determine why consecutive pulses yielded 0 delta.",
          requiredProof: "Pulse history trailing values and active task lock status.",
          forbiddenShortcuts: ["Remaining in idle quiescent sleep", "Emitting empty pulse reports"],
        },
        {
          stepNumber: 2,
          title: "Mode A Creative Discovery",
          action:
            "Switch to Autonomous Product Manager mode: scan repository capabilities and discover unfulfilled user leverage.",
          requiredProof:
            "Structured proposal candidate with clear user-facing DX/UX value proposition.",
          forbiddenShortcuts: ["Waiting for human intervention", "Admitting duplicate tasks"],
        },
        {
          stepNumber: 3,
          title: "Task Admission & Dispatch",
          action:
            "Admit the newly discovered high-leverage task into the active backlog via mind:admit.",
          requiredProof: "Task admission event recorded in the capsule event ledger.",
          forbiddenShortcuts: [
            "Bypassing admission protocol",
            "Creating ungrounded synthetic tasks",
          ],
        },
        {
          stepNumber: 4,
          title: "Progress Delta Evidencing",
          action: "Ensure the admitted task is ready for dispatch and log non-zero value delta.",
          requiredProof: "Updated state.json reflecting positive value delta and reset zero-streak.",
          forbiddenShortcuts: ["Allowing zero-streak to increment further"],
        },
      );
      break;

    case "multi_step_execution":
      steps.push(
        {
          stepNumber: 1,
          title: "Task Boundary & Scope Lock",
          action:
            "Confirm active lease token, task requirement IDs, and strictly confined write scopes.",
          requiredProof: "Verified session token and write scope path listing.",
          forbiddenShortcuts: ["Modifying files outside assigned write scope"],
        },
        {
          stepNumber: 2,
          title: "Incremental Implementation Chunk",
          action:
            "Implement the core technical requirement using strictly typed TypeScript patterns.",
          requiredProof: "Syntactically sound code with complete type annotations.",
          forbiddenShortcuts: ["Leaving unhandled promise rejections", "Using any annotations"],
        },
        {
          stepNumber: 3,
          title: "Unit & Gate Verification",
          action: "Run targeted unit tests verifying both positive and negative boundary cases.",
          requiredProof: "Deterministic test execution log with 100% passing tests.",
          forbiddenShortcuts: ["Bypassing test runs", "Disabling lint or test checks"],
        },
        {
          stepNumber: 4,
          title: "Evidence & Submission Report",
          action:
            "Assemble structured submission payload with changed files, test evidence, and summary.",
          requiredProof:
            "Validated task:submit payload accepted with exit code 0 by the harness.",
          forbiddenShortcuts: ["Submitting without evidence", "Omitting changed file paths"],
        },
      );
      break;

    case "context_loss_prevention":
      steps.push(
        {
          stepNumber: 1,
          title: "Topological Anchor Re-alignment",
          action:
            "Re-read task graph topology, active wave dependencies, and overall run milestones.",
          requiredProof: "Current wave index and list of completed vs pending task IDs.",
          forbiddenShortcuts: ["Assuming task order without topology inspection"],
        },
        {
          stepNumber: 2,
          title: "Charter & Invariant Recalibration",
          action:
            "Verify that ongoing work strictly aligns with repository charter and supervisory constraints.",
          requiredProof: "Confirmed compliance with 0-any and zero-unsupervised-spawn rules.",
          forbiddenShortcuts: ["Drifting into out-of-scope architectural rewrites"],
        },
        {
          stepNumber: 3,
          title: "Milestone Execution Push",
          action:
            "Focus 100% of cognitive capacity on the single next blocking dependency in the current wave.",
          requiredProof: "Completed and submitted task moving the wave topology forward.",
          forbiddenShortcuts: ["Attempting to execute wave-2 tasks prematurely"],
        },
      );
      break;

    default:
      steps.push(
        {
          stepNumber: 1,
          title: "Contextual Health Assessment",
          action: "Assess subsystem status against strict invariants and gate requirements.",
          requiredProof: "Verified state inspection output.",
          forbiddenShortcuts: ["Skipping diagnostic evaluation"],
        },
        {
          stepNumber: 2,
          title: "Targeted Strategic Intervention",
          action: "Execute high-impact, grounded enhancements or structural fixes.",
          requiredProof: "Source modifications confined to assigned write scope.",
          forbiddenShortcuts: ["Unfocused changes"],
        },
        {
          stepNumber: 3,
          title: "Deterministic Verification",
          action: "Run file-scoped test suite to prove regression-free soundness.",
          requiredProof: "Test pass output with exit code 0.",
          forbiddenShortcuts: ["Skipping verification"],
        },
      );
      break;
  }

  return steps;
}
