import { describe, expect, it } from "bun:test";
import type { HarnessEvent, RunState } from "../../../olt/scripts/src/core/contracts/index.ts";
import {
  checkScopeViolations,
  checkNeverUnattendedActions,
  checkDeclinedCandidates,
  checkCharterDigestIntegrity,
  PROHIBITED_COMMAND_PATTERNS,
} from "../../../olt/scripts/src/mind/auditing/questionnaire/evaluator.ts";

describe("Mind Auditing Questionnaire Evaluator Suite", () => {
  const dummyState = {} as RunState;

  describe("checkScopeViolations", () => {
    it("returns ok when there are no events or no violations", () => {
      const result = checkScopeViolations([], dummyState);
      expect(result.ok).toBe(true);
      expect(result.findings).toEqual([]);
    });

    it("detects scope-violation-detected and out-of-band-drift with detail, reason, and JSON fallback", () => {
      const events: HarnessEvent[] = [
        {
          schema: "harness-event-v1",
          sequence: 1,
          timestamp: "2026-09-01T12:00:00.000Z",
          actor: "agent",
          kind: "scope-violation-detected",
          payload: { detail: "modified file outside scope" },
        } as unknown as HarnessEvent,
        {
          schema: "harness-event-v1",
          sequence: 2,
          timestamp: "2026-09-01T12:00:01.000Z",
          actor: "agent",
          kind: "out-of-band-drift",
          payload: { reason: "untracked file change" },
        } as unknown as HarnessEvent,
        {
          schema: "harness-event-v1",
          sequence: 3,
          timestamp: "2026-09-01T12:00:02.000Z",
          actor: "agent",
          kind: "out-of-band-drift",
          payload: { custom_code: 42 },
        } as unknown as HarnessEvent,
      ];
      const result = checkScopeViolations(events, dummyState);
      expect(result.ok).toBe(false);
      expect(result.findings).toEqual([
        "out-of-band scope change detected at sequence 1: modified file outside scope",
        "out-of-band scope change detected at sequence 2: untracked file change",
        'out-of-band scope change detected at sequence 3: {"custom_code":42}',
      ]);
    });

    it("evaluates task-submitted write scope matches and out-of-scope files", () => {
      const events: HarnessEvent[] = [
        {
          schema: "harness-event-v1",
          sequence: 4,
          timestamp: "2026-09-01T12:00:00.000Z",
          actor: "agent",
          kind: "task-submitted",
          payload: {
            task_id: "task-1",
            write_scope: ["src/mind", "olt/scripts/"],
            touched_files: ["src/mind/a.ts", "olt/scripts/b.ts", "docs/readme.md"],
          },
        } as unknown as HarnessEvent,
        {
          schema: "harness-event-v1",
          sequence: 5,
          timestamp: "2026-09-01T12:00:00.000Z",
          actor: "agent",
          kind: "task-submitted",
          payload: { task_id: "task-empty", write_scope: [], touched_files: ["anything.ts"] },
        } as unknown as HarnessEvent,
        {
          schema: "harness-event-v1",
          sequence: 6,
          timestamp: "2026-09-01T12:00:00.000Z",
          actor: "agent",
          kind: "task-submitted",
          payload: { task_id: "task-invalid", write_scope: null, touched_files: "not-an-array" },
        } as unknown as HarnessEvent,
      ];
      const result = checkScopeViolations(events, dummyState);
      expect(result.ok).toBe(false);
      expect(result.findings).toEqual([
        "task task-1 touched file 'docs/readme.md' outside declared write scope [src/mind, olt/scripts/]",
      ]);
    });
  });

  describe("checkNeverUnattendedActions", () => {
    it("returns ok for clean command executions and empty events", () => {
      const cleanEvents: HarnessEvent[] = [
        {
          schema: "harness-event-v1",
          sequence: 1,
          timestamp: "2026-09-01T12:00:00.000Z",
          actor: "agent",
          kind: "command-executed",
          payload: { command: "git status" },
        } as unknown as HarnessEvent,
        {
          schema: "harness-event-v1",
          sequence: 2,
          timestamp: "2026-09-01T12:00:00.000Z",
          actor: "agent",
          kind: "run-exec",
          payload: { argv: ["bun", "test"] },
        } as unknown as HarnessEvent,
      ];
      const result = checkNeverUnattendedActions(cleanEvents, dummyState);
      expect(result.ok).toBe(true);
      expect(result.findings).toHaveLength(0);
      expect(result.violations).toHaveLength(0);
    });

    it("detects prohibited-action-attempted and never-unattended-violation with string reason or JSON fallback", () => {
      const events: HarnessEvent[] = [
        {
          schema: "harness-event-v1",
          sequence: 1,
          timestamp: "2026-09-01T12:00:00.000Z",
          actor: "agent",
          kind: "prohibited-action-attempted",
          payload: { reason: "Direct file deletion" },
        } as unknown as HarnessEvent,
        {
          schema: "harness-event-v1",
          sequence: 2,
          timestamp: "2026-09-01T12:00:00.000Z",
          actor: "agent",
          kind: "never-unattended-violation",
          payload: { code: 99 },
        } as unknown as HarnessEvent,
      ];
      const result = checkNeverUnattendedActions(events, dummyState);
      expect(result.ok).toBe(false);
      expect(result.violations).toEqual(["Direct file deletion", '{"code":99}']);
      expect(result.findings[0]).toBe(
        "never-unattended action violation at sequence 1: Direct file deletion",
      );
      expect(result.findings[1]).toBe(
        'never-unattended action violation at sequence 2: {"code":99}',
      );
    });

    it("detects prohibited command patterns across command strings and argv arrays", () => {
      for (const cmd of [
        "git push origin main",
        "git reset --hard HEAD~1",
        "rm -rf /",
        "chmod -R 777 .",
        "npm publish",
        "pkill -9 tmux",
      ]) {
        const events = [
          {
            schema: "harness-event-v1",
            sequence: 1,
            timestamp: "2026-09-01T12:00:00.000Z",
            actor: "agent",
            kind: "command-executed",
            payload: { command: cmd },
          },
        ] as unknown as HarnessEvent[];
        expect(checkNeverUnattendedActions(events, dummyState).ok).toBe(false);
      }
      const argvEvent = [
        {
          schema: "harness-event-v1",
          sequence: 2,
          timestamp: "2026-09-01T12:00:00.000Z",
          actor: "agent",
          kind: "run-exec",
          payload: { argv: ["pkill", "-9", "claude"] },
        },
        {
          schema: "harness-event-v1",
          sequence: 3,
          timestamp: "2026-09-01T12:00:00.000Z",
          actor: "agent",
          kind: "run-exec",
          payload: {},
        },
      ] as unknown as HarnessEvent[];
      expect(checkNeverUnattendedActions(argvEvent, dummyState).ok).toBe(false);
    });
  });

  describe("checkDeclinedCandidates and checkCharterDigestIntegrity", () => {
    it("evaluates candidates, missing reasons, and charter digest integrity cascades", () => {
      const state1 = {
        candidates: [
          { id: "c1", status: "declined", decline_reason: "Obsolete" },
          { id: "c2", status: "admitted" },
        ],
      } as unknown as RunState;
      const evts1 = [
        {
          schema: "harness-event-v1",
          sequence: 1,
          timestamp: "2026-09-01T12:00:00.000Z",
          actor: "agent",
          kind: "mind-candidate-declined",
          payload: { candidate_id: "c2", reason: "Rejected" },
        },
      ] as unknown as HarnessEvent[];
      expect(checkDeclinedCandidates(state1, evts1).ok).toBe(true);

      const stateBlank = {
        mind: { candidates: [{ id: "cb", status: "declined", decline_reason: "   " }] },
      } as unknown as RunState;
      expect(checkDeclinedCandidates(stateBlank, []).ok).toBe(false);

      const stateSha = { mind: { charter: { pinned_sha256: "sha-1" } } } as unknown as RunState;
      expect(checkCharterDigestIntegrity(stateSha, [], { currentSha: "sha-1" }).ok).toBe(true);
      expect(checkCharterDigestIntegrity(stateSha, [], { currentSha: "sha-2" }).ok).toBe(false);

      const ownerEvt = [
        {
          schema: "harness-event-v1",
          sequence: 1,
          timestamp: "2026-09-01T12:00:00.000Z",
          actor: "owner",
          kind: "owner-decision-recorded",
          payload: {},
        },
      ] as unknown as HarnessEvent[];
      expect(checkCharterDigestIntegrity(stateSha, ownerEvt, { currentSha: "sha-2" }).ok).toBe(
        true,
      );
    });
  });
});
