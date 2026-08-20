# System design checklist
Domain: system-design

Drawn whenever a task's write scope touches a schema, a public contract, a boundary between
modules or services, or persisted data shape. Judges boundaries, data ownership, failure modes,
migration safety, coupling and observability — properties invisible from reading any single
function in isolation.

## SYS-BOUND-001

rule: A module reached from outside its own directory exposes a narrow, named interface; callers do not reach into its internals through a deep import path
rationale: A deep import couples the caller to implementation details the module owner never agreed to keep stable
how-to-check: Grep new imports for paths reaching past a module's declared public entry point (e.g. into an `internal/` or unexported file)
severity: important
sources:
  - A Philosophy of Software Design (John Ousterhout), "Deep Modules"

## SYS-BOUND-002

rule: A dependency between two modules points in one direction; introducing an edge that would create a cycle is refused, not routed around with a lazy import
rationale: A dependency cycle makes both modules impossible to reason about, test, or release independently
how-to-check: Trace the new import against the existing dependency graph for a path back to the importing module
severity: important
sources:
  - A Philosophy of Software Design (John Ousterhout), "Modular Design"

## SYS-CONTRACT-001

rule: A change to a public API's request or response shape is additive (new optional field) or is versioned; an existing field's type or meaning is never silently repurposed
rationale: A silently repurposed field breaks every caller that was correctly reading it under its old meaning, with no error to signal the break
how-to-check: Diff the API schema before and after; flag any changed field type, removed field, or meaning change on an existing field
severity: critical
sources:
  - Microsoft REST API Guidelines, "Versioning"; Semantic Versioning 2.0.0

## SYS-CONTRACT-002

rule: A function's documented contract states what it guarantees about ordering, idempotency, and partial failure — and the implementation matches what is stated
rationale: A caller can only build correctly on what the contract states; an implementation detail not in the contract is not safe to depend on and not safe to assume away either
how-to-check: For a new or changed public function handling retries or concurrent calls, compare its doc comment's claims against a direct test of that behaviour
severity: important
sources:
  - Designing Data-Intensive Applications (Martin Kleppmann), ch. 9 "Consistency and Consensus"

## SYS-DATA-001

rule: Each piece of persisted data has exactly one module that owns writes to it; a second module reads through the owner's interface rather than writing directly
rationale: Two writers to the same data race on invariants neither one alone can enforce
how-to-check: For a new write path, check whether the same table/collection/field already has a writer elsewhere in the codebase
severity: important
sources:
  - Designing Data-Intensive Applications (Martin Kleppmann), ch. 1 "Reliable, Scalable, and Maintainable Applications"

## SYS-DATA-002

rule: A value derived from another (a cache, a denormalized count, a computed summary) states its staleness bound, and the system tolerates it being stale within that bound
rationale: An unstated staleness assumption becomes a correctness bug the first time the derivation lags further than anyone expected
how-to-check: For a new cache or derived field, find where it is invalidated or refreshed and confirm the interval matches what callers assume
severity: important
sources:
  - Designing Data-Intensive Applications (Martin Kleppmann), ch. 11 "Stream Processing"

## SYS-FAIL-001

rule: A call to another service or process has a bounded timeout and a defined behaviour on timeout — never an unbounded wait
rationale: An unbounded wait on a dependency turns that dependency's outage into this system's outage too
how-to-check: Grep new network/subprocess calls for an explicit timeout parameter
severity: critical
sources:
  - Release It! (Michael T. Nygard), "Stability Patterns" — timeouts

## SYS-FAIL-002

rule: A retried operation is idempotent, or carries an idempotency key, so a retry after an ambiguous failure cannot double-apply
rationale: A non-idempotent retry after a timeout (where the first attempt may have actually succeeded) can duplicate the effect silently
how-to-check: For a new retry path around a write or side-effecting call, confirm the operation is naturally idempotent or is keyed
severity: critical
sources:
  - Designing Data-Intensive Applications (Martin Kleppmann), ch. 8 "The Trouble with Distributed Systems"

## SYS-FAIL-003

rule: A repeated failure against a dependency backs off or trips a circuit breaker rather than retrying at a fixed, tight interval indefinitely
rationale: A tight retry loop against a struggling dependency is the classic way a partial outage becomes a total one
how-to-check: Check new retry logic for exponential (or otherwise increasing) backoff and a cap on total attempts
severity: important
sources:
  - Release It! (Michael T. Nygard), "Circuit Breaker"

## SYS-MIGR-001

rule: A schema change that removes or renames a column/field ships as expand-then-contract: add the new shape, migrate readers and writers, then remove the old shape in a later change
rationale: A single-step rename breaks every in-flight process still running the old code the instant the migration runs
how-to-check: For a rename or removal in a schema diff, confirm it is the contract step of a prior expand step, not a single combined change
severity: critical
sources:
  - Refactoring Databases (Scott Ambler & Pramod Sadalage), "Expand-Contract Pattern"

## SYS-MIGR-002

rule: A migration is reversible, or its irreversibility is explicitly called out with the reason and the accepted risk
rationale: An irreversible migration that fails partway through under load has no path back except a restore
how-to-check: Check whether the migration ships a `down` step; if not, confirm the change's own notes state why reversal is unsafe or unnecessary
severity: important
sources:
  - Refactoring Databases (Scott Ambler & Pramod Sadalage)

## SYS-MIGR-003

rule: A migration that touches a large or hot table runs online (batched, non-locking) rather than a single blocking statement
rationale: A single blocking migration on a hot table is an outage with extra steps
how-to-check: For a migration touching a table over the project's stated size threshold, confirm it is batched or uses an online-migration mechanism
severity: important
sources:
  - Designing Data-Intensive Applications (Martin Kleppmann), ch. 3 "Storage and Retrieval"

## SYS-COUPLE-001

rule: Two services or modules that must change together to stay correct are not treated as independently deployable without a compatibility window
rationale: Assuming independent deployability for coupled components is how a routine deploy order produces a production incident
how-to-check: For a change spanning two deployable units, confirm the diff either deploys them together or maintains compatibility across the gap
severity: important
sources:
  - Google SRE Workbook, "Change Management"

## SYS-COUPLE-002

rule: A shared library's breaking change is a major version bump, and every known internal consumer is updated in the same release train or explicitly pinned
rationale: A silent breaking change in a shared library surfaces as a mystery failure in a consumer nobody thought to check
how-to-check: For a shared library change, grep the monorepo (or check the package registry) for consumers and confirm each is accounted for
severity: important
sources:
  - Semantic Versioning 2.0.0

## SYS-OBS-001

rule: A new failure mode a system can enter is observable from outside it: a metric, a log line, or a health check reflects it
rationale: A failure mode with no signal is a failure mode nobody can respond to until a user reports it
how-to-check: For new error-handling branches, confirm the branch emits a log, metric, or alert distinguishable from the success path
severity: important
sources:
  - Google SRE Book, ch. 6 "Monitoring Distributed Systems"

## SYS-OBS-002

rule: A log line meant for debugging a production incident carries enough context (request id, entity id, the actual failing value) to correlate across the system, without carrying secrets
rationale: A log line with no correlating id is unusable during an incident; one carrying a secret is itself an incident
how-to-check: Read new log statements for a correlation identifier and check them against SEC-LOG-001 for sensitive values
severity: minor
sources:
  - Google SRE Book, ch. 6 "Monitoring Distributed Systems"

## SYS-CONFIG-001

rule: Configuration that varies by environment is read from environment/config, never hard-coded, and a config value nothing reads is not declared
rationale: A hard-coded environment-specific value silently breaks the next environment; a declared-but-unread config field is a promise the harness does not keep
how-to-check: Grep new code for hard-coded hostnames, ports, or environment-specific literals; grep new config fields for a reader outside the config module
severity: important
sources:
  - The Twelve-Factor App, "Config"

## SYS-SCALE-001

rule: A newly introduced collection, queue, or list that can grow with user activity has a stated bound or pagination, not an assumption it stays small
rationale: Every unbounded collection was small once; the ones that matter are the ones nobody bounded before they grew
how-to-check: For a new list-returning query or in-memory collection, check for a limit, cursor, or pagination parameter
severity: important
sources:
  - Designing Data-Intensive Applications (Martin Kleppmann), ch. 6 "Partitioning"
