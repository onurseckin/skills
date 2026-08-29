export type {
  DigestFinding,
  DigestFailingGate,
  DigestEscalation,
  DigestDeclinedCandidate,
  DigestOpenProposal,
  EscalationDigestData,
  OwnerDigestData,
  BuildEscalationDigestOptions,
  BuildOwnerDigestOptions,
  FormatDigestOptions,
} from "./types.ts";

export { parseNowIso, normalizeCommandString } from "./types.ts";

export { extractRunSignals } from "./reader.ts";

export { buildEscalationDigest, buildOwnerDigest } from "./builder.ts";

export {
  formatCitation,
  formatFindingLine,
  formatGateLine,
  formatEscalationLine,
  formatDeclinedCandidateLine,
  formatOpenProposalLine,
  formatOwnerDigestMarkdown,
  formatEscalationDigestMarkdown,
} from "./formatter.ts";

export { formatMemoryDigestMarkdown } from "./formatter.ts";
