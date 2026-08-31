# Implementation Plan

## Objectives & Requirements
- **req-fix-manifest-and-packet-tests**: Sync grant bootstrap allowlist test expectations, add communication contracts to policy-discovery.yaml, and fix ultra-lean-packet branch coverage
- **req-fix-sync-and-modularity-tests**: Fix sync CLI options tests and modularity ratchet baseline and markdown format tests
- **req-fix-meta-audit-and-vendor-tests**: Fix meta-audit execute authority, backlog integrity, pre-critic-readiness identity expiry, and vendor-naming exemptions
- **req-fix-density-and-doctor-tests**: Fix physical density, zero-comment invariants, doctor tests, and cognitive validator command locks

## Tasks & Scopes
### task-fix-manifest-and-packet-tests: Remediate manifest and packet tests
- **Dependencies**: None
- **Write Scope**:
  - `tests/unit/packets`
  - `olt/agents/policy-discovery.yaml`
- **Gate**: `bun test tests/unit/packets/grant-bootstrap-allowlist.test.ts tests/unit/packets/ultra-lean-packet.test.ts`

### task-fix-sync-and-modularity-tests: Remediate sync and modularity tests
- **Dependencies**: None
- **Write Scope**:
  - `tests/unit/sync`
  - `tests/unit/scripts/modularity`
- **Gate**: `bun test tests/unit/sync/index.test.ts tests/unit/scripts/modularity`

### task-fix-meta-audit-and-vendor-tests: Remediate meta-audit and vendor naming tests
- **Dependencies**: None
- **Write Scope**:
  - `tests/unit/cli`
  - `tests/unit/critic`
  - `tests/unit/vendor-naming.test.ts`
- **Gate**: `bun test tests/unit/cli/meta-audit.test.ts tests/unit/critic/pre-critic-readiness.test.ts tests/unit/vendor-naming.test.ts`

### task-fix-density-and-doctor-tests: Remediate physical density and doctor tests
- **Dependencies**: None
- **Write Scope**:
  - `tests/unit/doctor`
  - `tests/unit/physical-density.test.ts`
- **Gate**: `bun test tests/unit/doctor tests/unit/physical-density.test.ts`
