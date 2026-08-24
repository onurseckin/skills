export interface SocraticVector {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly focus: string;
}

export interface ExpandedBrainstormItem {
  readonly id: string;
  readonly vectorId: string;
  readonly vectorName: string;
  readonly round: number;
  readonly sourceRequirement: string;
  readonly risk: string;
  readonly mitigation: string;
  readonly targetInvariant?: string;
}

export interface BrainstormResult {
  readonly prompt: string;
  readonly roundsExecuted: number;
  readonly vectors: readonly SocraticVector[];
  readonly expandedItems: readonly ExpandedBrainstormItem[];
  readonly totalExpandedItems: number;
  readonly createdAt: string;
}

export const SOCRATIC_VECTORS: readonly SocraticVector[] = [
  {
    id: "EMPTY_PAYLOAD",
    name: "Empty / Whitespace / Malformed Payload Handling",
    description:
      "Handling empty payloads, whitespace-only input, missing files, or syntactically malformed structures",
    focus: "Null checks, empty strings, missing properties, malformed JSON/YAML payloads",
  },
  {
    id: "TIMEOUT_STAGNATION",
    name: "Timeout / Process Hang / Stagnation States",
    description:
      "Handling process timeouts, infinite execution loops, hung subprocesses, and stagnation states",
    focus: "Deadlocks, unbounded waits, heartbeat checks, watchdog timers, graceful aborts",
  },
  {
    id: "CONCURRENCY_MUTATION",
    name: "Concurrent File / Lock / Memory Mutation Races",
    description:
      "Handling race conditions, parallel file access, shared memory mutations, and lock contention",
    focus:
      "Atomic operations, file locking, state isolation, transactional edits, collision avoidance",
  },
  {
    id: "HOST_BOUNDARY",
    name: "Host Tool vs CLI Protocol Boundaries & Anti-Hallucination",
    description:
      "Enforcing strict host tool boundaries, CLI argument protocols, and path existence validation",
    focus:
      "Protocol conformance, CLI argument validation, path normalization, anti-hallucination guards",
  },
  {
    id: "STATE_TRANSITION",
    name: "State Machine Invalid-Transition Recovery",
    description:
      "Enforcing valid lifecycle states and recovering safely from corrupted or out-of-order state transitions",
    focus:
      "Lifecycle prerequisites, invalid state transitions, crash recovery, rollback mechanisms",
  },
  {
    id: "TYPE_INVARIANT",
    name: "Strict Type Invariants (0 any, 0 suppressions)",
    description:
      "Enforcing strict zero-any TypeScript guarantees, runtime schema guards, and no lint suppressions",
    focus:
      "0 any annotations, 0 @ts-ignore, 0 @ts-expect-error, 0 eslint-disable, runtime schema validation",
  },
  {
    id: "CLI_TELEMETRY",
    name: "CLI Formatting & Actionable Diagnostic Telemetry",
    description:
      "Providing structured error reporting, actionable diagnostic feedback, and parseable CLI output",
    focus:
      "Structured error logging, human-readable diagnostics, deterministic exit codes, telemetry events",
  },
  {
    id: "ADVERSARIAL_GATE",
    name: "Negative Counterfactual Tests (Adversarial Gate Proofs)",
    description:
      "Verifying failure modes via counterfactual tests, adversarial inputs, and negative gate proofs",
    focus:
      "Negative test cases, boundary breach detection, tamper-proofing, false-positive gate elimination",
  },
] as const;

function cleanRequirementLine(line: string): string {
  return line
    .replace(/^#+\s*/, "")
    .replace(/^[-*]\s+(\[[ xX]\]\s+)?/, "")
    .replace(/^\d+\.\s+/, "")
    .trim();
}

function generateRiskAndMitigation(
  vectorId: string,
  req: string,
  round: number,
): { risk: string; mitigation: string; targetInvariant: string } {
  const shortReq = req.length > 80 ? `${req.slice(0, 77)}...` : req;

  switch (vectorId) {
    case "EMPTY_PAYLOAD":
      if (round === 1) {
        return {
          risk: `Empty, whitespace-only, or missing payload when processing requirement "${shortReq}" causes unhandled null/undefined exceptions.`,
          mitigation: `Validate input schemas upfront with non-empty assertions and return explicit INVALID_ARGUMENT error before processing.`,
          targetInvariant: `INVARIANT-EMPTY-01: Reject null or blank inputs with structured diagnostic error.`,
        };
      }
      if (round === 2) {
        return {
          risk: `Malformed or truncated payload structure in "${shortReq}" bypasses basic existence checks and corrupts internal parser state.`,
          mitigation: `Implement deep structural schema parsing and type-guarded validation functions for all incoming payloads.`,
          targetInvariant: `INVARIANT-EMPTY-02: Enforce structural schema validation before deserialization.`,
        };
      }
      return {
        risk: `Adversarial nested empty structures or unicode whitespace in "${shortReq}" leads to silent no-op execution instead of expected failure.`,
        mitigation: `Add negative unit tests asserting rejection of complex empty payload variants and boundary values.`,
        targetInvariant: `INVARIANT-EMPTY-03: Negative counterfactual tests for empty and boundary payloads.`,
      };

    case "TIMEOUT_STAGNATION":
      if (round === 1) {
        return {
          risk: `Async task or subprocess execution for "${shortReq}" hangs indefinitely without a bounded execution deadline.`,
          mitigation: `Enforce bounded timeout promises and AbortController signals on all asynchronous execution paths.`,
          targetInvariant: `INVARIANT-TIMEOUT-01: Bounded execution timeouts with explicit cancellation handlers.`,
        };
      }
      if (round === 2) {
        return {
          risk: `Retry loops or recursive execution for "${shortReq}" stagnates silently without emitting heartbeat telemetry.`,
          mitigation: `Introduce maximum retry limits, exponential backoff, and periodic heartbeat notifications to prevent silent stagnation.`,
          targetInvariant: `INVARIANT-TIMEOUT-02: Stagnation watchdog with heartbeat tracking and bounded retries.`,
        };
      }
      return {
        risk: `Concurrent deadlocks or resource starvation during execution of "${shortReq}" causes harness lockup.`,
        mitigation: `Implement watchdog timer monitors that forcibly abort and record diagnostic stack traces upon stagnation.`,
        targetInvariant: `INVARIANT-TIMEOUT-03: Hard watchdog interlock with diagnostic dump on timeout.`,
      };

    case "CONCURRENCY_MUTATION":
      if (round === 1) {
        return {
          risk: `Concurrent file system modifications or shared state mutations during "${shortReq}" cause race conditions or torn writes.`,
          mitigation: `Utilize atomic write-rename patterns and file locking mechanisms for all disk modifications.`,
          targetInvariant: `INVARIANT-CONCURRENCY-01: Atomic file operations and mutual exclusion guards.`,
        };
      }
      if (round === 2) {
        return {
          risk: `Shared in-memory state modified simultaneously across worker processes in "${shortReq}" causes inconsistent read views.`,
          mitigation: `Enforce immutable data structures and deterministic state snapshots for inter-agent data passing.`,
          targetInvariant: `INVARIANT-CONCURRENCY-02: Immutable state transitions and deep copies on message boundaries.`,
        };
      }
      return {
        risk: `Interleaved read-modify-write operations in "${shortReq}" silently overwrite concurrent updates from peer tasks.`,
        mitigation: `Apply optimistic concurrency checks with revision tokens and transactional replay capability.`,
        targetInvariant: `INVARIANT-CONCURRENCY-03: Optimistic concurrency control with revision token verification.`,
      };

    case "HOST_BOUNDARY":
      if (round === 1) {
        return {
          risk: `Subprocess execution or path resolution for "${shortReq}" escapes the repository root or hallucinates external tools.`,
          mitigation: `Validate all target paths against canonical repository root and enforce strict command whitelist policy.`,
          targetInvariant: `INVARIANT-HOST-01: Strict path containment within workspace boundary.`,
        };
      }
      if (round === 2) {
        return {
          risk: `Environment differences across host platforms (macOS vs Linux) in "${shortReq}" cause subtle CLI argument or path failures.`,
          mitigation: `Normalize file paths, shell delimiters, and argument arrays using platform-agnostic standard library utilities.`,
          targetInvariant: `INVARIANT-HOST-02: Cross-platform path and environment normalization.`,
        };
      }
      return {
        risk: `Unsanitized user-supplied strings passed to shell subprocesses in "${shortReq}" create command injection vulnerabilities.`,
        mitigation: `Mandate structured argv arrays instead of raw shell strings and audit command arguments against RBAC policy.`,
        targetInvariant: `INVARIANT-HOST-03: Structured argv execution and shell-injection prevention.`,
      };

    case "STATE_TRANSITION":
      if (round === 1) {
        return {
          risk: `Out-of-order lifecycle execution in "${shortReq}" bypasses required prerequisite verification stages.`,
          mitigation: `Enforce finite state machine guard assertions that require prerequisite event receipts in events.jsonl.`,
          targetInvariant: `INVARIANT-STATE-01: Strict state machine transition validation with prerequisite receipts.`,
        };
      }
      if (round === 2) {
        return {
          risk: `Partial failure during state update in "${shortReq}" leaves the system in an unrecoverable corrupted intermediate state.`,
          mitigation: `Implement transactional rollback and deterministic recovery from last verified state snapshot.`,
          targetInvariant: `INVARIANT-STATE-02: Transactional state updates with atomic rollbacks on failure.`,
        };
      }
      return {
        risk: `Re-entrant or duplicate event processing in "${shortReq}" causes inconsistent multiple transitions.`,
        mitigation: `Ensure all state transition handlers are idempotent and guarded by unique transition IDs.`,
        targetInvariant: `INVARIANT-STATE-03: Idempotent state transitions guarded by deterministic event deduplication.`,
      };

    case "TYPE_INVARIANT":
      if (round === 1) {
        return {
          risk: `Type coercion or implicit 'any' types in "${shortReq}" lead to runtime TypeError exceptions.`,
          mitigation: `Enforce zero 'any' annotations, complete interface definitions, and strict TypeScript compiler settings.`,
          targetInvariant: `INVARIANT-TYPE-01: Strict TypeScript compilation with 0 any annotations.`,
        };
      }
      if (round === 2) {
        return {
          risk: `Use of '@ts-ignore', '@ts-expect-error', or type assertions in "${shortReq}" masks underlying type mismatches.`,
          mitigation: `Ban all compiler suppression directives and implement comprehensive type narrowing guards.`,
          targetInvariant: `INVARIANT-TYPE-02: Zero compiler suppression directives (@ts-ignore / @ts-expect-error).`,
        };
      }
      return {
        risk: `Untyped external JSON data parsed in "${shortReq}" violates expected internal interface contracts.`,
        mitigation: `Validate all parsed JSON inputs with runtime schema predicates before casting or passing to internal functions.`,
        targetInvariant: `INVARIANT-TYPE-03: Runtime type guards and validation schemas for external data.`,
      };

    case "CLI_TELEMETRY":
      if (round === 1) {
        return {
          risk: `Failures during execution of "${shortReq}" produce cryptic stack traces without actionable diagnostic guidance.`,
          mitigation: `Format CLI error messages with distinct error codes, clear descriptions, and actionable fix suggestions.`,
          targetInvariant: `INVARIANT-TELEMETRY-01: Actionable error formatting with specific error codes and remediation hints.`,
        };
      }
      if (round === 2) {
        return {
          risk: `Silent execution or missing progress indicators in "${shortReq}" leave users and automation agents uninformed.`,
          mitigation: `Emit structured progress telemetry events and clean ASCII summary output throughout execution.`,
          targetInvariant: `INVARIANT-TELEMETRY-02: Structured real-time event streaming and ASCII summary tables.`,
        };
      }
      return {
        risk: `Inconsistent CLI exit codes in "${shortReq}" cause CI automation pipelines to miss critical failure states.`,
        mitigation: `Map every distinct failure category to a standardized, deterministic non-zero exit code.`,
        targetInvariant: `INVARIANT-TELEMETRY-03: Deterministic CLI exit code mapping for CI/CD compatibility.`,
      };

    case "ADVERSARIAL_GATE":
      if (round === 1) {
        return {
          risk: `Gate verification for "${shortReq}" passes trivially due to missing negative test assertions (false positive).`,
          mitigation: `Implement counterfactual adversarial tests that intentionally violate requirements to prove gate rejection.`,
          targetInvariant: `INVARIANT-GATE-01: Mandatory negative counterfactual tests proving failure detection.`,
        };
      }
      if (round === 2) {
        return {
          risk: `Test assertions for "${shortReq}" only validate happy path scenarios, leaving critical edge cases unexercised.`,
          mitigation: `Design boundary-value and extreme condition test matrices covering all declared failure vectors.`,
          targetInvariant: `INVARIANT-GATE-02: Exhaustive boundary value and stress test coverage.`,
        };
      }
      return {
        risk: `Security or safety constraints in "${shortReq}" bypassed through manipulated inputs or skipped validation steps.`,
        mitigation: `Enforce mechanical two-key validation gates and immutable cryptographic hashes on test outputs.`,
        targetInvariant: `INVARIANT-GATE-03: Two-key validation gate with tamper-proof verification receipts.`,
      };

    default:
      return {
        risk: `Unanticipated failure mode in "${shortReq}" under vector ${vectorId}.`,
        mitigation: `Implement defensive validation, error boundaries, and comprehensive logging.`,
        targetInvariant: `INVARIANT-DEFAULT: Generic defensive error handling.`,
      };
  }
}

export class BrainstormEngine {
  public static readonly SOCRATIC_VECTORS: readonly SocraticVector[] = SOCRATIC_VECTORS;

  public static getVectorById(id: string): SocraticVector | undefined {
    return SOCRATIC_VECTORS.find((v) => v.id === id);
  }

  public static expandPromptToVectors(prompt: string, rounds = 3): BrainstormResult {
    const roundsCount = Math.max(1, rounds);
    const trimmed = prompt.trim();

    if (!trimmed) {
      return {
        prompt,
        roundsExecuted: roundsCount,
        vectors: SOCRATIC_VECTORS,
        expandedItems: [],
        totalExpandedItems: 0,
        createdAt: new Date().toISOString(),
      };
    }

    const lines = prompt
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));

    const requirements = lines.length > 0 ? lines : [trimmed];
    const expandedItems: ExpandedBrainstormItem[] = [];

    for (let r = 1; r <= roundsCount; r++) {
      for (let reqIdx = 0; reqIdx < requirements.length; reqIdx++) {
        const rawReq = requirements[reqIdx];
        if (!rawReq) {
          continue;
        }
        const cleanedCandidate = cleanRequirementLine(rawReq);
        const cleaned = cleanedCandidate.length > 0 ? cleanedCandidate : rawReq;

        for (const vector of SOCRATIC_VECTORS) {
          const { risk, mitigation, targetInvariant } = generateRiskAndMitigation(
            vector.id,
            cleaned,
            r,
          );

          expandedItems.push({
            id: `brainstorm-r${r}-${vector.id.toLowerCase()}-${reqIdx + 1}`,
            vectorId: vector.id,
            vectorName: vector.name,
            round: r,
            sourceRequirement: cleaned,
            risk,
            mitigation,
            targetInvariant,
          });
        }
      }
    }

    return {
      prompt,
      roundsExecuted: roundsCount,
      vectors: SOCRATIC_VECTORS,
      expandedItems,
      totalExpandedItems: expandedItems.length,
      createdAt: new Date().toISOString(),
    };
  }

  public static formatBrainstormTable(result: BrainstormResult): string {
    const lines: string[] = [];
    lines.push("================================================================================");
    lines.push(" Socratic 8-Vector Brainstorming Matrix");
    lines.push(
      ` Rounds Executed: ${result.roundsExecuted} | Total Matrix Items: ${result.totalExpandedItems}`,
    );
    lines.push("================================================================================");

    for (const vector of result.vectors) {
      const itemsForVector = result.expandedItems.filter((item) => item.vectorId === vector.id);
      lines.push(`\n[Vector: ${vector.id}] ${vector.name}`);
      lines.push(`Description: ${vector.description}`);
      lines.push(`Focus: ${vector.focus}`);
      lines.push(
        "--------------------------------------------------------------------------------",
      );

      if (itemsForVector.length === 0) {
        lines.push("  (No items generated)");
      } else {
        for (const item of itemsForVector) {
          lines.push(`  - [Round ${item.round}] Req: "${item.sourceRequirement}"`);
          lines.push(`    Risk:       ${item.risk}`);
          lines.push(`    Mitigation: ${item.mitigation}`);
          if (item.targetInvariant) {
            lines.push(`    Invariant:  ${item.targetInvariant}`);
          }
        }
      }
    }

    lines.push(
      "\n================================================================================",
    );
    return lines.join("\n");
  }
}
