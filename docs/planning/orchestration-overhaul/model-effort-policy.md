# Model tier and reasoning-effort policy — evidence for a deferred decision

Status: **DEFERRED by the owner (2026-08-20).** Effort and model settings stay as they are. This file
exists so the decision can be made later from evidence rather than from memory.

Scope: the four applications in use — Claude Code, Antigravity (CLI and IDE), Codex/ChatGPT, Cursor.

---

## Does any of them pick a model by task difficulty?

**No.** Per-agent model assignment is available everywhere; difficulty-based routing exists nowhere.
In Claude Code, automatic selection by complexity is an open feature request, not a feature.

Claude Code resolution order, with no complexity input at any step:

```
1. CLAUDE_CODE_SUBAGENT_MODEL   env var — outranks everything, fails silently
2. the per-invocation `model` parameter
3. the agent definition's `model:` frontmatter
4. the main conversation's model          <- the default
```

Near-misses that are not difficulty routing: Claude may pass a per-call `model` by its own judgement
(no published heuristic); built-in helpers are pinned by TYPE (`claude-code-guide` -> Haiku); `opusplan`
switches on plan-vs-execute MODE; automatic fallback fires on SAFETY CLASSIFIERS.

Codex is the one host where per-agent selection is a first-class spawn parameter: `spawn_agent` takes
`model` and `reasoning_effort`.

## Thinking and effort are different dials

- **Extended thinking on/off** inherits from the session and has **no per-subagent setting**.
- **Reasoning effort** _does_ have one: `effort: low|medium|high|xhigh|max` in Claude Code frontmatter,
  `reasoning_effort` on a Codex spawn.

## The evidence (Anthropic's own measurements, July-August 2026)

The effort sweep is the cheap experiment, and most workloads end there:

> `low` gave up **1 to 3 points** for **a third to a half off** the cost per task;
> `medium` **matched the default's accuracy at 70% to 85%** of the cost.

Coordinator-plus-worker tiering **lost** to the coordinator's own model at lower effort in every measured
case except two: bulk work exceeding one context window, and tail insurance on routine work.

Haiku: about a tenth of Opus 5's cost per question, 63% vs 92% accuracy on GPQA Diamond, and much further
behind on long coding tasks. Suits high-volume work with checkable outputs, and scores 0% on long-horizon
planning tiers — give it one bounded question, never a multi-step loop.

**The widely-cited 2025 multi-agent post (Opus lead, Sonnet subagents, +90.2%) is contradicted by these
2026 measurements and was never retracted.** Design from the newer numbers.

## Traps

- **Never set `CLAUDE_CODE_SUBAGENT_MODEL`.** It outranks frontmatter and per-call parameters, applies to
  every subagent and workflow agent, and fails silently.
- The built-in `Explore` agent stopped being Haiku-pinned in v2.1.198 and now inherits the session model.
  Define your own agent named `Explore` with `model: haiku` if you want cheap search back.

## If the decision is taken later

The shape the evidence supports: **model mostly inherited, effort as the per-role dial.** Highest effort
for adversarial verification and architecture, where being wrong is expensive; medium for implementation
against a clear spec; low for mechanical work. Measure before widening it further.
