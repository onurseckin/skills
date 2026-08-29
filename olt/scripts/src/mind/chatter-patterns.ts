export const OWNER_INTERACTIVE_RECIPIENTS = new Set([
  "human",
  "user",
  "stdout",
  "interactive",
  "console",
  "terminal",
  "owner",
  "main-thread",
  "root",
]);

export const ROUTINE_PULSE_PATTERNS: readonly RegExp[] = [
  /^\s*\[?(?:pulse|heartbeat|tick|liveness|cadence|interval|poll)\s*(?:tick|update|check|ping|ack|beat)?\]?\s*:/i,
  /\b(?:routine\s+pulse|background\s+tick|liveness\s+ping|heartbeat\s+pulse|cadence\s+poll|scheduled\s+tick)\b/i,
  /\bpulse\s+#?\d+\s+(?:nominal|quiescent|idle|ticking|alive|active|started|finished)\b/i,
  /\bheartbeat\s+(?:nominal|ok|ping|pong|alive|ticking)\b/i,
  /\bperiodic\s+(?:scan|poll|check|inspection)\s+(?:nominal|running|completed)\b/i,
  /\bbackground\s+liveness\s+check\b/i,
];

export const COMPANION_AUDIT_PATTERNS: readonly RegExp[] = [
  /^\s*\[?(?:companion|witness|auditor|cognitive-witness|meta-auditor)\s*(?:audit|trace|scan|finding|observation)?\]?\s*:/i,
  /\b(?:companion\s+auditor|cognitive\s+witness|meta-auditor|routine\s+audit\s+scan|witness\s+trace)\b/i,
  /\baudit\s+cycle\s+#?\d+\s+(?:nominal|passed|observing|in\s+progress|clean)\b/i,
  /\bcognitive\s+flavor\s+(?:evaluation|score|vector|matrix|poll)\b/i,
  /\broutine\s+questionnaire\s+evaluation\b/i,
  /\bwitness\s+observation\s+recorded\b/i,
];

export const PROGRESS_NARRATION_PATTERNS: readonly RegExp[] = [
  /^\s*\[?(?:status|progress|mid-flight)\s*(?:update|report|notice|ping)?\]?\s*:/i,
  /\b(?:status|progress|mid-flight)\s+(?:update|report|ping|check|notice)\b/i,
  /\bstep\s+\d+\s*(?:\/|\s+of\s+)\s*\d+/i,
  /\bstep\s+\d+\s*:\s*(?:in\s+progress|started|starting|executing|complete|done)/i,
  /\b(?:now\s+)?executing\s+step\b/i,
  /\b(?:i am|i'm|currently)\s+(?:now\s+)?(?:executing|running|dispatching|processing|working\s+on)\b/i,
  /\b(?:dispatching|spawning)\s+(?:subagent|worker|agent|task)\b/i,
  /\bwaiting\s+for\s+(?:subagent|worker|agent|task\s+completion)\b/i,
  /\bworker\s+(?:dispatched|assigned|spawned|started|running|working)\b/i,
];

export const ACTIONABLE_ERROR_PATTERNS: readonly RegExp[] = [
  /^\s*\[?(?:fatal|critical|panic|alert|escalation|fatal_trap)\]?\s*:/i,
  /\b(?:fatal\s+trap|critical\s+fault|panic|unrecoverable\s+error|invariant\s+violation|role_confinement_violation|crash_threshold_exceeded|defect\s+escalation|hardware_fault)\b/i,
  /\bactionable\s+error\s+detected\b/i,
];

export const HIGH_PRIORITY_MILESTONE_PATTERNS: readonly RegExp[] = [
  /^\s*\[?(?:milestone|deliverable|handoff|final\s+output|completion|release)\]?\s*:/i,
  /\b(?:milestone\s+achieved|task\s+completed\s+successfully|objective\s+fulfilled|deliverable\s+ready|all\s+\d+\s+tests\s+pass(?:ing)?\s+with\s+0\s+failures)\b/i,
  /\bfinal\s+deliverable\b/i,
  /\bmission\s+accomplished\b/i,
];

export const isOwnerInteractiveRecipient = (recipient?: string): boolean =>
  typeof recipient === "string" &&
  recipient.trim().length > 0 &&
  OWNER_INTERACTIVE_RECIPIENTS.has(recipient.trim().toLowerCase());

export const matchesAny = (text: string, patterns: readonly RegExp[]): boolean =>
  typeof text === "string" && text.trim().length > 0 && patterns.some((p) => p.test(text.trim()));
