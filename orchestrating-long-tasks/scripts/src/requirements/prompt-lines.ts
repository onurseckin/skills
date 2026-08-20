// Unicode line terminators, not just LF/CRLF: the validator numbers prompt lines with this set, so
// the compiler must split on exactly the same one or a prompt containing VT, FF, NEL or U+2028/9
// compiles requirements whose source_lines the validator then rejects as an INTEGRITY failure.
const TERMINATOR_SOURCE = String.raw`\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]`;
const TERMINATOR = new RegExp(TERMINATOR_SOURCE, "u");
const TRAILING_TERMINATOR = new RegExp(`(?:${TERMINATOR_SOURCE})$`, "u");

export function promptLines(prompt: string): string[] {
  if (prompt.length === 0) return [];
  const lines = prompt.split(TERMINATOR);
  if (TRAILING_TERMINATOR.test(prompt)) lines.pop();
  return lines;
}
