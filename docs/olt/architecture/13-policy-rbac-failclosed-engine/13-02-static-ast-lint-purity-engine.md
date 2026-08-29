# Static AST Lint Purity Engine (The 10 Rules)

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > [Chapter 13](./index.md) > 13-02 Static AST Purity

---

[⏮️ Previous: 13-01 Mechanical RBAC Compiler](13-01-mechanical-rbac-compiler.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 13-03 Fail-Closed Permission Gates](13-03-fail-closed-permission-gates.md)
---

## 1. The 10 AST Static Purity Checkers

The OLT AST Engine parses TypeScript source code into Abstract Syntax Trees using `ts-morph` / TypeScript compiler APIs, enforcing 10 non-negotiable purity rules:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       THE 10 AST STATIC PURITY CHECKERS                     │
├────┬─────────────────────────────┬─────────────────────────────────────────┤
│ 01 │ any_type_ban                │ Prohibits explicit or inferred any.     │
│ 02 │ compiler_suppression_ban    │ Prohibits // @ts-ignore, @ts-nocheck.   │
│ 03 │ non_null_assertion_ban      │ Prohibits postfix ! operator.           │
│ 04 │ vendor_leak_ban             │ Prohibits importing internal vendor pkg.│
│ 05 │ logical_or_fallback_ban     │ Prohibits unsafe a || b fallback typing.│
│ 06 │ nullish_coalescing_ban      │ Enforces explicit boolean validation.   │
│ 07 │ mock_tautology_ban          │ Catches expect(true).toBe(true).        │
│ 08 │ trivial_assertion_ban       │ Catches assertions with 0 variables.    │
│ 09 │ empty_test_body_ban         │ Catches it('should pass', () => {}).    │
│ 10 │ trivial_early_return_ban    │ Catches functions that always return 0. │
└────┴─────────────────────────────┴─────────────────────────────────────────┘
```

---

[⏮️ Previous: 13-01 Mechanical RBAC Compiler](13-01-mechanical-rbac-compiler.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 13-03 Fail-Closed Permission Gates](13-03-fail-closed-permission-gates.md)
---
