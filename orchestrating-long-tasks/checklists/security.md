# Security checklist
Domain: security

Drawn whenever a task's write scope touches authentication, authorization, secrets, user input
handling, dependencies, or anything crossing a trust boundary. Motivated directly by this
overhaul's own audit finding plaintext tokens on disk that no prior reviewer caught (B12.2) — the
standing list a task-only reviewer has no reason to consult.

## SEC-AUTHN-001

rule: A credential or session token is verified on every request that needs it; no endpoint trusts a client-supplied identity field (user id, role) without independently verifying it
rationale: A client-supplied identity field is exactly as trustworthy as the client, which is to say not at all
how-to-check: For a new or changed endpoint, trace where the acting identity comes from; flag any path where it is read from the request body/params rather than a verified session or token
severity: critical
sources:
  - OWASP API Security Top 10 2023, API1:2023 (Broken Object Level Authorization) and API2:2023 (Broken Authentication)

## SEC-AUTHN-002

rule: A failed authentication attempt returns the same generic response regardless of whether the account exists, the password was wrong, or the account is locked
rationale: A response that differs by failure reason lets an attacker enumerate valid accounts one request at a time
how-to-check: Compare the response (status, body, timing) for a nonexistent account versus a wrong password on an existing one
severity: important
sources:
  - OWASP Top 10 2021, A07:2021 (Identification and Authentication Failures)

## SEC-AUTHZ-001

rule: Every object-level operation (get, update, delete by id) checks that the acting identity is authorized for that specific object, not only that they are authenticated
rationale: This is the single most common real-world API vulnerability class: authenticated but not authorized, reachable simply by changing an id in the request
how-to-check: For a new endpoint taking a resource id, confirm an ownership/permission check runs against that exact id before the operation proceeds
severity: critical
sources:
  - OWASP API Security Top 10 2023, API1:2023 (Broken Object Level Authorization)

## SEC-AUTHZ-002

rule: A property-level distinction (a field only an admin should see or set) is enforced server-side on both read and write, never left to client-side hiding alone
rationale: A field merely hidden in the UI is still present in the API response or accepted on write by anyone who inspects network traffic
how-to-check: Call the endpoint directly (bypassing the UI) with a lower-privileged identity and check whether the restricted field is present or settable
severity: critical
sources:
  - OWASP API Security Top 10 2023, API3:2023 (Broken Object Property Level Authorization)

## SEC-SECRET-001

rule: A credential, API key, or token is never written to disk in plaintext, committed to version control, or embedded in a client-shipped bundle
rationale: This is this overhaul's own audit finding — plaintext tokens on disk that no reviewer caught before a checklist existed to look for them
how-to-check: Grep new and touched files for patterns resembling API keys, private keys, connection strings with embedded passwords, or hard-coded tokens
severity: critical
sources:
  - OWASP Top 10 2021, A02:2021 (Cryptographic Failures); this repository's own prior audit finding

## SEC-SECRET-002

rule: A secret rotated or revoked is actually invalidated at its source (provider, IdP), not merely removed from the codebase that referenced it
rationale: Deleting a reference to a leaked secret does not revoke the secret itself; the leaked value remains usable until the issuer invalidates it
how-to-check: For a remediation of a leaked credential, confirm the finding's evidence includes proof of revocation at the provider, not only the code removal
severity: critical
sources:
  - OWASP Top 10 2021, A02:2021 (Cryptographic Failures)

## SEC-INPUT-001

rule: A value used to build a database query, shell command, file path, or HTML fragment is parameterized or escaped for that specific context — never concatenated as a raw string
rationale: String concatenation of untrusted input into an interpreted context is the direct mechanism behind injection, path traversal, and XSS
how-to-check: Grep new query/command/path construction for string concatenation or template interpolation of a request-derived value
severity: critical
sources:
  - OWASP Top 10 2021, A03:2021 (Injection)

## SEC-INPUT-002

rule: A file path built from user input is resolved and checked to remain within its intended directory before being opened
rationale: An unchecked `../` in a user-supplied path reaches files the request was never meant to touch
how-to-check: For a new file-read/write path built from a request parameter, confirm the resolved absolute path is checked against the allowed root
severity: critical
sources:
  - OWASP Top 10 2021, A01:2021 (Broken Access Control) — path traversal

## SEC-INPUT-003

rule: A symlink is not followed when a path outside the caller's control could point one at a file it should not reach
rationale: A crafted symlink can redirect an otherwise-validated path to an arbitrary file on the filesystem
how-to-check: For a new file operation on a path derived from user or agent input, confirm it uses a no-follow read/open, not a symlink-following one
severity: important
sources:
  - CWE-59, "Improper Link Resolution Before File Access"

## SEC-TRANSPORT-001

rule: A request carrying credentials or sensitive data is sent over an encrypted transport; an `http://` (not `https://`) endpoint is never used for it
rationale: Data on an unencrypted transport is readable by anyone positioned on the network path between client and server
how-to-check: Grep new outbound request URLs and configured endpoints for a plain `http://` scheme where credentials or PII travel
severity: critical
sources:
  - OWASP Top 10 2021, A02:2021 (Cryptographic Failures)

## SEC-DEP-001

rule: A new third-party dependency is checked against known vulnerabilities before it is added, and a version pin (not a floating range) is used for anything security-sensitive
rationale: A dependency is code the project runs with its own privileges; adding one without checking is trusting it by default
how-to-check: Run the ecosystem's audit tool (`npm audit`, `bun audit`, or equivalent) against the new dependency before merging
severity: important
sources:
  - OWASP Top 10 2021, A06:2021 (Vulnerable and Outdated Components)

## SEC-DEP-002

rule: A dependency granted filesystem, network, or subprocess access is scoped to only what it needs, not run with the full privileges of the host process by default
rationale: An over-privileged dependency turns any vulnerability in it into a vulnerability in everything it was allowed to touch
how-to-check: For a new tool or dependency granted execution capability, check what access it actually requires against what it is actually given
severity: important
sources:
  - OWASP ASVS, V1 "Architecture, Design and Threat Modeling" — least privilege

## SEC-LOG-001

rule: A log line never contains a password, full token, secret key, or other sensitive credential — even at debug level
rationale: Logs are frequently retained, shipped to third parties, and far more widely readable than the systems that generate the secret in the first place
how-to-check: Grep new log statements for variables holding tokens, passwords, or keys being interpolated directly into the message
severity: critical
sources:
  - OWASP Top 10 2021, A09:2021 (Security Logging and Monitoring Failures)

## SEC-LOG-002

rule: An authentication or authorization failure is logged with enough context to investigate, without logging the credential that was tried
rationale: Under-logging a failed auth attempt blinds incident response; over-logging it leaks the very credential under attack
how-to-check: Trigger an auth failure and inspect the resulting log line for the acting identity and outcome, and confirm the attempted secret is absent
severity: important
sources:
  - OWASP Top 10 2021, A09:2021 (Security Logging and Monitoring Failures)

## SEC-CRYPTO-001

rule: A password or credential at rest is hashed with a purpose-built algorithm (bcrypt, scrypt, Argon2) — never a fast general-purpose hash (MD5, SHA-256 alone) and never reversible encryption
rationale: A fast hash is designed to be cheap to compute, which is exactly the wrong property for resisting an offline brute-force attempt against a stolen database
how-to-check: Grep new credential-storage code for the hashing function used
severity: critical
sources:
  - OWASP ASVS, V2.4 "Credential Storage Requirements"

## SEC-SESSION-001

rule: A session token is invalidated server-side on logout and on password change, not merely discarded client-side
rationale: A client-side-only logout leaves the token valid; anyone who captured it before logout can keep using it
how-to-check: Log out, then replay the previous session token against a protected endpoint and confirm it is rejected
severity: important
sources:
  - OWASP ASVS, V3 "Session Management"

## SEC-HEADERS-001

rule: A response serving user-controllable content sets the appropriate CORS and content-type headers explicitly, rather than defaulting to a permissive wildcard
rationale: A wildcard CORS policy on an endpoint that returns sensitive data lets any origin read it via a cross-site request
how-to-check: Check new endpoints' response headers for `Access-Control-Allow-Origin: *` combined with credentialed or sensitive responses
severity: important
sources:
  - OWASP Top 10 2021, A05:2021 (Security Misconfiguration)
