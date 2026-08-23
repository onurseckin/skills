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

## CQ-STRUCT-003

rule: A function's parameter list stays short enough to read at the call site; beyond roughly four positional parameters, group related ones into a single named options object
rationale: A long positional parameter list forces every caller to count position rather than read intent, and is the most common source of an accidental argument swap
how-to-check: Count the positional parameters on new/changed function signatures; four or more with no options-object grouping is the finding
severity: minor
sources:
  - Clean Code (Robert C. Martin), ch. 3 "Functions" — argument count

## CQ-STRUCT-004

rule: A conditional favors an early return or guard clause over nesting the rest of the function inside an `if`
rationale: Deep nesting forces the reader to hold every enclosing condition in mind to understand the innermost line
how-to-check: Read new functions for an `if` wrapping the remaining body with no early return; confirm inverting the condition and returning early would flatten it
severity: minor
sources:
  - Clean Code (Robert C. Martin), ch. 3 "Functions" — one level of abstraction

## CQ-NAMING-003

rule: An abbreviation in a name is either domain-standard (id, url, http) or spelled out; a project-local shorthand is not assumed to be obvious to the next reader
rationale: An abbreviation obvious to its author is frequently opaque to the next person, and there is no compiler check to catch the ambiguity
how-to-check: List new identifiers containing a non-standard abbreviation and confirm each is either well-known or expanded elsewhere in the file
severity: minor
sources:
  - Code Complete (Steve McConnell), ch. 11 "The Power of Variable Names"

## CQ-DUP-003

rule: A helper duplicated across more than one file collapses to a single shared implementation once a second file needs it, not left to accumulate independent copies
rationale: Each additional independent copy is a fork point where the next bug fix lands in only one of them
how-to-check: Grep the tree for a near-identical function body or literal block appearing in more than one file
severity: important
sources:
  - This repository's own audit finding (B8.3): a helper duplicated across three files

## CQ-DEAD-003

rule: A block of commented-out code is deleted, not kept "in case it's needed again"
rationale: Version control already keeps the history; commented-out code left in the file rots silently and is never updated alongside the code around it
how-to-check: Grep the diff for a multi-line comment block that contains syntactically valid code rather than prose
severity: minor
sources:
  - Refactoring (Martin Fowler), "Dead Code"

## CQ-ERR-003

rule: A caught error is not re-thrown as a different, less specific type that discards the information a caller needed to handle it
rationale: Collapsing a specific error into a generic one removes the caller's ability to distinguish "not found" from "not authorized" from "network down"
how-to-check: For a new catch-and-rethrow, compare the caught error's type/fields against what the new thrown error preserves
severity: important
sources:
  - Effective TypeScript (Dan Vanderkam) — error handling patterns

## CQ-ERR-004

rule: A function that can fail in a way the caller must handle says so in its return type or a documented throw, not only in an internal comment
rationale: A failure mode invisible at the call site is a failure mode the next caller will not handle until it happens in production
how-to-check: For a new function with an internal error path, check whether its signature or doc comment states the possible failure to a caller who has not read the implementation
severity: minor
sources:
  - The Pragmatic Programmer, "Design by Contract"

## CQ-TYPES-003

rule: A non-null assertion (`!`) is used only where the surrounding code has already proven the value present a few lines earlier, never to silence a case that can genuinely be absent
rationale: A non-null assertion is a promise to the compiler; a wrong promise turns a compile-time catch into a runtime crash
how-to-check: For each new `!` assertion, find the specific prior check or invariant that guarantees non-null; absent one is the finding
severity: important
sources:
  - Effective TypeScript (Dan Vanderkam), Item 9

## CQ-TYPES-004

rule: A value that callers must not mutate is typed `readonly` (or `ReadonlyArray`/`ReadonlyMap`), not left as a mutable type that happens not to be mutated today
rationale: An unmarked mutable type gives every future caller silent permission to mutate shared state, whether or not the original author intended it
how-to-check: For a new exported value handed to multiple callers, check whether its type prevents mutation or merely relies on convention
severity: minor
sources:
  - Effective TypeScript (Dan Vanderkam), Item 17

## CQ-TEST-004

rule: Every refusal path the code can take (a thrown error, a validation rejection, an early return on an invalid state) has a test asserting it actually refuses
rationale: A refusal is a guarantee; an untested refusal path can silently stop refusing the day a nearby edit changes its condition
how-to-check: List the new/changed thrown errors and early-refusal branches; confirm each has a test that triggers that exact condition and asserts the refusal
severity: important
sources:
  - This repository's own B9.1: negative paths are mandatory, not optional

## CQ-TEST-005

rule: A test that exercises a branch without asserting a specific outcome on that branch is not counted as covering it
rationale: A test that runs code without checking what it did reports safety it does not actually provide
how-to-check: For each new test, identify the `expect()` that would fail if the branch's behavior regressed; a test with no such assertion is the finding
severity: important
sources:
  - This repository's own B9.1: coverage of scenarios, not lines

## CQ-DOC-003

rule: A `TODO` or `FIXME` left in the diff names an owner, a tracked issue, or a concrete condition for when it should be resolved — never a bare aspiration
rationale: An unattributed TODO has no mechanism to ever be revisited and becomes permanent the moment it is committed
how-to-check: Grep the diff for `TODO`/`FIXME` and confirm each is followed by an issue reference, an owner, or a stated trigger condition
severity: minor
sources:
  - Google Engineering Practices — Code Review, "Follow-up work"

## CQ-STYLE-003

rule: A module's use of async/await versus raw Promise chaining is consistent with its own existing code, not mixed within the same function for no reason
rationale: Mixed async styles within one function force the reader to track two different control-flow mechanisms for equivalent logic
how-to-check: Read new functions for both `.then()` chains and `await` used side by side without a reason (e.g. genuine concurrency) for the mix
severity: minor
sources:
  - Google Engineering Practices — Code Review, "Style"

## CQ-GIT-003

rule: A commit does not bundle an unrelated formatting-only change together with a behavioral change
rationale: A mixed diff hides the actual behavioral change inside noise, making the commit far harder to review or revert precisely
how-to-check: Check the commit's diff for whitespace-only or reformat-only hunks in files the commit's subject does not otherwise concern
severity: minor
sources:
  - Google Engineering Practices — Code Review, "Small CLs"

## CQ-PERF-003

rule: A new dependency added to reach one small helper is weighed against implementing that helper directly, rather than pulling in a library for a fraction of its surface
rationale: Every dependency is a bundle-size, install-time, and supply-chain cost paid in full for however small a part of it is actually used
how-to-check: For a new dependency, compare what the diff actually calls against the dependency's total exported surface
severity: minor
sources:
  - The Pragmatic Programmer — minimizing dependencies

## CQ-PERF-004

rule: A repeated membership check against a growing collection uses a data structure with the matching complexity (`Set`/`Map` for lookup) rather than a linear `Array.includes` in a hot path
rationale: An `O(n)` lookup reads identically to an `O(1)` one at test-fixture size and only shows its cost once the collection is realistically sized
how-to-check: Find new repeated `.includes()`/`.find()` calls against an array inside a loop; check whether the collection is built once and could be a Set/Map instead
severity: minor
sources:
  - Introduction to Algorithms (Cormen, Leiserson, Rivest, Stein) — data structure selection by access pattern

## CQ-CONC-001

rule: State shared across concurrent code paths (async handlers, workers, in-flight requests) is not read-then-written without a guard against another path mutating it in between
rationale: A read-modify-write with no guard is a race the moment two paths execute close enough in time, and it is invisible in a single-threaded test
how-to-check: For new shared mutable state touched from more than one async entry point, check whether the read and the write are atomic with respect to each other
severity: important
sources:
  - Designing Data-Intensive Applications (Martin Kleppmann), ch. 7 "Transactions"

## CQ-CONC-002

rule: A resource acquired (file handle, lock, connection, lease) is released on every exit path from the function that acquired it, including a thrown error
rationale: A resource released only on the happy path leaks on the first exception, and the leak is invisible until the pool is exhausted
how-to-check: For new resource-acquiring code, confirm a `finally`, `using`, or equivalent guarantees release regardless of how the function exits
severity: important
sources:
  - The Pragmatic Programmer, "Resource Balancing"

## CQ-IMMUT-001

rule: A function does not mutate the objects or arrays passed into it unless that ownership transfer is explicit in its name or documented contract
rationale: A caller that does not expect its argument to be mutated will use the stale, now-incorrect original after the call returns
how-to-check: For a new function taking an object/array parameter, check whether it reassigns a property or array index without a stated mutation contract
severity: important
sources:
  - Effective TypeScript (Dan Vanderkam) — avoiding hidden mutation

## CQ-CONST-001

rule: A literal value carrying implicit meaning (a magic number, a repeated string key) that appears more than once is named as a constant, not retyped at each site
rationale: A magic number's meaning lives only in the author's head; a named constant documents it once and makes every use site greppable
how-to-check: Grep the diff for a numeric or string literal appearing at two or more sites with no shared named constant
severity: minor
sources:
  - Code Complete (Steve McConnell), ch. 12 "Fundamental Data Types"

## CQ-EXPORT-001

rule: A module exports what its callers actually need, not everything defined in the file by default
rationale: An unnecessarily wide export surface is more of the module a caller can accidentally couple to, and more that must stay stable across a refactor
how-to-check: For a new module, compare its exported names against what other files actually import from it
severity: minor
sources:
  - A Philosophy of Software Design (John Ousterhout), "Deep Modules"

## CQ-REVIEW-003

rule: A finding raised outside the task's own stated scope is explicitly labeled adjacent, distinct from a finding that blocks the task itself
rationale: An unlabeled out-of-scope finding either wrongly blocks an unrelated change or silently gets ignored because its status was never clear
how-to-check: For each finding raised, confirm it states whether it is required for this task's requirements or is a standing-standard observation found nearby
severity: minor
sources:
  - This repository's B12.1 — adjacent findings are surfaced and routed, never silently blocking

## CQ-VALID-001

rule: A publicly exported function validates its own inputs at the boundary rather than trusting every caller to have validated them first
rationale: A function that trusts its caller is only as safe as the least careful caller it will ever get, and that caller arrives long after the original author is gone
how-to-check: For a new exported function taking external or loosely-typed input, check whether it validates before acting or assumes the caller already did
severity: minor
sources:
  - The Pragmatic Programmer, "Design by Contract" — defensive boundaries

## CQ-API-001

rule: A function's return type communicates failure explicitly (a union, a Result type, a documented throw) rather than overloading a valid value (`-1`, `null`, empty string) to mean both "success with this value" and "failure"
rationale: An overloaded sentinel value is indistinguishable from a legitimate result the moment the valid range includes it
how-to-check: For a new function, check whether its "not found"/"failed" case returns a value that could also occur as a legitimate success
severity: important
sources:
  - Effective TypeScript (Dan Vanderkam) — avoiding ambiguous return values

## CQ-INIT-001

rule: An object or module's fields are fully initialized by the end of its constructor/setup, with no field left in a partially-constructed, must-call-this-method-first state
rationale: A partially-initialized object that requires a specific follow-up call before use is a defect waiting for the one caller who does not know to make that call
how-to-check: For a new class/module, check whether every field is set by the end of construction or whether some are only set by a separate, easy-to-forget method
severity: minor
sources:
  - Effective Java (Joshua Bloch) — constructor completeness

## CQ-TEST-006

rule: A test does not depend on another test's side effects or on the order tests happen to run in; each test sets up and tears down its own state
rationale: An order-dependent suite passes today and fails the moment a test is reordered, parallelized, or run alone, for a reason that has nothing to do with the code under test
how-to-check: Run the new/changed test file's tests in reverse order and in isolation; a result that differs from the full-suite run is the finding
severity: important
sources:
  - xUnit Test Patterns (Gerard Meszaros), "Test Independence"

## CQ-COMPLEX-001

rule: A function's branching complexity stays low enough to hold in working memory; a function accumulating many nested conditionals and loops is split along its natural sub-tasks
rationale: Cyclomatic complexity counts the independent paths a reader must trace to know a function is correct, and is also the number of cases a test suite must cover to actually prove it
how-to-check: Count a new/changed function's decision points (if/else/case/&&/||/loop); a function in the double digits with no split plan is the finding
severity: minor
sources:
  - A Complexity Measure (Thomas J. McCabe, 1976); Code Complete (Steve McConnell), ch. 19 "General Control Issues"

## CQ-DEBUG-001

rule: A debug print or console statement added to trace down an issue is removed before the diff ships, not left in commented out or unconditionally firing
rationale: A stray debug statement left in is noise on every future run of that code path, and nothing forces its removal once it blends in with real logging
how-to-check: Grep the diff for `console.log`/`print`/`debugger` statements that are not routed through the project's own logging abstraction
severity: minor
sources:
  - Google Engineering Practices — Code Review, "Style"

## CQ-FALSIFY-001

rule: Every test gate and verification suite must be proven counterfactually falsifiable by confirming it fails when the fix or feature logic is reverted or an intentional defect is introduced
rationale: A test gate that passes regardless of whether the code is correct or broken is a rubber stamp and provides zero verification
how-to-check: Revert the implementation diff or inject an intentional defect and execute the gate command; confirm it exits nonzero before certifying that the passing gate is valid
severity: critical
sources:
  - Popper's Falsifiability Criterion
  - Test-Driven Development (Kent Beck)

## CQ-METRIC-001

rule: Touched code enforces strict quantitative invariants: 0 TypeScript any types, 0 compiler or linter suppressions, 100% test pass rate, and exact execution timings
rationale: Quantitative invariants provide objective, verifiable correctness guarantees that cannot be diluted by subjective confidence narratives
how-to-check: Audit all touched files for any usages, @ts-ignore, @ts-expect-error, eslint-disable comments, and verify 100% test pass rate
severity: critical
sources:
  - Effective TypeScript (Dan Vanderkam)
  - Clean Code (Robert C. Martin)

## CQ-CLI-001

rule: Command-line interfaces and options must be cohesive, consolidated, and complete, forbidding fragmented options or one-off disconnected flags
rationale: Fragmented CLI options create interface drift, increase surface complexity, and degrade operator ergonomics
how-to-check: Inspect CLI command registrations to ensure flags and subcommands are consolidated into unified interfaces rather than sprawling one-off flags
severity: important
sources:
  - POSIX Utility Conventions
  - Command Line Interface Guidelines (clig.dev)

## CQ-SOC-PREMISE-001

rule: Every assertion and verification claim must be proven against live disk artifacts and directly executed commands rather than assumed from docstrings, types, or comments
rationale: Speculative assumptions and unchecked descriptions lead to rubber-stamped passes on unimplemented or disconnected logic
how-to-check: Verify that validation check commands open and test the actual disk files and runtime entry points directly
severity: critical
sources:
  - This repository's B33 (wire vs delete)
  - Socratic Method

## CQ-SOC-EDGE-001

rule: Changes must be explicitly verified across boundary conditions, empty collections, single-item cases, maximum capacities, and concurrent operations
rationale: Boundary conditions are the most common source of off-by-one errors, unhandled exceptions, and runtime panics
how-to-check: Identify boundary inputs and verify corresponding test cases exist and pass
severity: important
sources:
  - Boundary Value Analysis
  - Socratic Method

## CQ-SOC-FAIL-001

rule: Failure modes, error propagation paths, and negative execution branches must be tested and verified to fail closed with clean recovery
rationale: Unhandled errors or swallowed exceptions erase failure signals and cause silent corruption
how-to-check: Check negative path test cases and verify that error cases log/rethrow or return typed error results
severity: critical
sources:
  - The Pragmatic Programmer, "Design by Contract"
  - Socratic Method

## CQ-SOC-HIERARCHY-001

rule: Architectural tier hierarchy and static invariants (4-tier agent model, write-scope boundaries, 0 TypeScript any, 0 suppressions) must be strictly maintained
rationale: Boundary leaks and type suppressions degrade architectural integrity and create silent cascading failures
how-to-check: Audit write scope diffs and search touched files for type suppressions or role boundary violations
severity: critical
sources:
  - 4-Tier Supervisory Architecture
  - Effective TypeScript

## CQ-SOC-EMPIRICAL-001

rule: All verification verdicts must be backed by quantitative, deterministic, reproducible measurements (exact ms timings, 100% test pass rate, exit code 0)
rationale: Subjective confidence narratives and boilerplate sign-offs mask unverified bugs and create false confidence
how-to-check: Confirm every verdict cites exact command IDs, exit codes, and measured execution timings
severity: critical
sources:
  - Empirical Verification
  - Popper's Falsifiability


