const SENSITIVE_KEY_EXACT_NAMES = new Set([
  "rawconfig",
  "accountuuid",
  "billingtype",
  "oauthaccount",
]);

const SENSITIVE_KEY_SUBSTRINGS: readonly string[] = [
  "key",
  "token",
  "secret",
  "password",
  "passwd",
  "credential",
  "cookie",
  "authorization",
  "email",
];

const REDACTED = "[REDACTED]";
const MAX_REDACT_DEPTH = 16;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_\-\s]/g, "");
}

export function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (SENSITIVE_KEY_EXACT_NAMES.has(normalized)) return true;
  return SENSITIVE_KEY_SUBSTRINGS.some((substring) => normalized.includes(substring));
}

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{10,}\b/g,
  /\bsess-[A-Za-z0-9_-]{10,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]{10,}/gi,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g,
  /((?:api[_-]?key|access[_-]?token|session[_-]?token|auth[_-]?token|refresh[_-]?token|secret)\s*[:=]\s*["']?)[A-Za-z0-9._-]{8,}(["']?)/gi,
];

export function redactSecretsInString(value: string): string {
  let result = value;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    result = result.replace(pattern, (_match, ...groups: unknown[]) => {
      if (groups.length >= 2 && typeof groups[0] === "string" && typeof groups[1] === "string") {
        return `${groups[0]}${REDACTED}${groups[1]}`;
      }
      return REDACTED;
    });
  }
  return result;
}

export function deepRedact(value: unknown, depth = 0): unknown {
  if (depth > MAX_REDACT_DEPTH) return REDACTED;

  if (Array.isArray(value)) {
    return value.map((item) => deepRedact(item, depth + 1));
  }

  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      out[key] = isSensitiveKey(key) ? REDACTED : deepRedact(source[key], depth + 1);
    }
    return out;
  }

  if (typeof value === "string") {
    return redactSecretsInString(value);
  }

  return value;
}

export function redactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return deepRedact(value) as Record<string, unknown>;
}

const ALLOWED_RAW_FIELD_NAMES: readonly string[] = [
  "canonicalprovider",
  "plan",
  "plantype",
  "plantier",
  "planname",
  "usertier",
  "availablecredits",
  "creditamount",
  "name",
  "resettime",
  "resetsat",
  "quotainfo",
  "remainingfraction",
  "remainingpercentage",
  "quotaremaining",
  "usedpercent",
  "utilization",
  "fivehour",
  "sevenday",
  "sevendayopus",
  "sevendaysonnet",
  "windowminutes",
  "totaltokenusage",
  "modelcontextwindow",
  "inputtokens",
  "cachedinputtokens",
  "outputtokens",
  "reasoningoutputtokens",
  "totaltokens",
  "version",
  "detectedvariables",
  "activeport",
  "queriedat",
  "storagepath",
  "command",
  "filepath",
];

const MAX_ALLOWLIST_DEPTH = 16;

export function isAllowedRawField(key: string): boolean {
  return ALLOWED_RAW_FIELD_NAMES.includes(normalizeKey(key));
}

export function allowlistProject(value: unknown, depth = 0): unknown {
  if (depth > MAX_ALLOWLIST_DEPTH) return undefined;

  if (Array.isArray(value)) {
    return value.map((item) => allowlistProject(item, depth + 1));
  }

  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      if (!isAllowedRawField(key)) continue;
      const projected = allowlistProject(source[key], depth + 1);
      if (projected !== undefined) {
        out[key] = projected;
      }
    }
    return out;
  }

  return value;
}

export function allowlistRecord(value: Record<string, unknown>): Record<string, unknown> {
  return allowlistProject(value) as Record<string, unknown>;
}
