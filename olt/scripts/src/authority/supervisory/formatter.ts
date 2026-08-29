import { loadUnifiedAgentModel, normalizeRoleName } from "../manifest/index.ts";
import { evaluateSupervisoryState } from "./evaluator.ts";
import { parseTimeMs } from "./protocols.ts";
import type {
  SupervisoryPersonaReminder,
  SupervisoryPersonaReminderOptions,
  SupervisoryReminderEvaluationContext,
} from "./types.ts";

export function constructSupervisoryPersonaReminder(
  options: SupervisoryPersonaReminderOptions,
): SupervisoryPersonaReminder {
  const role = normalizeRoleName(options.role);
  const unifiedModel = loadUnifiedAgentModel(role, options.manifestLoaderOptions);

  const cadenceMs = options.cadenceMs ?? 180_000; // 3 minutes
  const nowMs = parseTimeMs(options.now);
  const startedAtMs = options.startedAt !== undefined ? parseTimeMs(options.startedAt) : nowMs;
  const elapsedMs = Math.max(0, nowMs - startedAtMs);

  let tickNumber = options.tickNumber;
  if (tickNumber === undefined) {
    tickNumber = Math.max(1, Math.floor(elapsedMs / cadenceMs) + 1);
  }

  const timestamp = new Date(nowMs).toISOString();
  const id = `persona-reminder-${role}-tick${tickNumber}-${nowMs.toString(36)}`;

  // Evaluate active state
  const evalContext: SupervisoryReminderEvaluationContext = options.context
    ? {
        ...options.context,
        agentId: options.context.agentId ?? options.agentId,
        role: options.context.role ?? role,
        tickNumber: options.context.tickNumber ?? tickNumber,
        cadenceMs: options.context.cadenceMs ?? cadenceMs,
        now: options.context.now ?? nowMs,
      }
    : {
        role,
        agentId: options.agentId,
        runId: options.runId,
        pulseId: options.pulseId,
        tickNumber,
        cadenceMs,
        now: nowMs,
      };

  const evaluation = evaluateSupervisoryState(evalContext, unifiedModel);

  // Markdown Construction
  const lines: string[] = [];
  lines.push(`### 🛡️ Supervisory Persona & Responsibility Reminder [Tick #${tickNumber}]`);
  lines.push(`- **Role**: \`${role.toUpperCase()}\` (Tier ${unifiedModel.tier})`);
  lines.push(`- **Display Name**: ${unifiedModel.displayName}`);
  lines.push(`- **Archetype**: ${unifiedModel.archetype}`);
  lines.push(`- **Timestamp**: \`${timestamp}\` (Cadence: ${Math.round(cadenceMs / 1000)}s)`);
  if (options.runId) lines.push(`- **Run ID**: \`${options.runId}\``);
  if (options.pulseId) lines.push(`- **Pulse ID**: \`${options.pulseId}\``);
  if (options.agentId) lines.push(`- **Agent ID**: \`${options.agentId}\``);
  lines.push("");

  lines.push(`> [!NOTE]\n> **Core Mandate**: ${unifiedModel.coreMandate}\n`);

  // Section 1: Binding Authorities ('may') & Absolute Prohibitions ('must_not')
  lines.push("#### 📜 Binding Capability Contract (`roles/" + role + ".md`)");
  lines.push("**Permitted Authorities (`may`):**");
  for (const m of unifiedModel.may) {
    lines.push(`- 🟢 ${m}`);
  }
  lines.push("");

  lines.push("**Absolute Prohibitions (`must_not`):**");
  for (const mn of unifiedModel.mustNot) {
    lines.push(`- 🔴 ${mn}`);
  }
  lines.push("");

  // Section 2: Core Decision Protocols
  lines.push("#### 🧠 Standing Decision Protocols");
  for (const proto of evaluation.applicableDecisionProtocols) {
    lines.push(`##### 📐 ${proto.name} (\`${proto.formulaOrRule}\`)`);
    lines.push(`*Summary*: ${proto.summary}`);
    lines.push(`*Key Invariants*:`);
    for (const inv of proto.keyInvariants) {
      lines.push(`  - ⚖️ ${inv}`);
    }
    lines.push(`*Guidance*: ${proto.operationalGuidance}`);
    lines.push("");
  }

  // Section 3: Active Responsibility Checklist
  lines.push("#### 📋 Role Responsibility Checklist Evaluation");
  for (const item of evaluation.checklist) {
    const statusEmoji =
      item.status === "completed"
        ? "✅ COMPLETED"
        : item.status === "violated"
          ? "❌ VIOLATED"
          : item.status === "neglected"
            ? "⚠️ NEGLECTED"
            : "⏳ PENDING";
    lines.push(`- **[${statusEmoji}] ${item.title}** (\`${item.id}\` / ${item.category})`);
    if (item.reason) {
      lines.push(`  *Issue*: ${item.reason}`);
    }
    if (item.correctiveDirective) {
      lines.push(`  *Directive*: 🚨 ${item.correctiveDirective}`);
    }
  }
  lines.push("");

  // Section 4: Corrective Directives (if any)
  if (evaluation.correctiveDirectives.length > 0) {
    lines.push("#### 🚨 Immediate Corrective Directives");
    for (let i = 0; i < evaluation.correctiveDirectives.length; i++) {
      lines.push(`${i + 1}. ⚡ ${evaluation.correctiveDirectives[i]}`);
    }
    lines.push("");
  }

  const renderedMarkdown = lines.join("\n");

  const compactDirectives =
    evaluation.correctiveDirectives.length > 0
      ? ` DIRECTIVES: ${evaluation.correctiveDirectives.join(" | ")}`
      : "";
  const compactPromptInjection = `[PERSONA REMINDER Tick #${tickNumber}]: Role=${role.toUpperCase()} (Tier ${unifiedModel.tier}). Mandate: ${unifiedModel.coreMandate}. Invariants: (1) Zero direct file edits on supervisory threads; (2) P=W/S Work/Span continuous wave dispatch; (3) 4-tier multi-viewport validation; (4) Quantitative gate proofs only.${compactDirectives}`;

  const heartbeatTickBrief = `Heartbeat Tick #${tickNumber} [${role.toUpperCase()}]: ${evaluation.summary}`;

  return {
    id,
    role,
    tier: unifiedModel.tier,
    agentId: options.agentId ?? null,
    runId: options.runId ?? null,
    pulseId: options.pulseId ?? null,
    tickNumber,
    timestamp,
    cadenceMs,
    elapsedMs,
    persona: {
      name: unifiedModel.name,
      displayName: unifiedModel.displayName,
      shortDescription: unifiedModel.shortDescription,
      archetype: unifiedModel.archetype,
      coreMandate: unifiedModel.coreMandate,
      may: unifiedModel.may,
      mustNot: unifiedModel.mustNot,
      commands: unifiedModel.commands,
      spawns: unifiedModel.spawns,
      instructions: unifiedModel.instructions,
    },
    decisionProtocols: evaluation.applicableDecisionProtocols,
    checklist: evaluation.checklist,
    evaluation,
    correctiveDirectives: evaluation.correctiveDirectives,
    renderedMarkdown,
    compactPromptInjection,
    heartbeatTickBrief,
  };
}
