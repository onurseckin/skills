# Autonomous Mind Security & Remote Safety Specification

**Status**: Operational Standard  
**Phase Reference**: PHASE-6 §3.4 · PLAN.md §11.4  
**Classification**: High-Assurance Autonomous Execution Architecture  

---

## 1. Overview & Core Philosophy

Autonomous, long-running agent execution ("Mind" operations) presents distinct failure modes compared to interactive human-in-the-loop pairing. When a system operates continuously across unattended timer intervals (e.g., via `systemd` timers or detached daemons), safety cannot rely on human vigilance, polite prompt instructions, or soft policy guardrails.

The foundational principle of the autonomous execution architecture is:

> **Remove the capability, do not merely forbid the action.**
> 
> A rule added to a prompt or policy is a soft constraint that an adversarial, hallucinating, or compromised agent can bypass. A capability removed from the underlying environment (network, transport, credentials, filesystem permissions) is a physical bound that cannot be breached regardless of agent behavior.

This document formalizes the **3-Layer Security Model** required for unattended Mind deployments.

---

## 2. The 3-Layer Security Model

The security model is structured as three defense-in-depth layers. Each layer addresses a specific failure boundary and assumes the layers above or below it could experience faults.

```
+-------------------------------------------------------------------------+
| Layer 1: Host Permission System (Foundational Boundary)                 |
|   - Host sandbox, OS user boundaries, tool capability allowlists       |
|   - Interactive grant authority and session lifecycle gating            |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| Layer 2: Blast Radius Containment (Machine & Account Level)             |
|   - Zero push remote configured (transport-layer push impossibility)    |
|   - Zero ambient push credentials / Read-only pull credentials only     |
|   - Server-side branch protection rules & signed commit enforcement     |
|   - Zero production secrets / Zero external deployment access           |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| Layer 3: Harness Rails & Evidentiary Integrity (Process Level)          |
|   - Cryptographic event sourcing & monotonic state machine validation   |
|   - Strict role contracts, tier hierarchy gating, and write scopes      |
|   - Honest limits: CLI doors constrain harness commands, not raw shell  |
+-------------------------------------------------------------------------+
```

---

## 3. Layer 1: Host Permission System

The host's own permission system is the primary outer boundary of the agent execution environment.

### 3.1 Host Sandbox & Tool Authorizations
- **Explicit Tool Whitelists**: Execution hosts (e.g., Antigravity, Claude Code, custom runners) expose discrete capabilities via tools (e.g., `run_command`, `view_file`, `replace_file_content`). Unnecessary capabilities (e.g., arbitrary outbound network callers, raw memory inspectors) must remain ungranted.
- **Operating System User Isolation**: Unattended daemon processes must run as dedicated unprivileged system users (e.g., `mind-runner:mind-runner`), distinct from administrative or developer accounts.
- **Filesystem Permissions**: The operational repository clone and capsule directories must enforce strict read-only bits (`0444`) on frozen artifacts and `prompt.md` to prevent tamper attacks.

---

## 4. Layer 2: Blast Radius Containment (Account & Machine Level)

Layer 2 eliminates the blast radius at the transport and infrastructure levels. Even if an agent constructs a malicious payload or attempts arbitrary shell commands, it lacks the credentials and transport targets to affect remote systems.

### 4.1 Transport-Layer Push Impossibility (No Push Remote)
The single most valuable security decision in the unattended execution design is:
**The operational repository clone has no push remote configured.**

```
Operational Box (Mind)                      Upstream Repository (GitHub / GitLab)
+-----------------------+                       +-----------------------------+
| Local Git Repo        |                       | Main Branch (Protected)     |
|   - origin (fetch)    | <==== git pull ====== |   - Require PR & Reviews    |
|   - push: "no_push"   |                       |   - Require CI Pass         |
|   - 0 Push Remote URL | ===== git push =====> |   - Block Force Pushes      |
+-----------------------+          X            +-----------------------------+
                            (Transport Error:
                            git fatal rejection)
```

- When `git remote -v` is executed on the operational container, the push URL must either be explicitly unset or pointed to an inert dummy URL (e.g., `no_push` or `disabled://push-prohibited`).
- A deliberate `git push origin main` command must fail instantly at the Git transport layer with a fatal exit code, before any network packet reaches a remote repository.
- Workflow for integrating changes: The human repository owner pulls changes from the operational machine or a dedicated review branch, rather than allowing the automated runner to push to canonical branches.

### 4.2 Credential Minimization (0 Ambient Push Credentials)
- **Zero Push Credentials**: The runtime environment must contain zero credentials capable of mutating remote repositories.
- **Prohibited Ambient Environment Variables**:
  - `GITHUB_TOKEN`, `GH_TOKEN`, `GIT_SSH_COMMAND`, `GIT_ASKPASS`, `GIT_AUTH_TOKEN`, `GIT_PASSWORD`
- **Read-Only SSH Deploy Keys**: If automated fetches/pulls are required, authentication must use dedicated read-only SSH deploy keys scoped strictly to repository read operations (`pull-only`).
- **Read-Only Access Tokens**: Any API tokens present must have minimal `read:contents` permissions with zero write, push, administration, or workflow dispatch scopes.
- **Git Credential Helper Neutralization**: Operational Git configs must explicitly disable credential helpers (`git config --global credential.helper ""`) to prevent ambient keychain or system credentials from being used.

### 4.3 Server-Side Branch Protection
The upstream Git forge must enforce server-side rules that cannot be waived by client tokens:
- Require pull request reviews before merging.
- Require passing status checks (full CI test suite, typecheck, lint).
- Prohibit direct pushes and force pushes to default and release branches (`main`, `master`, `release/*`).
- Enforce linear history and GPG/SSH signed commits where supported.

### 4.4 Zero Production Secrets
- The operational container must never host production deployment keys, database production connection strings, cloud infrastructure credentials (AWS, GCP, Azure, Cloudflare), or production API secrets.

---

## 5. Layer 3: Harness Rails & Evidentiary Integrity

Layer 3 provides structural, cryptographic, and state-machine constraints over all harness operations.

### 5.1 What Harness Rails Guarantee
- **Cryptographic State Integrity**: All mutations occur via event-sourced state transactions (`transact`) with SHA-256 state projection hashing.
- **Role Contracts & Tier Hierarchy**: Agents operate under strict role contracts (e.g., Mind Tier 0, Orchestrator Tier 1, Coordinator Tier 2, Implementer/Validator Tier 3). Mind agents cannot compile plans, claim implementation tasks, or edit repository files directly.
- **Disjoint Scopes**: Tasks enforce strictly disjoint write scopes and resource locks to eliminate concurrency collisions.
- **Witness & Evidence Gates**: Admitted objectives must be evidenced by executed witness commands (`harness_observed`), not unverified assertions.

### 5.2 The Honest Bound: Harness Rails vs. The Shell
It is critical to understand what Layer 3 cannot do:

> **The CLI door constrains harness commands. It does not constrain a shell.**
> 
> `assertGrantedCommand` refuses unauthorized harness commands (e.g., refusing `plan:compile` when run by a Mind role). However, it cannot prevent `rm -rf /` or arbitrary shell execution invoked directly via a Bash tool.
> 
> An agent equipped with execution capabilities possesses the full authority of the underlying OS user. Therefore, Harness Rails (Layer 3) are meaningful ONLY when underpinned by Host Permissions (Layer 1) and Blast Radius Containment (Layer 2).

---

## 6. Operational Runbook: Machine Provisioning & Safety Checklist

### 6.1 Provisioning a Safe Repository Clone

When provisioning an operational box or container for autonomous execution:

```bash
# 1. Clone using read-only credentials
git clone git@github.com:org/repo.git /srv/repo

# 2. Strip push capability at the transport level
cd /srv/repo
git remote set-url --push origin no_push

# 3. Disable ambient credential helpers
git config credential.helper ""

# 4. Verify remote configuration
git remote -v
# Output must show:
# origin  git@github.com:org/repo.git (fetch)
# origin  no_push (push)
```

### 6.2 Pre-Flight Safety Verification Drill

Before arming the unattended runner or service timer:

1. **Remote Push Drill**:
   ```bash
   git push origin main
   # MUST exit non-zero with transport error:
   # fatal: 'no_push' does not appear to be a git repository
   ```

2. **Credential Audit**:
   ```bash
   env | grep -E "(TOKEN|SECRET|KEY|PASS|AUTH)"
   # MUST output 0 push-capable tokens or production secrets
   ```

3. **Capsule Permissions Audit**:
   ```bash
   ls -la .capsules/*/prompt.md
   # MUST show read-only file mode bits (0444 / -r--r--r--)
   ```

4. **Harness Doctor Verification**:
   ```bash
   bun harness.ts doctor --run .capsules/<run-id>
   # MUST return exit code 0 with clean state projection
   ```

---

## 7. Anti-Patterns and Failure Modes

| Anti-Pattern | Why It Fails | Safe Countermeasure |
| :--- | :--- | :--- |
| **"Temporary" Push Credentials** | Ambient credentials in the environment will eventually be discovered or leaked during an error/loop. | Zero push credentials on the box. Use pull-only credentials permanently. |
| **Soft Policy "Do Not Push" Rules** | LLMs hallucinate or misunderstand task boundaries under unexpected edge cases. | Transport-layer push URL disabling (`set-url --push origin no_push`). |
| **Relying Solely on CLI Guardrails** | A raw shell tool bypasses application-level CLI command checkers. | Contain the OS user account and blast radius at Layers 1 and 2. |
| **Writable Frozen Artifacts** | Provisioning scripts running `chmod -R u+w` poison capsule integrity (`INTEGRITY: prompt.md is writable`). | Preserve `0444` read-only permissions across all provisioning pipelines. |

---

## 8. Summary Checklist

- [x] Host permissions enforce strict tool whitelists and unprivileged OS user execution.
- [x] Operational repository has no push remote configured (or push remote is `no_push`).
- [x] Deliberate `git push` attempts fail immediately with fatal Git transport errors.
- [x] Environment contains zero ambient push credentials or production secrets.
- [x] Upstream branches enforce server-side review and status check requirements.
- [x] Harness state integrity validates cryptographic evidence and role boundaries.
