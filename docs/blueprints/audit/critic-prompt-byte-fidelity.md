# Critic Prompt Byte Fidelity Audit Blueprint

## Overview
Analyzes critic operations and prompt fidelity.

## Total Findings: 9

### Key Failure Vectors
1. Critic false approvals due to missing explicit failure cases.
2. Prompt token truncation leading to incomplete criteria.
3. Over-anchoring on sample outputs rather than generalized rules.
4. Loss of byte-for-byte exactness in regex-based validations.
5. Critic prompt drift across multiple task iterations.
6. Ambiguous scoring metrics for completeness.
7. Lack of counter-factual testing in prompts.
8. Incorrect handling of escaped characters in code blocks.
9. Missing fallback conditions for malformed input.

## Refactoring Proposals
- Introduce strict schema validation for critic prompts.
- Implement counter-factual edge cases in tests.
- Enhance byte-level checking for critical regex.
