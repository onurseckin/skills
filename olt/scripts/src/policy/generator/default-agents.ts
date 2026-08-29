import type { AgentPolicy } from "../types/index.ts";

export function buildDefaultAgents(): Record<string, AgentPolicy> {
  const makeHosts = (mTier: "medium" | "high" | "xhigh", sInt?: number) => {
    const isExecution = mTier === "medium";
    return {
      antigravity: {
        model: "gemini-3.7-flash",
        model_tier: isExecution ? ("medium" as const) : ("high" as const),
        thinking_effort: isExecution ? ("medium" as const) : ("high" as const),
        max_tokens: 8192,
        ...(sInt !== undefined ? { scheduler: { interval_seconds: sInt, enabled: true } } : {}),
      },
      claude_code: {
        model: mTier === "xhigh" ? "claude-5-opus" : "claude-5-sonnet",
        model_tier: mTier,
        thinking_effort: isExecution ? ("medium" as const) : ("high" as const),
        max_tokens: 8192,
        ...(sInt !== undefined ? { scheduler: { interval_seconds: sInt, enabled: true } } : {}),
      },
      codex: {
        model: mTier === "xhigh" ? "gpt-5.6-sol" : "gpt-5.6-terra",
        model_tier: mTier,
        thinking_effort: isExecution ? ("medium" as const) : ("high" as const),
        max_tokens: 8192,
        ...(sInt !== undefined ? { scheduler: { interval_seconds: sInt, enabled: true } } : {}),
      },
      cursor: {
        model: "cursor-latest",
        model_tier: isExecution ? ("medium" as const) : ("high" as const),
        thinking_effort: isExecution ? ("medium" as const) : ("high" as const),
        max_tokens: 8192,
        ...(sInt !== undefined ? { scheduler: { interval_seconds: sInt, enabled: true } } : {}),
      },
    };
  };

  const valQuotas = {
    mandatory_cognitive_pushbacks: 5,
    max_adversarial_probes: 10,
    max_turns_per_task: 15,
    escalate_on_exhausted_adversarial: true,
  };
  const valRbac = { can_execute_shell: false, can_edit_code: false };

  return {
    mind_supervisor: {
      tier: 0,
      silent_daemon: true,
      rbac: {
        can_execute_shell: false,
        can_edit_code: false,
        allowed_spawns: ["orchestrator", "mind_auditor", "skill_auditor", "autonomic_watchdog"],
      },
      hosts: {
        antigravity: {
          model: "gemini-3.7-flash",
          model_tier: "high",
          thinking_effort: "high",
          max_tokens: 8192,
          scheduler: { cron: "*/5 * * * *", interval_seconds: 300, enabled: true },
        },
        claude_code: {
          model: "claude-5-opus",
          model_tier: "xhigh",
          thinking_effort: "high",
          max_tokens: 8192,
          scheduler: { cron: "*/15 * * * *", interval_seconds: 900, enabled: true },
        },
        codex: {
          model: "gpt-5.6-sol",
          model_tier: "xhigh",
          thinking_effort: "high",
          max_tokens: 8192,
          scheduler: { cron: "*/15 * * * *", interval_seconds: 900, enabled: true },
        },
        cursor: {
          model: "cursor-latest",
          model_tier: "high",
          thinking_effort: "high",
          max_tokens: 8192,
          scheduler: { cron: "*/5 * * * *", interval_seconds: 300, enabled: true },
        },
      },
    },
    orchestrator: {
      tier: 1,
      rbac: {
        can_execute_shell: true,
        can_edit_code: false,
        allowed_commands: ["bun harness.ts *", "git status", "git diff", "git log"],
        forbidden_patterns: ["^bun\\s+test\\b", "^npm\\s+test\\b", "^git\\s+(commit|push|reset)"],
        allowed_spawns: [
          "coordinator",
          "implementer",
          "validator_code_quality",
          "validator_ui_design",
          "completeness_critic",
        ],
      },
      hosts: makeHosts("xhigh"),
    },
    coordinator: {
      tier: 2,
      rbac: {
        can_execute_shell: true,
        can_edit_code: false,
        allowed_commands: [
          "bun harness.ts *",
          "git status",
          "git diff",
          "git commit",
          "git push",
          "git log",
        ],
        forbidden_patterns: ["^bun\\s+test\\b", "^npm\\s+test\\b"],
        allowed_spawns: [
          "implementer",
          "validator_code_quality",
          "validator_ui_design",
          "completeness_critic",
        ],
      },
      hosts: makeHosts("xhigh"),
    },
    implementer: {
      tier: 3,
      rbac: {
        can_execute_shell: true,
        can_edit_code: true,
        allowed_commands: [
          "bun test <target>",
          "bun run typecheck",
          "bun run lint",
          "git status",
          "git diff",
          "ls",
          "grep",
        ],
        forbidden_patterns: [
          "^git\\s+(commit|push|reset|checkout\\s+-b)",
          "^bun\\s+test\\s*$",
          "^npm\\s+test\\s*$",
        ],
      },
      hosts: makeHosts("medium"),
    },
    validator_code_quality: {
      tier: 3,
      domain: "code_quality",
      quotas: valQuotas,
      rbac: valRbac,
      hosts: makeHosts("medium"),
    },
    validator_ui_design: {
      tier: 3,
      domain: "ui_design",
      quotas: valQuotas,
      rbac: valRbac,
      hosts: makeHosts("medium"),
    },
    validator_security: {
      tier: 3,
      domain: "security",
      quotas: valQuotas,
      rbac: valRbac,
      hosts: makeHosts("medium"),
    },
    validator_system_design: {
      tier: 3,
      domain: "system_design",
      quotas: valQuotas,
      rbac: valRbac,
      hosts: makeHosts("medium"),
    },
    validator_product: {
      tier: 3,
      domain: "product",
      quotas: valQuotas,
      rbac: valRbac,
      hosts: makeHosts("medium"),
    },
    completeness_critic: {
      tier: 3,
      domain: "completeness",
      quotas: valQuotas,
      rbac: valRbac,
      hosts: makeHosts("medium"),
    },
    autonomic_watchdog: {
      tier: 0,
      silent_daemon: true,
      rbac: { can_execute_shell: false, can_edit_code: false },
      hosts: makeHosts("medium", 300),
    },
    owner: {
      tier: "independent",
      rbac: {
        can_execute_shell: true,
        can_edit_code: true,
        allowed_commands: [
          "agent:register",
          "authority:decide",
          "mind:admit",
          "mind:rotate",
          "recover",
          "doctor",
        ],
      },
      hosts: makeHosts("xhigh"),
    },
  };
}
