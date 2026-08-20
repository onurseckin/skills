# Code quality checklist
Domain: code-quality

Every task draws this checklist (B12.2): whatever else a change touches, it is also code, and this
is the standing bar for structure, naming, duplication, dead code, error handling, types, tests,
comments, style and commit hygiene. An item flagged outside the task's own write scope is an
adjacent finding (B12.1), not a task-scope blocker.

## CQ-STRUCT-001

rule: A function or module has one reason to change; a diff that mixes unrelated concerns belongs in two commits
rationale: Mixed concerns are what make a later, unrelated diff touch code it does not understand
how-to-check: Read the diff's file list against its stated summary; a file with no plausible link to the summary is a smell
severity: important
sources:
  - Clean Code (Robert C. Martin), ch. 3 "Functions"
  - Google Engineering Practices — Code Review, "Design"

## CQ-STRUCT-002

rule: A new abstraction earns its place only once a second concrete need for it exists
rationale: Speculative generality adds indirection a reader must trace through for a case that may never arrive
how-to-check: For every new interface, base class or plugin point, find the second caller in the same diff; absent one, flag it
severity: minor
sources:
  - YAGNI (Extreme Programming principle)

## CQ-NAMING-001

rule: A name states what a thing is or does, not how it was implemented or when it was added
rationale: An implementation detail in a name (`v2`, `newHelper`, `tmpFix`) outlives the context that made it accurate
how-to-check: Grep the diff for `temp`, `tmp`, `new`, `old`, `v2`, `fixed`, `helper` in identifiers; each is a candidate rename
severity: minor
sources:
  - Clean Code (Robert C. Martin), ch. 2 "Meaningful Names"

## CQ-NAMING-002

rule: A boolean reads as a predicate (`isReady`, `hasFinding`), and a collection name is plural
rationale: A name that does not match its type forces the reader to hold a translation in their head at every call site
how-to-check: Scan new declarations for a `boolean` typed without an `is`/`has`/`can` prefix, or an array typed with a singular name
severity: minor
sources:
  - Clean Code (Robert C. Martin), ch. 2 "Meaningful Names"

## CQ-DUP-001

rule: A third copy of near-identical logic is extracted; a second copy is watched, not yet extracted
rationale: Premature extraction on the first duplicate often guesses the wrong shared abstraction; three copies name the real one
how-to-check: Diff the new code against the two nearest existing call sites doing the same thing; three near-identical bodies is the threshold
severity: important
sources:
  - Refactoring (Martin Fowler), "Rule of Three"

## CQ-DUP-002

rule: A constant, threshold or vocabulary list used in two places is declared once and imported, not retyped
rationale: A retyped literal drifts silently the day one copy is edited and the other is forgotten
how-to-check: Grep the touched files and their neighbors for the same literal value or string outside the new declaration
severity: important
sources:
  - The Pragmatic Programmer, "DRY — Don't Repeat Yourself"

## CQ-DEAD-001

rule: Every export a diff adds has at least one caller outside its own test file, or is queued in the same diff with the caller that will use it
rationale: An unreachable export typechecks and tests green while doing nothing at runtime — the exact shape of a signed-off fabrication
how-to-check: Grep the whole tree for the export's name; a hit count of one (its own definition) or two (definition plus its unit test) is unreachable
severity: critical
sources:
  - This repository's B33 (wire vs delete)

## CQ-DEAD-002

rule: A removed feature's tests, fixtures, mocks and config flags are removed in the same diff, not left orphaned
rationale: A fixture nothing references is not evidence of anything; a stale mock can silently mask a real regression
how-to-check: For every deletion, grep the removed symbol's name across `tests/` and config files for leftover references
severity: minor
sources:
  - Refactoring (Martin Fowler), "Dead Code"

## CQ-ERR-001

rule: A caught error is logged, rethrown, or turned into a typed result — never swallowed into an empty catch
rationale: A swallowed error erases the one signal that would have shown the failure to the next person to look
how-to-check: Grep the diff for `catch` blocks with an empty or comment-only body
severity: critical
sources:
  - Google Engineering Practices — Code Review, "Error Handling"

## CQ-ERR-002

rule: An error message names what failed and what value or state caused it, not just that something went wrong
rationale: "Invalid input" sends the next debugger back to the repro step this message could have skipped
how-to-check: Read every new thrown error's message string; confirm it embeds the offending value or path
severity: minor
sources:
  - The Pragmatic Programmer, "Design by Contract"

## CQ-TYPES-001

rule: A value read from outside the type system (HTTP body, JSON column, subprocess output, third-party SDK) is typed `unknown` and narrowed with a guard, never cast through `any`
rationale: A cast through `any` deletes the compiler's ability to catch every future misuse of that value, not just this one
how-to-check: Grep the diff for `any`, `as any`, `<any>`, `Record<string, any>`, and unchecked casts on parsed JSON
severity: critical
sources:
  - TypeScript Handbook, "unknown vs any"

## CQ-TYPES-002

rule: A union type that models a finite real-world set (status, role, kind) is matched exhaustively, with a compiler-enforced `never` default
rationale: A non-exhaustive switch silently does nothing for a variant added next month, and nothing marks the gap
how-to-check: For a new switch over a closed union, confirm a `default` branch assigns the remaining value to a `never`-typed variable
severity: important
sources:
  - Effective TypeScript (Dan Vanderkam), Item 9

## CQ-TEST-001

rule: A test asserts current, observable behaviour — never a past implementation, a removed feature, or a migration step
rationale: A test that pins history rather than behaviour blocks the next legitimate change for a reason nobody can explain
how-to-check: Read new test descriptions and comments for phrases like "used to", "after the migration", "previously"
severity: important
sources:
  - This repository's standing instruction against tests referencing past state

## CQ-TEST-002

rule: A bug fix ships with a regression test that fails on the pre-fix code and passes on the post-fix code
rationale: A fix without a red-then-green test is unverified that it fixes the reported case rather than a nearby one
how-to-check: Check out the diff's parent commit, apply only the new test, and confirm it fails before the fix lands
severity: important
sources:
  - Test-Driven Development by Example (Kent Beck)

## CQ-TEST-003

rule: A test's assertions would fail if the behaviour under test broke; a test with no assertion on the actual outcome (only "it doesn't throw") is a false positive waiting to happen
rationale: A test that always passes regardless of correctness is worse than no test — it reads as coverage in a report
how-to-check: For each new test, identify the specific expect() that would fail if the implementation were reverted; a missing one is the finding
severity: important
sources:
  - Google Engineering Practices — Code Review, "Tests"

## CQ-DOC-001

rule: A comment explains why a choice was made, a gotcha, or a contract subtlety — never what the next line already says
rationale: A restated comment drifts from the code the moment either changes and nobody notices, since removing it changes nothing observable
how-to-check: For each new comment, delete it mentally and ask whether the line below is still just as clear; if so, flag it
severity: minor
sources:
  - Clean Code (Robert C. Martin), ch. 4 "Comments"

## CQ-DOC-002

rule: A public function whose correct use depends on call order, ownership transfer, or a precondition states that contract at the definition, not only in a caller's comment
rationale: A contract documented only where it happens to be obeyed today is invisible to the next caller who breaks it
how-to-check: For an exported function taking a token, handle or lease, confirm its doc comment states who releases it and when
severity: minor
sources:
  - The Pragmatic Programmer, "Design by Contract"

## CQ-STYLE-001

rule: A new file's formatting, import ordering and naming convention match its immediate siblings, not a different part of the codebase
rationale: A file that reads like it came from a different project raises the cost of every future diff that touches it
how-to-check: Diff the new file's import block and top-level structure against two existing files in the same directory
severity: minor
sources:
  - Google Engineering Practices — Code Review, "Style"

## CQ-STYLE-002

rule: A file stays under the codebase's stated size cap; a file that grows past it is split along an existing seam, not merely trimmed
rationale: A file past the cap is a signal the module is doing more than one job, which the cap exists to surface early
how-to-check: `wc -l` every touched file; a file over the stated cap with no split plan is the finding
severity: minor
sources:
  - This repository's standing 500-line cap

## CQ-GIT-001

rule: A commit's subject uses an approved Conventional Commits prefix, stays under 70 characters, and states why the change was made
rationale: A commit history that follows one grammar is the only reason `git log`, changelogs and bisects stay usable at scale
how-to-check: Read the subject line against the approved prefix list and the character count
severity: minor
sources:
  - Conventional Commits v1.0.0

## CQ-GIT-002

rule: A commit does not carry a suppressed lint or type error (`@ts-ignore`, `eslint-disable`) as its fix
rationale: A suppression comment is a promise the underlying defect was accepted, not resolved, and it silently ages past the context that justified it
how-to-check: Grep the diff for `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `eslint-disable`, `oxlint-disable`, `v8 ignore`
severity: critical
sources:
  - This repository's standing prohibition on suppression comments

## CQ-PERF-001

rule: A loop that does I/O, a database call or a subprocess spawn per iteration is batched or justified, not left as an accidental N+1
rationale: An N+1 pattern is invisible at small N in a test fixture and becomes the dominant cost the moment real data arrives
how-to-check: Grep new loop bodies for `await`, `fetch`, `query`, or `exec` calls whose argument varies per iteration
severity: important
sources:
  - Database Internals (Alex Petrov), ch. on query patterns

## CQ-PERF-002

rule: A value computed once per call is not recomputed inside a hot loop it does not depend on
rationale: Work hoisted out of a loop is a one-line change; work left inside it scales with input size for no reason
how-to-check: Read each loop body for a subexpression that does not reference the loop variable
severity: minor
sources:
  - Google Engineering Practices — Code Review, "Design"

## CQ-REVIEW-001

rule: A finding cites the file, the line, and the concrete failure scenario — never a general impression
rationale: "This could be cleaner" gives the author nothing to act on; a reproducible scenario does
how-to-check: For every finding raised, confirm it names a specific input or state that produces a specific wrong output
severity: minor
sources:
  - Google Engineering Practices — How to Do a Code Review

## CQ-REVIEW-002

rule: A change to a shared or widely-imported module states, in its own summary, what else it might affect
rationale: A shared module's blast radius is invisible from its own diff; the author is the one person who knows what else calls it
how-to-check: Grep the codebase for import sites of the touched module; compare the count against what the summary claims to have considered
severity: minor
sources:
  - Google Engineering Practices — Code Review, "Design"
