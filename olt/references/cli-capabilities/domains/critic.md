# CLI Capability Manifest — critic

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../cli-capabilities.md`](../cli-capabilities.md).

### `critic:start`

Authorise a completeness critic against the immutable prompt bytes.

Records a repository inspection, assigns the critic, and returns the critic token required to review.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--critic` | string | yes | no | - | Critic agent id. |
| `--repository-command-ids` | string | no | yes | - | Extra authoritative command ids to add as repository evidence, alongside every run-gate command the harness auto-discovers. |

```bash
bun harness.ts critic:start --run .olt/capsules/<run-id> --critic critic-1
```

### `critic:review`

Record the completeness verdict over the whole repository diff.

--decision approve clears completion; request_changes records findings that block it and requires --findings or --findings-file, because the harness never composes a finding on the critic's behalf. Every finding must carry id, requirement_id, severity, observation, remediation and revalidation. Requirement proofs come only from --proofs/--proofs-file or --review; a requirement with no proof is recorded unproven and blocks completion, and a clean verdict with any unproven requirement is refused. integrity_evidence is always the harness's own capsule integrity observation, measured at review time; a --review file cannot certify its own capsule, so whatever it declares under that key is replaced.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--critic` | string | yes | no | - | Critic agent id. |
| `--token` | string | yes | no | - | Critic token. |
| `--decision` | string | yes | no | - | approve or request_changes. |
| `--summary` | string | yes | no | - | Verdict summary in the critic's own words. |
| `--findings` | string | no | no | - | Inline JSON findings payload. |
| `--findings-file` | string | no | no | - | Path to a JSON findings payload. |
| `--proofs` | string | no | no | - | Inline JSON requirement_proofs payload. |
| `--proofs-file` | string | no | no | - | Path to a JSON requirement_proofs payload. |
| `--review` | string | no | no | - | Path to a complete review payload. |

```bash
bun harness.ts critic:review --run .olt/capsules/<run-id> --critic critic-1 --token <token> --decision approve --proofs-file proofs.json --summary "Whole diff verified"
```

### `critic:reject`

Reject completion with findings that trigger replanning.

Equivalent to critic:review --decision request_changes with a rejection brief. Structured findings are mandatory: pass --findings or --findings-file.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--critic` | string | yes | no | - | Critic agent id. |
| `--token` | string | yes | no | - | Critic token. |
| `--summary` | string | yes | no | - | Rejection summary in the critic's own words. |
| `--findings` | string | no | no | - | Inline JSON findings payload. |
| `--findings-file` | string | no | no | - | Path to a JSON findings payload. |
| `--proofs` | string | no | no | - | Inline JSON requirement_proofs payload. |
| `--proofs-file` | string | no | no | - | Path to a JSON requirement_proofs payload. |
| `--review` | string | no | no | - | Path to a complete review payload. |

```bash
bun harness.ts critic:reject --run .olt/capsules/<run-id> --critic critic-1 --token <token> --summary "Missing error boundary" --findings '[{"id":"F-01","requirement_id":"req-1","severity":"critical","observation":"No error boundary around the render tree","remediation":"Wrap the tree in an error boundary","revalidation":"bun test tests/render"}]'
```

### `critic:remediate`

Close out a critic findings review with command-backed remediation evidence.

Every review recorded with status findings stays in history and blocks completion until it carries a remediation naming exactly its own finding ids, each proven by a critic-run, task-unbound, successful command. --resolve is repeatable as <finding-id>=<command-id>[,<command-id>]; --resolution-method names how each finding was closed. --review-sha256 defaults to the currently recorded review.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--actor` | string | yes | no | - | Who is recording the remediation. |
| `--review-sha256` | string | no | no | - | Digest of the review being remediated. |
| `--resolve` | string | no | yes | - | Answer a finding: <finding-id>=<command-id>[,<command-id>]. |
| `--resolution-method` | string | no | yes | - | How a finding was answered: <finding-id>=<method>. |

```bash
bun harness.ts critic:remediate --run .olt/capsules/<run-id> --actor coordinator --resolve CF-1=C-fix-1 --resolution-method CF-1="focused repair and verification"
```
