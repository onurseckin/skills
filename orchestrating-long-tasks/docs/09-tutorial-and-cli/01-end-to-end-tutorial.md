# 01. Complete End-to-End Tutorial: From User Prompt to Verified Branch

[⬅ Previous: Stale Worker & Torn Tail Recovery](../08-durability-recovery/03-stale-worker-and-torn-tail-recovery.md) | [Master Table of Contents](../README.md) | [Next: CLI Command Reference ➡](./02-cli-command-reference.md)

---

## 🚀 Overview

This hands-on tutorial guides a developer or agent through the complete lifecycle of executing a complex, multi-file software engineering project using `orchestrating-long-tasks`.

By the end of this tutorial, you will understand how to initialize a task capsule, decompose user prompts with 100% line coverage, orchestrate concurrent subagents with Zero-JSON CLI briefs, validate with adversarial role separation, and mechanically complete a verified run.

---

## 🛠️ Step 1: Capture Prompt & Initialize Capsule (`plan:init`)

When given a complex project prompt, capture it directly via standard input:

```bash
cat << 'EOF' | bun harness.ts plan:init --repo . --run my-feature --prompt-stdin
Refactor user authentication to support OAuth2 GitHub and Google providers.
All existing unit tests must pass.
Add comprehensive integration tests for token exchange.
EOF
```

The CLI outputs a concise Markdown brief confirming the capsule root and prompt SHA-256 digest.

---

## 📝 Step 2: Declare Tasks & Compile the Dependency Graph

1. **Register Modular Tasks (`plan:add`):**

   ```bash
   bun harness.ts plan:add \
     --run .capsules/my-feature \
     --actor planner \
     --id task-gh-auth \
     --label "Implement GitHub OAuth2 provider" \
     --scope src/auth/github \
     --gate "bun test tests/unit/auth-github.test.ts"

   bun harness.ts plan:add \
     --run .capsules/my-feature \
     --actor planner \
     --id task-google-auth \
     --label "Implement Google OAuth2 provider" \
     --scope src/auth/google \
     --gate "bun test tests/unit/auth-google.test.ts"
   ```

2. **Inspect Plan Status & Compile Graph:**
   ```bash
   bun harness.ts plan:status --run .capsules/my-feature
   bun harness.ts plan:compile --run .capsules/my-feature --actor planner
   ```
   `plan:compile` automatically verifies 100% line disposition coverage, checks for dependency cycles, and prepares the execution queue.

---

## ⚡ Step 3: Inspect Queue & Lease Tasks (`queue:pop` / `task:claim`)

1. **Inspect Ready Tasks:**
   ```bash
   bun harness.ts queue:next --run .capsules/my-feature
   ```
2. **Lease Task to an Implementer Worker:**
   ```bash
   bun harness.ts queue:pop \
     --run .capsules/my-feature \
     --agent worker-1 \
     --lease-seconds 1800
   ```
   The CLI outputs the lease brief containing the one-time plaintext bearer token and assigned write scope.

---

## 💻 Step 4: Implement, Heartbeat & Submit (`task:submit`)

1. Write code strictly within the assigned `write_scope`.
2. Heartbeat active leases during lengthy compilations:
   ```bash
   bun harness.ts task:heartbeat \
     --run .capsules/my-feature \
     --task task-gh-auth \
     --agent worker-1 \
     --token <bearer-token>
   ```
3. Submit task completion:
   ```bash
   bun harness.ts task:submit \
     --run .capsules/my-feature \
     --task task-gh-auth \
     --agent worker-1 \
     --token <bearer-token> \
     --summary "Implemented GitHub OAuth2 provider and verified unit tests"
   ```

---

## 🔍 Step 5: Adversarial Validation & Gate Execution

1. **Dispatch Independent Validator (`task:validate-start`):**
   ```bash
   bun harness.ts task:validate-start \
     --run .capsules/my-feature \
     --task task-gh-auth \
     --validator val-1
   ```
2. **Validator Runs Mandatory Gate (`run:exec`):**
   ```bash
   bun harness.ts run:exec \
     --run .capsules/my-feature \
     --task task-gh-auth \
     --gate gate-task-gh-auth-0 \
     --actor val-1 \
     -- bun test tests/unit/auth-github.test.ts
   ```
3. **Submit Validation Verdict (`task:review` or `task:reject`):**
   ```bash
   bun harness.ts task:review \
     --run .capsules/my-feature \
     --task task-gh-auth \
     --validator val-1 \
     --token <validation-token> \
     --status pass \
     --summary "GitHub OAuth2 flows verified with clean unit test exit code 0"
   ```

---

## 🏁 Step 6: Completeness Critic Review & Run Completion (`run:complete`)

1. **Execute Global Run Gates:**
   ```bash
   bun harness.ts run:exec \
     --run .capsules/my-feature \
     --gate gate-run-completion \
     --actor coordinator \
     -- bun test tests/unit
   ```
2. **Completeness Critic Evaluation:**
   ```bash
   bun harness.ts critic:start \
     --run .capsules/my-feature \
     --critic critic-lead

   bun harness.ts critic:review \
     --run .capsules/my-feature \
     --critic critic-lead \
     --token <critic-token> \
     --decision approve \
     --summary "All OAuth2 provider requirements implemented and integration suites passing"
   ```
3. **Seal Run Completion:**
   ```bash
   bun harness.ts run:complete \
     --run .capsules/my-feature \
     --actor coordinator

   bun harness.ts run:status --run .capsules/my-feature
   ```
4. **Commit and Push:**
   ```bash
   git add src/ tests/
   git commit -m "feat(auth): implement oauth2 github and google providers"
   git push origin main
   ```

---

[⬅ Previous: Stale Worker & Torn Tail Recovery](../08-durability-recovery/03-stale-worker-and-torn-tail-recovery.md) | [Master Table of Contents](../README.md) | [Next: CLI Command Reference ➡](./02-cli-command-reference.md)
