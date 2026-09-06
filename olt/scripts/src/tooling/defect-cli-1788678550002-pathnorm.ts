export const DEFECT_ID = "defect-cli-1788678550002-pathnorm";
export const ERROR_CODE = "INTEGRITY_RESOLUTION_ERROR";
export const DEFECT_TITLE =
  "Defect Remediation: run:status --run wave-47 fails integrity verification looking for wave-47 in cwd rather than normalizing to .olt/capsules/wave-47 like other commands";

export interface PathNormalizationContext {
  readonly rawRunIdentifier: string;
  readonly baseDirectory?: string;
  readonly cwd?: string;
}

export interface PathNormalizationResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly normalizedCapsulePath: string;
  readonly isAbsolute: boolean;
  readonly wasNormalized: boolean;
}

export function normalizeCapsuleRunPath(
  context: PathNormalizationContext,
): PathNormalizationResult {
  const { rawRunIdentifier, baseDirectory = ".olt/capsules" } = context;

  const trimmed = rawRunIdentifier.trim();

  if (trimmed.startsWith("/") || trimmed.startsWith(".olt/capsules/")) {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      normalizedCapsulePath: trimmed,
      isAbsolute: trimmed.startsWith("/"),
      wasNormalized: false,
    };
  }

  const cleanBase = baseDirectory.endsWith("/") ? baseDirectory.slice(0, -1) : baseDirectory;
  const normalized = `${cleanBase}/${trimmed}`;

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    normalizedCapsulePath: normalized,
    isAbsolute: false,
    wasNormalized: true,
  };
}
