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

## SYS-BOUND-003

rule: A boundary between two modules is crossed through typed data, not by passing a live database connection, ORM entity, or internal handle across it
rationale: Passing a live handle across a boundary couples the receiving module to the sender's internal implementation, defeating the boundary's purpose
how-to-check: Check new cross-module calls for a parameter type that is the sender's internal connection/entity type rather than a plain data shape
severity: important
sources:
  - Domain-Driven Design (Eric Evans) — bounded contexts and anti-corruption layers

## SYS-CONTRACT-003

rule: A breaking change to a contract another team or system depends on ships with advance notice and a deprecation window, not a same-release removal
rationale: A same-release breaking change gives a consumer no chance to migrate before it fails
how-to-check: For a removed or incompatibly changed public field/endpoint, check whether a prior deprecation was announced and a window elapsed
severity: important
sources:
  - Microsoft REST API Guidelines, "Versioning" — deprecation policy

## SYS-DATA-003

rule: A field that can be null/absent is modeled as genuinely optional in the type and every reader; a field the system always populates is not typed as optional "to be safe"
rationale: An optional type on a value that is actually always present forces every reader to handle a case that cannot occur, while a required type on a genuinely-optional value hides real absence behind a placeholder
how-to-check: For a new or changed schema field, confirm every write path that should populate it actually does, and every read path handles the case it does not, matching the declared optionality
severity: minor
sources:
  - Designing Data-Intensive Applications (Martin Kleppmann), ch. 4 "Encoding and Evolution"

## SYS-DATA-004

rule: Deleting a record either genuinely removes it or explicitly soft-deletes it with every downstream reader updated to filter it out — never a delete that some readers see and others do not
rationale: An inconsistently-applied delete produces a "ghost" record that behaves differently depending on which code path reads it
how-to-check: For a new delete path, grep readers of the same table/collection for one that does not apply the same delete/soft-delete filter
severity: important
sources:
  - Designing Data-Intensive Applications (Martin Kleppmann), ch. 1 "Reliable, Scalable, and Maintainable Applications"

## SYS-FAIL-004

rule: A system's degraded mode when a non-critical dependency is down is explicitly defined (serve stale data, disable one feature) rather than the whole request failing
rationale: Treating every dependency as equally critical turns a minor, non-essential outage into a total one
how-to-check: For a new call to a non-critical dependency, check what the caller does when it is unavailable — a full failure versus a defined degraded path
severity: important
sources:
  - Release It! (Michael T. Nygard), "Bulkheads"

## SYS-FAIL-005

rule: A background job or async worker that fails is retried with a bounded number of attempts and lands in a dead-letter/failed state after exhaustion, not silently dropped or retried forever
rationale: A silently dropped failed job loses work with no signal; an infinitely retried one can wedge a queue on a single poison message
how-to-check: For a new job processor, confirm a maximum retry count and a terminal failed state exist and are observable
severity: important
sources:
  - Designing Data-Intensive Applications (Martin Kleppmann), ch. 11 "Stream Processing"

## SYS-MIGR-004

rule: A migration's forward step is tested against production-shaped data volume and cardinality, not only the small fixture used in unit tests
rationale: A migration that runs instantly on a hundred fixture rows can lock or time out against millions of production rows
how-to-check: Run or estimate the migration's cost against the actual table's current row count and index shape before it ships
severity: important
sources:
  - Refactoring Databases (Scott Ambler & Pramod Sadalage)

## SYS-COUPLE-003

rule: Two components that communicate do so through an explicit interface (API, message schema, event contract), not by one reading the other's internal storage directly
rationale: A direct read of another component's storage couples both to a schema neither can change independently and bypasses whatever invariants the owner enforces on writes
how-to-check: For new cross-component data access, confirm it goes through the owning component's interface rather than a shared table/file read directly
severity: important
sources:
  - A Philosophy of Software Design (John Ousterhout), "Modular Design"

## SYS-COUPLE-004

rule: A synchronous call chain does not grow deep enough that one slow leaf service determines the latency (and availability) of every caller above it
rationale: A deep synchronous chain composes every link's failure rate and latency, so the whole chain is only as reliable as its weakest link
how-to-check: For a new synchronous call added to an existing chain, count the resulting depth and check whether an async/eventual alternative was considered
severity: minor
sources:
  - Release It! (Michael T. Nygard), "Stability Patterns"

## SYS-OBS-003

rule: A new asynchronous or long-running operation exposes a way to check its current status, not only a fire-and-forget trigger
rationale: An operation with no status visibility forces the caller (or an operator) to guess whether it succeeded, is still running, or silently died
how-to-check: For a new async job/workflow, confirm a status-check mechanism (endpoint, query, dashboard) exists and reflects the operation's real state
severity: minor
sources:
  - Google SRE Book, ch. 6 "Monitoring Distributed Systems"

## SYS-OBS-004

rule: A system-level invariant the design depends on (uniqueness, ordering, at-most-one) is asserted or checked at runtime, not assumed to hold silently
rationale: An unchecked invariant that quietly breaks produces a much harder bug to find than one that fails loudly at the point it is violated
how-to-check: For a new invariant the design relies on, confirm a check, constraint, or assertion enforces it rather than the code merely assuming it
severity: important
sources:
  - The Pragmatic Programmer, "Design by Contract" — assertions

## SYS-CONFIG-002

rule: A configuration value with a sensible universal default ships with that default, so the system works without every deployment having to set it explicitly
rationale: A config value with no default turns an omission into a startup failure or, worse, a silent misbehavior in every environment that forgot to set it
how-to-check: For a new config field, check whether a default exists and whether its absence is handled explicitly (fail fast) rather than silently
severity: minor
sources:
  - The Twelve-Factor App, "Config"

## SYS-SCALE-002

rule: A resource created per-request or per-connection (a buffer, a client, a temp file) is bounded or reused, not accumulated without an upper limit as load grows
rationale: An unbounded per-request resource is a slow leak under normal load and an outage under a traffic spike
how-to-check: For new per-request resource allocation, check whether it is pooled/reused or has an explicit cap under concurrent load
severity: important
sources:
  - Release It! (Michael T. Nygard), "Resource Pools"

## SYS-SCALE-003

rule: A newly introduced index (or its absence) matches the query patterns the new code actually runs against that table
rationale: A query without a matching index degrades from constant-ish to linear cost as the table grows, invisible at small scale
how-to-check: For a new query with a `WHERE`/filter clause, check whether the filtered column(s) are covered by an existing or new index
severity: important
sources:
  - Designing Data-Intensive Applications (Martin Kleppmann), ch. 3 "Storage and Retrieval"

## SYS-VERS-001

rule: A change to a persisted event or message schema is both forward- and backward-compatible for the deployment window where old and new code run side by side
rationale: A rolling deployment means old and new code process the same stream simultaneously; a non-compatible schema change breaks whichever side reads the other's shape
how-to-check: For a new event/message field, confirm an old reader ignores it safely and a new reader tolerates its absence from an old-format message
severity: critical
sources:
  - Designing Data-Intensive Applications (Martin Kleppmann), ch. 4 "Encoding and Evolution"

## SYS-IDEMP-001

rule: An operation exposed to an external caller (webhook receiver, public API) is safe to receive more than once for the same logical event
rationale: At-least-once delivery is the norm for webhooks and distributed messaging; an operation that is not idempotent double-applies on the first retried delivery
how-to-check: Send the same external event twice with the same idempotency key/id and confirm the effect is applied once
severity: important
sources:
  - Designing Data-Intensive Applications (Martin Kleppmann), ch. 8 "The Trouble with Distributed Systems"

## SYS-CAP-001

rule: A system-level capability contract (what a role, service, or component is and is not permitted to do) is enforced at the boundary, not left as documentation nobody checks
rationale: A capability documented but not enforced is exactly as strong as the discipline of whoever happens to read the document
how-to-check: For a new or changed capability boundary, confirm a runtime check refuses the disallowed action rather than only a comment or doc describing it
severity: critical
sources:
  - This repository's own audit finding (B8.1) — role contracts unenforced

## SYS-BACKPRESSURE-001

rule: A producer that can generate work faster than a downstream consumer can process it has a backpressure mechanism (bounded queue, rate limit, blocking) rather than an unbounded buffer
rationale: An unbounded buffer between a fast producer and a slow consumer converts a throughput mismatch into an eventual out-of-memory failure
how-to-check: For a new producer/consumer pairing, check whether the queue between them has a bound and a defined behavior when full
severity: important
sources:
  - Designing Data-Intensive Applications (Martin Kleppmann), ch. 11 "Stream Processing"

## SYS-ENV-001

rule: Code behaves identically in staging/test and production except for configured values; no `if (env === "production")` branch changes actual logic
rationale: Logic that only runs in production is logic that has never actually been tested before it runs for real
how-to-check: Grep the diff for a conditional branching on an environment name that changes behavior rather than a config value
severity: important
sources:
  - The Twelve-Factor App, "Dev/prod parity"
