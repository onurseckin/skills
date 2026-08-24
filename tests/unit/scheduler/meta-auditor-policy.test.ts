import { describe, it, expect } from "bun:test";
import { MetaAuditorPolicy } from "../../../olt/scripts/src/engine/scheduler/meta-auditor-policy.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import type { AgentGrantRecord } from "../../../olt/scripts/src/core/contracts/agents.ts";

describe("MetaAuditorPolicy", () => {
  it("can be instantiated", () => {
    const policy = new MetaAuditorPolicy();
    expect(policy).toBeDefined();
  });

  describe("isMandatoryTarget", () => {
    it("returns true for repos containing /skills", () => {
      expect(MetaAuditorPolicy.isMandatoryTarget("/Users/foo/repos/skills")).toBe(true);
    });

    it("returns true for repos containing orchestrating-long-tasks", () => {
      expect(
        MetaAuditorPolicy.isMandatoryTarget("/Users/foo/.agents/skills/orchestrating-long-tasks"),
      ).toBe(true);
    });

    it("returns true for repos containing /olt", () => {
      expect(MetaAuditorPolicy.isMandatoryTarget("/Users/foo/project/olt/scripts")).toBe(true);
    });

    it("returns false for unrelated repositories", () => {
      expect(MetaAuditorPolicy.isMandatoryTarget("/Users/foo/repos/unrelated-app")).toBe(false);
    });
  });

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
        MetaAuditorPolicy.assertMetaAuditorRequired("/Users/foo/repos/external-repo", activeAgents);
      }).not.toThrow();
    });

    it("enforces mandatory meta-auditor when developing skills repo", () => {
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
        MetaAuditorPolicy.assertMetaAuditorRequired("/Users/foo/repos/skills", activeAgents);
      }).toThrow(HarnessError);
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
        MetaAuditorPolicy.assertMetaAuditorRequired("/Users/foo/repos/skills", activeAgents);
      }).not.toThrow();
    });

    it("passes when mind-auditor is actively registered", () => {
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
        MetaAuditorPolicy.assertMetaAuditorRequired("/Users/foo/repos/skills", activeAgents);
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
        MetaAuditorPolicy.assertMetaAuditorRequired("/Users/foo/repos/skills", activeAgents);
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
        MetaAuditorPolicy.assertMindAuditorRequired("/Users/foo/repos/external-repo", activeAgents);
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
        MetaAuditorPolicy.assertMindAuditorRequired("/Users/foo/repos/skills", activeAgents);
      }).toThrow(HarnessError);

      try {
        MetaAuditorPolicy.assertMindAuditorRequired("/Users/foo/repos/skills", activeAgents);
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
        MetaAuditorPolicy.assertMindAuditorRequired("/Users/foo/repos/skills", activeAgents);
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
        MetaAuditorPolicy.assertMindAuditorRequired("/Users/foo/repos/skills", activeAgents);
      }).not.toThrow();
    });
  });

  describe("assertSkillAuditorRequired", () => {
    it("returns immediately without throwing on non-mandatory target repo", () => {
      const activeAgents: readonly AgentGrantRecord[] = [
        {
          id: "orchestrator-1",
          role: "orchestrator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "local",
          granted_at: "2026-08-24T00:00:00.000Z",
          status: "active",
        },
      ];

      expect(() => {
        MetaAuditorPolicy.assertSkillAuditorRequired(
          "/Users/foo/repos/external-repo",
          activeAgents,
        );
      }).not.toThrow();
    });

    it("throws SKILL_AUDITOR_MANDATE_VIOLATION when skill-auditor or meta-auditor is missing", () => {
      const activeAgents: readonly AgentGrantRecord[] = [
        {
          id: "orchestrator-1",
          role: "orchestrator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "local",
          granted_at: "2026-08-24T00:00:00.000Z",
          status: "active",
        },
        {
          id: "mind-auditor-1",
          role: "mind-auditor",
          parent_agent_id: "orchestrator-1",
          parent_task_id: null,
          host: "local",
          granted_at: "2026-08-24T00:00:00.000Z",
          status: "active",
        },
      ];

      expect(() => {
        MetaAuditorPolicy.assertSkillAuditorRequired("/Users/foo/repos/skills", activeAgents);
      }).toThrow(HarnessError);

      try {
        MetaAuditorPolicy.assertSkillAuditorRequired("/Users/foo/repos/skills", activeAgents);
      } catch (err) {
        expect(err).toBeInstanceOf(HarnessError);
        expect((err as HarnessError).message).toContain("[SKILL_AUDITOR_MANDATE_VIOLATION]");
      }
    });

    it("passes when skill-auditor is present", () => {
      const activeAgents: readonly AgentGrantRecord[] = [
        {
          id: "orchestrator-1",
          role: "orchestrator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "local",
          granted_at: "2026-08-24T00:00:00.000Z",
          status: "active",
        },
        {
          id: "skill-auditor-1",
          role: "skill-auditor",
          parent_agent_id: "orchestrator-1",
          parent_task_id: null,
          host: "local",
          granted_at: "2026-08-24T00:00:00.000Z",
          status: "active",
        },
      ];

      expect(() => {
        MetaAuditorPolicy.assertSkillAuditorRequired("/Users/foo/repos/skills", activeAgents);
      }).not.toThrow();
    });

    it("passes when meta-auditor is present as fallback companion", () => {
      const activeAgents: readonly AgentGrantRecord[] = [
        {
          id: "orchestrator-1",
          role: "orchestrator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "local",
          granted_at: "2026-08-24T00:00:00.000Z",
          status: "active",
        },
        {
          id: "meta-auditor-1",
          role: "meta-auditor",
          parent_agent_id: "orchestrator-1",
          parent_task_id: null,
          host: "local",
          granted_at: "2026-08-24T00:00:00.000Z",
          status: "active",
        },
      ];

      expect(() => {
        MetaAuditorPolicy.assertSkillAuditorRequired("/Users/foo/repos/skills", activeAgents);
      }).not.toThrow();
    });
  });
});
