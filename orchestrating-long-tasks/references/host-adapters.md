# Host adapters

The harness never creates agents itself. It produces durable packets and state; the current host
application dispatches native agents and returns their structured evidence.

## Codex and ChatGPT coding agents

- Discover the canonical skill at `.agents/skills/orchestrating-long-tasks` in a repository or
  `~/.agents/skills/orchestrating-long-tasks` globally.
- Use native collaboration/subagent tools for dependency-ready packets. Respect the environment's
  reported concurrency even if the graph can expose more work.
- Give each subagent the immutable packet path/content, exclusive write scope, and focused commands.
- Keep implementer, spec reviewer, quality reviewer, and completeness critic as distinct identities.
- The coordinator alone advances durable state with the pinned CLI.

## Claude Code

- Discover through `.claude/skills/orchestrating-long-tasks`, linked to the repository canonical
  skill, or `~/.claude/skills/...`, linked to the global canonical copy.
- Use Claude Code subagents or agent teams when enabled. Teammates claim disjoint ready tasks; the
  lead owns the capsule and merge/validation transitions.
- Hooks may trigger heartbeats or watchdog reactions, but hook output is never authoritative state.

## Antigravity

- Discover the global link at `~/.gemini/config/skills/orchestrating-long-tasks`; repository agents
  may use the canonical `.agents/skills` copy.
- Dispatch Manager-view agents only for ready nonconflicting packets. Record artifacts and feedback
  through the harness rather than relying on conversation history.
- Treat browser/UI execution as command evidence only after its artifacts are imported and validated.

## Sequential fallback

When native subagents are unavailable, keep the same graph, leases, packets, independent review
roles, and gates, but execute one ready task at a time. A role switch must use a fresh context when
the host supports it. If independence cannot be established, mark validation blocked; do not let the
implementer self-approve.

## Prohibited adapters

- model-provider HTTP APIs, SDKs, tokens, or credentials;
- shell commands that launch Codex, Claude, Gemini, Antigravity, or another LLM client;
- in-memory queues presented as durable coordination;
- simulated validator identities inside the same contaminated implementer context.
