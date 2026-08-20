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

## SEC-AUTHN-003

rule: A password or credential is checked against a rate limit or lockout policy, so an attacker cannot attempt unlimited guesses against one account
rationale: Without a limit, a weak or common password is only a matter of time to brute-force
how-to-check: Attempt repeated failed logins against the same account and confirm the system slows, locks, or challenges after a bounded number of attempts
severity: important
sources:
  - OWASP Top 10 2021, A07:2021 (Identification and Authentication Failures)

## SEC-AUTHZ-003

rule: A batch or bulk operation checks authorization on every individual item in the batch, not only on the batch request as a whole
rationale: A bulk endpoint authorized once at the top can be used to smuggle unauthorized ids into an otherwise-permitted batch
how-to-check: Send a bulk request containing a mix of authorized and unauthorized item ids and confirm each item is checked independently
severity: critical
sources:
  - OWASP API Security Top 10 2023, API1:2023 (Broken Object Level Authorization)

## SEC-AUTHZ-004

rule: A default deny is the fallback for an authorization check; an unrecognized role, missing permission record, or unhandled case denies access rather than falling through to allow
rationale: A fail-open authorization check turns any bug or unhandled case in the permission logic into an access-control bypass
how-to-check: Trace the authorization function's control flow for a path that reaches "allow" without an explicit matched grant
severity: critical
sources:
  - OWASP ASVS, V4 "Access Control" — fail securely

## SEC-INPUT-004

rule: Deserializing untrusted input uses a schema-validating parser, not a dynamic deserializer capable of instantiating arbitrary types
rationale: Unrestricted deserialization of attacker-controlled data is a well-known route to remote code execution in several ecosystems
how-to-check: Grep new deserialization of request bodies for a library or pattern capable of type coercion beyond plain JSON/data values
severity: critical
sources:
  - OWASP Top 10 2021, A08:2021 (Software and Data Integrity Failures)

## SEC-INPUT-005

rule: A size or rate limit exists on any input a client fully controls (upload size, request body size, array length, recursion depth)
rationale: An unbounded input lets a single request exhaust memory, CPU, or storage — a denial of service that costs the attacker one request
how-to-check: Send an oversized version of the new input (large body, huge array, deeply nested object) and confirm it is rejected rather than processed
severity: important
sources:
  - OWASP API Security Top 10 2023, API4:2023 (Unrestricted Resource Consumption)

## SEC-XSS-001

rule: Data rendered into HTML that originated from user input is escaped or rendered through a mechanism that auto-escapes, never inserted via a raw/`dangerouslySetInnerHTML`-style sink without sanitization
rationale: Unescaped user content rendered as HTML is the direct mechanism of stored and reflected XSS
how-to-check: Grep the diff for a raw-HTML insertion sink and trace whether its input can contain user-supplied content
severity: critical
sources:
  - OWASP Top 10 2021, A03:2021 (Injection) — Cross-Site Scripting

## SEC-CSRF-001

rule: A state-changing request triggered from a browser session (cookie-authenticated) is protected against cross-site request forgery — a CSRF token, `SameSite` cookie, or equivalent
rationale: Without this, any site the user's browser visits can trigger an authenticated action on their behalf without their knowledge
how-to-check: For a new cookie-authenticated, state-changing endpoint, confirm a CSRF defense is present and actually enforced, not merely available
severity: important
sources:
  - OWASP Cheat Sheet Series, "Cross-Site Request Forgery Prevention"

## SEC-SSRF-001

rule: A server-side request built from a user-supplied URL validates the target against an allowlist, not merely a denylist of obviously internal hosts
rationale: A denylist alone is bypassed by DNS rebinding, redirects, and alternate IP representations of the same forbidden target
how-to-check: For a new outbound request whose destination comes from user input, check whether the destination is constrained to an explicit allowlist
severity: critical
sources:
  - OWASP Top 10 2021, A10:2021 (Server-Side Request Forgery)

## SEC-DEP-003

rule: A dependency's license is compatible with the project's own before it is added, not discovered after the fact
rationale: An incompatible license discovered post-hoc can force a late, disruptive removal of a now-load-bearing dependency
how-to-check: Check the new dependency's declared license against the project's license policy before merging
severity: minor
sources:
  - OpenChain Specification — license compliance review

## SEC-DEP-004

rule: A dependency is pulled from the canonical registry/source over an integrity-checked channel (lockfile hash, checksum), not an unpinned URL or an unverified mirror
rationale: An unverified fetch is a supply-chain injection point — the dependency you audited is not provably the one that gets installed
how-to-check: Confirm the new dependency resolves through the project's lockfile with an integrity hash, not a loose version range against an unpinned source
severity: important
sources:
  - OWASP Top 10 2021, A08:2021 (Software and Data Integrity Failures)

## SEC-CRYPTO-002

rule: A random value used for a security purpose (token, nonce, session id, password reset code) is generated by a cryptographically secure random source, never `Math.random()` or an equivalent non-CSPRNG
rationale: A predictable "random" value defeats the entire point of using one for a security-sensitive purpose
how-to-check: Grep new security-token generation for `Math.random()` or another non-cryptographic RNG
severity: critical
sources:
  - OWASP ASVS, V6.3 "Random Values"

## SEC-CRYPTO-003

rule: A comparison of two secret values (token, HMAC, password hash) uses a constant-time comparison, not `===` or a short-circuiting string compare
rationale: A short-circuiting compare leaks timing information that lets an attacker recover a secret byte by byte
how-to-check: Grep new secret-comparison code for `===`/`==` against a token or signature rather than a constant-time compare function
severity: important
sources:
  - OWASP Cheat Sheet Series, "Authentication" — timing attack resistance

## SEC-SESSION-002

rule: A session cookie is marked `HttpOnly`, `Secure`, and an appropriate `SameSite` value, not left to browser defaults
rationale: A cookie missing these flags is readable by injected script (`HttpOnly`), sendable over plaintext (`Secure`), or attachable to cross-site requests (`SameSite`)
how-to-check: Inspect the `Set-Cookie` header for a new session cookie for all three attributes
severity: important
sources:
  - OWASP Cheat Sheet Series, "Session Management"

## SEC-HEADERS-002

rule: A response that renders user content sets `X-Content-Type-Options: nosniff` and an appropriate `Content-Security-Policy`, rather than relying on the browser's default MIME sniffing
rationale: MIME sniffing lets a browser reinterpret an uploaded file as executable script content the server never intended to serve as such
how-to-check: Check new file-serving or user-content endpoints' response headers for `nosniff` and a CSP
severity: minor
sources:
  - OWASP Secure Headers Project

## SEC-UPLOAD-001

rule: An uploaded file's type is validated by its actual content, not trusted from its filename extension or client-supplied MIME type
rationale: A filename or client-supplied content-type is fully attacker-controlled and trivially spoofed
how-to-check: For a new upload path, confirm the file's magic bytes/actual content are checked, not only its extension or the `Content-Type` header
severity: important
sources:
  - OWASP File Upload Cheat Sheet

## SEC-ERROR-001

rule: An error response returned to the client does not include a stack trace, internal file path, or raw exception message from production
rationale: A verbose error response hands an attacker exactly the internal detail they need to craft the next probe
how-to-check: Trigger an unhandled error against the new endpoint in a production-like configuration and inspect the response body for internal detail
severity: important
sources:
  - OWASP Top 10 2021, A05:2021 (Security Misconfiguration)

## SEC-PRIVACY-001

rule: Personally identifiable information collected or displayed is limited to what the feature actually needs, and is not logged, cached, or exported beyond that need
rationale: PII collected "just in case" or copied into a log/cache widens the breach surface for data the feature never used
how-to-check: For new PII-touching code, confirm each field collected is read somewhere the feature actually needs it, and check it against SEC-LOG-001
severity: important
sources:
  - OWASP Top 10 2021, A01:2021 (Broken Access Control) — data minimization principle

## SEC-IAC-001

rule: Infrastructure or deployment configuration does not grant a service or role broader permissions than the specific actions it performs
rationale: An over-broad service role turns a single compromised function into access across everything that role can touch
how-to-check: Compare a new or changed IAM policy/role definition against the actual API calls the service makes
severity: important
sources:
  - OWASP ASVS, V1 "Architecture, Design and Threat Modeling" — least privilege

## SEC-CLICKJACK-001

rule: A page that must never render inside another site's frame sends `X-Frame-Options` or a `Content-Security-Policy: frame-ancestors` directive that says so
rationale: Without a frame-denying header, an attacker can overlay invisible UI over the real page and trick a user into clicking a real action they never saw
how-to-check: Request the changed page's response headers and confirm `X-Frame-Options` or `frame-ancestors` is present and restrictive
severity: important
sources:
  - OWASP Cheat Sheet Series, "Clickjacking Defense"

## SEC-REDIRECT-001

rule: A redirect target that comes from user input (a `next`/`return_to` parameter, a callback URL) is checked against an allowlist of permitted destinations before the app redirects to it
rationale: An unchecked redirect target turns a trusted domain's own link into a launchpad for a convincing phishing redirect
how-to-check: Supply an external URL as the redirect parameter on a new redirect path and confirm the app refuses it rather than following it
severity: important
sources:
  - OWASP Cheat Sheet Series, "Unvalidated Redirects and Forwards"

## SEC-JWT-001

rule: JWT verification pins the expected signing algorithm and key server-side and never trusts the algorithm named in the token's own header; expiry (`exp`) is enforced on every verification
rationale: Trusting a token's self-declared algorithm lets an attacker switch to `none` or to a weaker/asymmetric-to-symmetric confusion and forge a token the server then accepts
how-to-check: Grep new JWT verification code for the algorithm being read from the token itself rather than fixed by the verifier, and confirm expired tokens are rejected
severity: critical
sources:
  - RFC 8725, "JSON Web Token Best Current Practices"

## SEC-MASSASSIGN-001

rule: A request body bound onto a data model allowlists the fields it accepts, rather than assigning every field the client happened to send
rationale: A blind bind lets a client set a field it was never meant to control — a role, an owner id, a price — simply by adding it to the request body
how-to-check: For a new endpoint binding a request body to a model, send an extra field the API never documented (e.g. `role: "admin"`) and confirm it has no effect
severity: critical
sources:
  - OWASP Cheat Sheet Series, "Mass Assignment"

## SEC-XXE-001

rule: An XML parser processing untrusted input has external entity resolution and DTD processing disabled
rationale: A default XML parser that resolves external entities lets crafted XML read local files, reach internal network endpoints, or exhaust memory via entity expansion
how-to-check: Grep new XML-parsing code for the parser's DTD/external-entity settings; confirm they are explicitly disabled rather than left at the library default
severity: critical
sources:
  - OWASP Cheat Sheet Series, "XML External Entity (XXE) Prevention"

## SEC-HSTS-001

rule: A site served exclusively over HTTPS sends `Strict-Transport-Security` with `includeSubDomains`, rather than relying on an HTTP-to-HTTPS redirect alone
rationale: A redirect-only setup still lets the very first request over plain HTTP be intercepted before the redirect ever happens; HSTS tells the browser to skip HTTP entirely on repeat visits
how-to-check: Request the changed site's response headers and confirm `Strict-Transport-Security` is present with a meaningful `max-age`
severity: minor
sources:
  - OWASP Cheat Sheet Series, "HTTP Strict Transport Security"

## SEC-TENANT-001

rule: A query or write in a multi-tenant system is scoped by the acting tenant's own id resolved server-side, never by a tenant id the client merely supplied in the request
rationale: A client-supplied tenant id is exactly as trustworthy as any other client-supplied identity field — trivially changed to read or write another tenant's data
how-to-check: Call the changed endpoint with a valid session but a different tenant id in the request, and confirm the server ignores it in favor of the session's own tenant
severity: critical
sources:
  - OWASP API Security Top 10 2023, API1:2023 (Broken Object Level Authorization) — tenant isolation as a special case

## SEC-CI-001

rule: A secret or token used by a CI/CD pipeline is masked in build logs, never echoed, printed, or interpolated into a log line the pipeline records
rationale: A CI log is frequently readable by a wider audience than the production system the secret protects, and it is retained long after the run that leaked it
how-to-check: Grep new pipeline configuration and scripts for a secret-holding variable passed to a command or echo without the CI platform's masking mechanism
severity: important
sources:
  - OWASP Top 10 2021, A09:2021 (Security Logging and Monitoring Failures)

## SEC-SUPPLYCHAIN-001

rule: An internal or private package name is registered (or otherwise reserved) on the public registry it would collide with, so an internal-only dependency name cannot be shadowed
rationale: Dependency confusion attacks publish a public package under an internal project's exact name at a higher version, and misconfigured installs pull the attacker's package instead
how-to-check: For a new internally-named package, confirm the corresponding public registry name is claimed, or that the install configuration is scoped to prevent public-registry fallback
severity: important
sources:
  - OWASP Top 10 2021, A08:2021 (Software and Data Integrity Failures) — dependency confusion
