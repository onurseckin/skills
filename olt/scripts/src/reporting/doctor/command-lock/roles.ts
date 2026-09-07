export const BANNED_VALIDATOR_ROLES = new Set([
  "validator",
  "cognitive-validator",
  "cognitive_validator",
  "socratic-validator",
  "socratic_validator",
  "plan-validator",
]);

export const IMPLEMENTER_ROLES = new Set([
  "implementer",
  "developer",
  "coder",
  "worker",
  "sub-implementer",
  "custom-implementer",
]);

export const normalizeRole = (role: string): string =>
  role.trim().toLowerCase().replace(/_/gu, "-");

export const isMechanicValidatorRole = (role: string): boolean => {
  const norm = normalizeRole(role);
  return norm === "ui-headless-validator" || norm.startsWith("ui-headless-validator-");
};

export const isValidatorRole = (role: string): boolean => {
  const norm = normalizeRole(role);
  if (isMechanicValidatorRole(norm)) return false;
  return (
    BANNED_VALIDATOR_ROLES.has(norm) ||
    BANNED_VALIDATOR_ROLES.has(role.trim().toLowerCase()) ||
    norm.startsWith("validator") ||
    norm.includes("validator") ||
    norm.includes("critic")
  );
};

export const isImplementerRole = (role: string): boolean => {
  const norm = normalizeRole(role);
  return (
    IMPLEMENTER_ROLES.has(norm) ||
    norm.startsWith("implementer") ||
    norm.includes("implementer") ||
    norm.includes("worker")
  );
};
