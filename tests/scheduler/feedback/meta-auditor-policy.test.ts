import { describe, it, expect } from "bun:test";
import { SkillAuditorPolicy } from "../../../olt/scripts/src/engine/scheduler/diagnostics/skill-auditor-policy.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type { AgentGrantRecord } from "../../../olt/scripts/src/core/contracts/index.ts";

describe("MetaAuditorPolicy & MindAuditorPolicy (backward compatibility)", () => {
  describe("assertMetaAuditorRequired", () => {
    it("returns immediately without throwing on non-mandatory target repo", () => {
      const activeAgents: readonly AgentGrantRecord[] = [
        {
          id: "mind-1",
          role: "mind",
          parent_agent_id: null,
          parent_task_id: null,
          host: "local",
          granted_at: "2026-08-24T00:00:00.000Z",
          status: "active",
        },
      ];

      expect(() => {
        SkillAuditorPolicy.assertMetaAuditorRequired(
          "/Users/foo/repos/external-repo",
          activeAgents,
        );
      }).not.toThrow();
    });

    it("enforces mandatory skill-auditor when developing skills repo", () => {
      const activeAgents: readonly AgentGrantRecord[] = [
        {
          id: "mind-1",
          role: "mind",
          parent_agent_id: null,
          parent_task_id: null,
          host: "local",
          granted_at: "2026-08-24T00:00:00.000Z",
          status: "active",
        },
      ];

      expect(() => {
        SkillAuditorPolicy.assertMetaAuditorRequired("/Users/foo/repos/skills", activeAgents);
      }).toThrow(HarnessError);

      try {
        SkillAuditorPolicy.assertMetaAuditorRequired("/Users/foo/repos/skills", activeAgents);
      } catch (err) {
        expect(err).toBeInstanceOf(HarnessError);
        expect((err as HarnessError).message).toContain("[SKILL_AUDITOR_MANDATE_VIOLATION]");
      }
    });

    it("passes when meta-auditor is actively registered", () => {
      const activeAgents: readonly AgentGrantRecord[] = [
        {
          id: "mind-1",
          role: "mind",
          parent_agent_id: null,
          parent_task_id: null,
          host: "local",
          granted_at: "2026-08-24T00:00:00.000Z",
          status: "active",
        },
        {
          id: "meta-auditor-1",
          role: "meta-auditor",
          parent_agent_id: "mind-1",
          parent_task_id: null,
          host: "local",
          granted_at: "2026-08-24T00:00:00.000Z",
          status: "active",
        },
      ];

      expect(() => {
        SkillAuditorPolicy.assertMetaAuditorRequired("/Users/foo/repos/skills", activeAgents);
      }).not.toThrow();
    });

    it("passes when skill-auditor is actively registered", () => {
      const activeAgents: readonly AgentGrantRecord[] = [
        {
          id: "mind-1",
          role: "mind",
          parent_agent_id: null,
          parent_task_id: null,
          host: "local",
          granted_at: "2026-08-24T00:00:00.000Z",
          status: "active",
        },
        {
          id: "skill-auditor-1",
          role: "skill-auditor",
          parent_agent_id: "mind-1",
          parent_task_id: null,
          host: "local",
          granted_at: "2026-08-24T00:00:00.000Z",
          status: "active",
        },
      ];

      expect(() => {
        SkillAuditorPolicy.assertMetaAuditorRequired("/Users/foo/repos/skills", activeAgents);
      }).not.toThrow();
    });
  });

  describe("assertMindAuditorRequired", () => {
    it("returns immediately without throwing on non-mandatory target repo", () => {
      const activeAgents: readonly AgentGrantRecord[] = [
        {
          id: "mind-1",
          role: "mind",
          parent_agent_id: null,
          parent_task_id: null,
          host: "local",
          granted_at: "2026-08-24T00:00:00.000Z",
          status: "active",
        },
      ];

      expect(() => {
        SkillAuditorPolicy.assertMindAuditorRequired(
          "/Users/foo/repos/external-repo",
          activeAgents,
        );
      }).not.toThrow();
    });

    it("throws MIND_AUDITOR_MANDATE_VIOLATION when mind-auditor or meta-auditor is missing", () => {
      const activeAgents: readonly AgentGrantRecord[] = [
        {
          id: "mind-1",
          role: "mind",
          parent_agent_id: null,
          parent_task_id: null,
          host: "local",
          granted_at: "2026-08-24T00:00:00.000Z",
          status: "active",
        },
        {
          id: "skill-auditor-1",
          role: "skill-auditor",
          parent_agent_id: "mind-1",
          parent_task_id: null,
          host: "local",
          granted_at: "2026-08-24T00:00:00.000Z",
          status: "active",
        },
      ];

      expect(() => {
        SkillAuditorPolicy.assertMindAuditorRequired("/Users/foo/repos/skills", activeAgents);
      }).toThrow(HarnessError);

      try {
        SkillAuditorPolicy.assertMindAuditorRequired("/Users/foo/repos/skills", activeAgents);
      } catch (err) {
        expect(err).toBeInstanceOf(HarnessError);
        expect((err as HarnessError).message).toContain("[MIND_AUDITOR_MANDATE_VIOLATION]");
      }
    });

    it("passes when mind-auditor is present", () => {
      const activeAgents: readonly AgentGrantRecord[] = [
        {
          id: "mind-1",
          role: "mind",
          parent_agent_id: null,
          parent_task_id: null,
          host: "local",
          granted_at: "2026-08-24T00:00:00.000Z",
          status: "active",
        },
        {
          id: "mind-auditor-1",
          role: "mind-auditor",
          parent_agent_id: "mind-1",
          parent_task_id: null,
          host: "local",
          granted_at: "2026-08-24T00:00:00.000Z",
          status: "active",
        },
      ];

      expect(() => {
        SkillAuditorPolicy.assertMindAuditorRequired("/Users/foo/repos/skills", activeAgents);
      }).not.toThrow();
    });

    it("passes when meta-auditor is present as fallback companion", () => {
      const activeAgents: readonly AgentGrantRecord[] = [
        {
          id: "mind-1",
          role: "mind",
          parent_agent_id: null,
          parent_task_id: null,
          host: "local",
          granted_at: "2026-08-24T00:00:00.000Z",
          status: "active",
        },
        {
          id: "meta-auditor-1",
          role: "meta-auditor",
          parent_agent_id: "mind-1",
          parent_task_id: null,
          host: "local",
          granted_at: "2026-08-24T00:00:00.000Z",
          status: "active",
        },
      ];

      expect(() => {
        SkillAuditorPolicy.assertMindAuditorRequired("/Users/foo/repos/skills", activeAgents);
      }).not.toThrow();
    });
  });
});
