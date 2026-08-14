# 01. Complete End-to-End Tutorial: From User Prompt to Verified Branch

[⬅ Previous: Stale Worker & Torn Tail Recovery](../08-durability-recovery/03-stale-worker-and-torn-tail-recovery.md) | [Master Table of Contents](../README.md) | [Next: CLI Command Reference ➡](./02-cli-command-reference.md)

---

## 🚀 Overview

This hands-on tutorial guides a developer or agent through the complete lifecycle of executing a complex, multi-file software engineering project using `orchestrating-long-tasks`.

By the end of this tutorial, you will understand how to initialize a task capsule, decompose user prompts with 100% line coverage, orchestrate concurrent subagents, validate with adversarial role separation, and mechanically complete a verified run.

---

## 🛠️ Step 1: Initialize the Run Capsule (`init`)

When given a complex project prompt, capture it into an immutable prompt file and initialize the run:

```bash
mkdir -p .harness/my-feature
cat << 'EOF' > .harness/my-feature/prompt.md
Refactor user authentication to support OAuth2 GitHub and Google providers.
All existing unit tests must pass.
Add comprehensive integration tests for token exchange.
EOF

bun orchestrating-long-tasks/scripts/src/entrypoints/harness.ts init \
  --run .harness/my-feature \
  --prompt .harness/my-feature/prompt.md \
  --actor coordinator
```

---

## 📝 Step 2: Planning & Graph Formulation (`plan-apply`)

1. **Claim the Planner Lease:**
   ```bash
   bun .harness/my-feature/runtime/harness.ts claim \
     --run .harness/my-feature \
     --task planner-0 \
     --agent planner \
     --role planner
   ```
2. **Author `requirements.json`:** Decompose every single line of `prompt.md` into atomic requirement objects (`R-OAUTH-GH`, `R-OAUTH-GOOGLE`, `R-TESTS`).
3. **Author `graph.json`:** Structure the tasks DAG with write scopes, dependencies, artifacts, and gate commands.
4. **Apply the Plan:**
   ```bash
   bun .harness/my-feature/runtime/harness.ts plan-apply \
     --run .harness/my-feature \
     --requirements .harness/my-feature/planning/requirements.json \
     --graph .harness/my-feature/planning/graph.json \
     --expected-revision 0 \
     --actor coordinator
   ```

---

## ⚡ Step 3: Schedule & Claim Tasks (`schedule` / `claim`)

1. **Schedule Available Batches:**
   ```bash
   bun .harness/my-feature/runtime/harness.ts schedule \
     --run .harness/my-feature \
     --max-parallel 3 \
     --actor coordinator
   ```
2. **Claim a Task Lease:**
   ```bash
   bun .harness/my-feature/runtime/harness.ts claim \
     --run .harness/my-feature \
     --task task-gh-auth \
     --agent implementer-1 \
     --role implementer
   ```
3. **Generate & Read Role Packet:**
   ```bash
   bun .harness/my-feature/runtime/harness.ts packet \
     --run .harness/my-feature \
     --task task-gh-auth \
     --role implementer \
     --agent implementer-1 \
     --token <implementer-token> \
     --id packet-gh-1
   ```

---

## 💻 Step 4: Implement & Submit (`run` / `submit`)

1. Write code strictly within the assigned `write_scope`.
2. Execute local tests under the watchdog runner:
   ```bash
   bun .harness/my-feature/runtime/harness.ts run \
     --run .harness/my-feature \
     --actor implementer-1 \
     --task task-gh-auth \
     --cwd . \
     -- bun test tests/auth/github.test.ts
   ```
3. Submit task completion report:
   ```bash
   bun .harness/my-feature/runtime/harness.ts submit \
     --run .harness/my-feature \
     --task task-gh-auth \
     --agent implementer-1 \
     --token <implementer-token> \
     --report submit-report.json
   ```

---

## 🔍 Step 5: Adversarial Validation & Gate Execution

1. **Begin Validation with a New Agent:**
   ```bash
   bun .harness/my-feature/runtime/harness.ts begin-validation \
     --run .harness/my-feature \
     --task task-gh-auth \
     --validator validator-1
   ```
2. **Execute Mandatory Gate:**
   ```bash
   bun .harness/my-feature/runtime/harness.ts run \
     --run .harness/my-feature \
     --actor validator-1 \
     --task task-gh-auth \
     --gate gate-gh-auth \
     --cwd . \
     -- bun test tests/auth/github.test.ts
   ```
3. **Submit Validation Review & Attach Gate:**
   ```bash
   bun .harness/my-feature/runtime/harness.ts review \
     --run .harness/my-feature \
     --task task-gh-auth \
     --validator validator-1 \
     --token <validator-token> \
     --review review.json

   bun .harness/my-feature/runtime/harness.ts gate \
     --run .harness/my-feature \
     --task task-gh-auth \
     --gate gate-gh-auth \
     --command-id <cmd-id> \
     --actor coordinator

   bun .harness/my-feature/runtime/harness.ts finish \
     --run .harness/my-feature \
     --task task-gh-auth \
     --actor coordinator
   ```

---

## 🏁 Step 6: Final Critic Review & Run Completion (`complete`)

1. Execute and attach global run gates (`gate-run`).
2. Run Completeness Critic review:
   ```bash
   bun .harness/my-feature/runtime/harness.ts begin-critic \
     --run .harness/my-feature \
     --critic critic-1

   bun .harness/my-feature/runtime/harness.ts review-completion \
     --run .harness/my-feature \
     --critic critic-1 \
     --token <critic-token> \
     --review critic-review.json
   ```
3. Mechanically complete the run:
   ```bash
   bun .harness/my-feature/runtime/harness.ts complete \
     --run .harness/my-feature \
     --actor coordinator
   ```
4. Commit and push:
   ```bash
   git add src/ tests/
   git commit -m "feat(auth): implement oauth2 github and google providers"
   git push origin main
   ```

---

[⬅ Previous: Stale Worker & Torn Tail Recovery](../08-durability-recovery/03-stale-worker-and-torn-tail-recovery.md) | [Master Table of Contents](../README.md) | [Next: CLI Command Reference ➡](./02-cli-command-reference.md)
