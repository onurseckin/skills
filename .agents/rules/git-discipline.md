---
description: Git discipline rules covering exact path staging, commit verification on merit, destructive command bans, and zero attribution
globs:
  - "*"
alwaysApply: true
---

# Git Discipline & Reflog Safety Invariants

- Exact Path Staging: Modifying agents must stage ONLY their assigned, disjoint write scopes (`git add <path1> <path2>`). NEVER run bare `git add -A` or `git add .` during task-scoped implementation.
- Total Ban on Destructive Commands: Any command that discards uncommitted work or rewrites the index or worktree from another source is strictly prohibited. Named members (non-exhaustive): `git reset` in any form (including `--soft`, `--hard`, `--mixed`, bare reset), `git checkout -- <path>`, `git checkout .`, `git restore` in any form, `git stash` in any form, `git clean`, `git checkout-index`, `git read-tree`, `git rm --cached`, `git switch --discard-changes`, `git worktree remove --force`, `git filter-branch`, `git filter-repo`, `git commit --amend` on pushed commits, and any force push (`git push --force`).
  - Blocking Resolution Rule: If a working tree state blocks you, the answer is to have the owning party COMMIT it, never to discard it.
  - Positive Recovery Techniques:
    - To undo your own uncommitted edit: edit it back.
    - To commit around foreign staged work: use `git commit -m msg -- <exact paths>`, which ignores staged paths you do not name and leaves them untouched in the index.
- Zero AI Attribution: NEVER add `Co-Authored-By`, `Generated-with-Claude`, or any AI/tool attribution to commit messages, pull request descriptions, or code.
- Commit Verification 100% on Merit: All pre-commit hooks (`lefthook`) must run and pass honestly. `--no-verify` on `git commit` is strictly forbidden. Push `--no-verify` is allowed for authorized pushes to origin main.
- Conventional Commits: Subject must be under 70 characters in the imperative mood with an approved tag (`feat`, `fix`, `chore`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `revert`, `hotfix`, `security`, `deps`, `migration`).
- Strict Ban on History Rewriting: NEVER run `git commit --amend`, `git rebase`, or force push once changes are committed on main.
- Subdomain Staging Safety (Reflog Protection): Stage intermediate task files immediately to ensure crash recovery; stage completed task units to write blobs into `.git/objects/`.
- Native Internal Tools First Invariant: In Antigravity IDE and Antigravity CLI, agents MUST strictly prefer all native internal tools first (`view_file`, `replace_file_content`, `write_to_file`, `grep_search`, `find_by_name`, `list_dir`) for file inspection, search, and modification. Only when an operation cannot be achieved with native internal tools (such as running test suites, typechecks, git commands, builds, or specific CLI binaries) may shell commands (`run_command`) be executed. Shell-based inline file modification or inspection scripts (such as `bun -e`, `node -e`, `python -c`, `sed`, `awk`, or shell redirection to overwrite files) are strictly prohibited.
