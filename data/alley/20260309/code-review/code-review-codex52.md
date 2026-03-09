### Section 1: Narrative Report (human-readable)

Branch reviewed: `phase2-ui`.

1) `/api/reactions` rate limiting is implemented but the IP source is entirely client-controlled via `x-forwarded-for`. In a typical proxy setup this header can be spoofed unless the platform strips or overwrites it. That makes the “30/min per IP” control a paper guardrail: clients can rotate the header to bypass the limiter and to mint new anonymous fingerprints.

2) `/bout/[id]` now accepts `presetId`, `topic`, and `model` directly from `searchParams` and forwards them into the `Arena` auto-start flow without validation. There is no allowlist, schema validation, or normalization, so malformed `model` or `presetId` values can propagate into downstream code paths, likely yielding invalid model selection or failed requests instead of being rejected early.

Files not shown but needed to fully assess correctness: `lib/engagement/reactions.ts` (to confirm fingerprint uniqueness constraints) and `lib/sharing/short-links.ts` (to confirm idempotency claims and uniqueness guarantees). I did not infer their contents.

### Section 2: Structured Findings (machine-readable)

```yaml
review:
  model: "codex52"
  date: "2026-03-09"
  branches:
    - "phase2-ui"
  base_commit: "unknown"

findings:
  - id: F-001
    branch: "phase2-ui"
    file: "app/api/reactions/route.ts"
    line: "81-112"
    severity: medium
    watchdog: WD-PG
    slopodar: paper-guardrail
    title: "Rate limit trusts spoofable x-forwarded-for"
    description: >
      The rate limiter keys solely on getClientIp(), which trusts the
      client-supplied x-forwarded-for header. Unless the platform is
      stripping or overwriting this header, clients can spoof IPs and
      bypass the 30/min limit and anonymous fingerprinting.
    recommendation: "Use a trusted platform IP source (e.g. req.ip/headers set by the edge) and reject/ignore untrusted x-forwarded-for values."

  - id: F-002
    branch: "phase2-ui"
    file: "app/bout/[id]/page.tsx"
    line: "36-65"
    severity: medium
    watchdog: none
    slopodar: none
    title: "Auto-start query params forwarded without validation"
    description: >
      presetId, topic, and model are read directly from searchParams
      and passed into Arena auto-start. There is no schema validation
      or allowlist for model/presetId, so invalid inputs can leak into
      downstream execution instead of being rejected early.
    recommendation: "Validate searchParams with a Zod schema or allowlist and drop/normalize invalid values before passing to Arena."
```
