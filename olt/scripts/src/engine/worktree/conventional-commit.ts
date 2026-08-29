import { HarnessError } from "../../core/errors/index.ts";
import {
  CONVENTIONAL_COMMIT_TYPES,
  type ConventionalCommitMessage,
  type FormatConventionalCommitInput,
  type CommitValidationResult,
} from "./phase-types.ts";

export function formatConventionalCommit(input: FormatConventionalCommitInput): string {
  const type = input.type.trim().toLowerCase();
  if (!CONVENTIONAL_COMMIT_TYPES.has(type)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Invalid commit type '${input.type}'. Must be one of: ${Array.from(CONVENTIONAL_COMMIT_TYPES).join(", ")}`,
    );
  }
  const desc = input.description.trim();
  if (desc === "") {
    throw new HarnessError("INVALID_ARGUMENT", "Commit description cannot be empty");
  }

  const scope = input.scope !== undefined ? input.scope.trim().toLowerCase() : undefined;
  const breakingMark = input.isBreaking ? "!" : "";
  const headerPrefix =
    typeof scope === "string" && scope.length > 0
      ? `${type}(${scope})${breakingMark}: `
      : `${type}${breakingMark}: `;
  const header = `${headerPrefix}${desc}`;

  const sections: string[] = [header];

  if (input.body !== undefined && input.body.trim() !== "") {
    sections.push(input.body.trim());
  }

  if (
    input.breakingChangeDescription !== undefined &&
    input.breakingChangeDescription.trim() !== ""
  ) {
    sections.push(`BREAKING CHANGE: ${input.breakingChangeDescription.trim()}`);
  }

  if (input.issuesClosed !== undefined && input.issuesClosed.length > 0) {
    const issues = input.issuesClosed.map((i) => i.trim()).filter((i) => i.length > 0);
    if (issues.length > 0) {
      sections.push(`Closes: ${issues.join(", ")}`);
    }
  }

  return sections.join("\n\n");
}

export function formatConventionalCommitMessage(input: FormatConventionalCommitInput): string {
  return formatConventionalCommit(input);
}

export function validatePhaseCommitMessage(message: string): CommitValidationResult {
  const errors: string[] = [];
  if (typeof message !== "string" || message.trim() === "") {
    return { valid: false, errors: ["Commit message cannot be empty"] };
  }

  const lines = message.split(/\r?\n/);
  const firstLine = lines[0];
  const header = typeof firstLine === "string" ? firstLine.trim() : "";

  const headerRegex = /^([a-zA-Z0-9_-]+)(?:\(([a-zA-Z0-9_/-]+)\))?(!)?:\s+(.+)$/u;
  const match = headerRegex.exec(header);

  if (!match) {
    errors.push(
      `Commit header '${header}' does not conform to Conventional Commits format '<type>(<scope>): <description>' or '<type>: <description>'`,
    );
    return { valid: false, errors };
  }

  const type = match[1]!.toLowerCase();
  const scope = match[2] ? match[2].toLowerCase() : undefined;
  let isBreaking = match[3] === "!";
  const description = match[4]!.trim();

  if (!CONVENTIONAL_COMMIT_TYPES.has(type)) {
    errors.push(
      `Commit type '${type}' is not recognized. Must be one of: ${Array.from(CONVENTIONAL_COMMIT_TYPES).join(", ")}`,
    );
  }

  if (description === "") {
    errors.push("Commit header description cannot be empty");
  }

  if (lines.length > 1 && lines[1]!.trim() !== "") {
    errors.push("Header must be separated from body by an empty line");
  }

  let breakingChangeDescription: string | undefined;
  const issuesClosed: string[] = [];
  const bodyParagraphs: string[] = [];

  let currentParagraph: string[] = [];
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") {
      if (currentParagraph.length > 0) {
        processParagraph(currentParagraph.join("\n"));
        currentParagraph = [];
      }
    } else {
      currentParagraph.push(line);
    }
  }
  if (currentParagraph.length > 0) {
    processParagraph(currentParagraph.join("\n"));
  }

  function processParagraph(para: string): void {
    const trimmed = para.trim();
    if (/^BREAKING[\s-]CHANGE:\s+/u.test(trimmed)) {
      isBreaking = true;
      breakingChangeDescription = trimmed.replace(/^BREAKING[\s-]CHANGE:\s+/u, "").trim();
    } else if (/^(?:Closes|Fixes|Resolves|Refs):\s+/iu.test(trimmed)) {
      const issueText = trimmed.replace(/^(?:Closes|Fixes|Resolves|Refs):\s+/iu, "").trim();
      const ids = issueText
        .split(/[,;\s]+/u)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      issuesClosed.push(...ids);
    } else {
      bodyParagraphs.push(trimmed);
    }
  }

  const body = bodyParagraphs.length > 0 ? bodyParagraphs.join("\n\n") : undefined;

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const parsed: ConventionalCommitMessage = {
    type,
    ...(scope ? { scope } : {}),
    isBreaking,
    description,
    ...(body ? { body } : {}),
    ...(breakingChangeDescription ? { breakingChangeDescription } : {}),
    ...(issuesClosed.length > 0 ? { issuesClosed } : {}),
    raw: message,
  };

  return {
    valid: true,
    errors: [],
    parsed,
  };
}

export function assertConventionalCommitCompliance(
  message: string | ConventionalCommitMessage,
): void {
  const raw = typeof message === "string" ? message : message.raw;
  const result = validatePhaseCommitMessage(raw);
  if (!result.valid) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Conventional commit compliance violation: ${result.errors.join("; ")}`,
      result.errors.map((error) => ({ error })),
      3,
      "Ensure commit message follows conventional commit format (e.g. feat(domain): description).",
    );
  }
}
