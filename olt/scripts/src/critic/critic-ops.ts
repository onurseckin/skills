export interface RequirementClause {
  id: string;
  clause: string;
  verified: boolean;
}

export function deconstructPromptBytes(prompt: string): RequirementClause[] {
  // Handle multi-line markdown clauses without losing inline link markdown.
  // Split by double newlines to treat markdown blocks/paragraphs as single clauses.
  const blocks = prompt.split(/(?:\r?\n){2,}/).filter((b) => b.trim().length > 0);
  return blocks.map((block, index) => ({
    id: `req-${index + 1}`,
    clause: block.trim(),
    verified: false,
  }));
}
