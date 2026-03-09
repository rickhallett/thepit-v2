# Darkcat Review — phase2-ui Branch

**Reviewer model:** claude (claude-opus-4-6)

---

## Section 1: Narrative Report

### Scope & Limitations

This review covers the `phase2-ui` branch diff against `main`. The diff includes:
- Route handlers: `/api/reactions`, `/api/short-links`, `/api/winner-vote`
- Pages: `/arena`, `/b/[id]`, `/bout/[id]` (modifications), `/leaderboard`
- Components: `arena.tsx` (modifications), `message-card.tsx` (modifications), `preset-card.tsx`, `share-panel.tsx`, `leaderboard-table.tsx`
- QA signoff doc and plan updates
- Deletions of tooling (`bin/qa-progress`, `bin/triangulate`), decision docs (SD-317, SD-318), review artifacts, darkcat pipeline docs, QA master checklist, lexicon downgrades

**Critical limitation:** The library implementation files imported by the route handlers (`lib/engagement/reactions.ts`, `lib/engagement/votes.ts`, `lib/engagement/leaderboard.ts`, `lib/sharing/short-links.ts`) are not present in the diff and do not exist on the current branch. The review of route handlers is therefore incomplete — I can assess the route-level logic but cannot verify the correctness of `toggleReaction`, `castWinnerVote`, `computeFingerprint`, `createShortLink`, `resolveShortLink`, or `getLeaderboardData`. I will not infer their implementations.

### Theme 1: Input Validation Gaps

**WinnerVoteRequestSchema** (`app/api/winner-vote/route.ts:411`): The schema is imported but not visible. The route destructures `{ boutId, agentId }` from `parsed.data`. Without seeing the schema, I cannot verify whether `boutId` and `agentId` enforce minimum length (`.min(1)`), format constraints, or type narrowing. Given the pattern observed in the diff's own examples (the review instructions cite `topic` missing `.min(1)` as a known gap), this warrants verification.

**ReactionRequestSchema** (`app/api/reactions/route.ts:276`): Same concern — schema imported but not visible. The route destructures `{ boutId, turnIndex, reactionType }`. `turnIndex` should be a non-negative integer; `reactionType` should be an enum. Cannot verify.

**ShortLinkRequestSchema** (`app/api/short-links/route.ts:358-359`): Imported but not visible. The route destructures only `{ boutId }`. No auth required — any caller can create a short link for any existing bout, including non-completed bouts, or bouts belonging to other users. This is stated as intentional in the docstring ("No auth required — anyone can create a short link for a public bout") but creates a potential abuse vector: automated short link generation for all bouts in the database.

### Theme 2: Rate Limiting & Identity Gaps

**Short links endpoint has no rate limiting** (`app/api/short-links/route.ts`). Every other mutation endpoint in the diff has rate limiting (reactions: 30/min per IP, votes: 60/hr per user). Short link creation has none. Since it's unauthenticated and hits the database (SELECT + INSERT), it's vulnerable to trivial enumeration/DoS. The endpoint is idempotent (same boutId → same slug) which mitigates data corruption, but the database load remains.

**Reactions rate limiting keys on raw IP** (`app/api/reactions/route.ts:310`), while reactions fingerprinting uses a hashed variant via `computeFingerprint(userId, ip)`. The rate limiter uses `ip` directly while the identity system uses a hashed derivative. This isn't a bug per se, but the two systems have different granularity — rate limiting sees raw IPs, reaction identity sees hashed IPs. If the proxy doesn't set `x-forwarded-for` or `x-real-ip`, all clients collapse to `127.0.0.1`, sharing both the rate limit bucket and the fingerprint identity. Every anonymous user becomes the same user.

**Reactions IP extraction is spoofable** (`app/api/reactions/route.ts:281-292`). The `getClientIp` function trusts `x-forwarded-for` directly, taking the first IP in the chain. Without upstream proxy configuration that strips/overwrites this header, any client can set an arbitrary `x-forwarded-for` value to:
1. Bypass rate limiting (different IP per request)
2. Impersonate other users' reaction fingerprints (react/un-react as someone else)
3. Attribute reactions to arbitrary IP addresses

This is standard for edge-proxied deployments (Vercel strips and re-adds the header), but the code has no comment acknowledging the trust assumption. If deployed behind a different infrastructure, this is a silent security regression.

### Theme 3: Error Handling Inconsistencies

**Reactions route swallows errors generically** (`app/api/reactions/route.ts:330-333`). The catch block returns `errorResponse(500, API_ERRORS.INTERNAL, "Failed to toggle reaction")` for any error from `toggleReaction`. If `toggleReaction` throws a UNIQUE constraint violation (concurrent toggle), the user gets an opaque 500 instead of a meaningful response. Compare this with `winner-vote/route.ts:446-449` which has specific handling for `alreadyVoted`. The two endpoints in the same domain (engagement) handle conflicts differently.

**Winner vote uses string literal `"ALREADY_VOTED"` instead of `API_ERRORS` constant** (`app/api/winner-vote/route.ts:448`). Every other error code in the diff uses `API_ERRORS.XXX`. This one uses a raw string, which makes it invisible to grep for API error codes and inconsistent with the established pattern.

### Theme 4: Client-Side Concerns

**PresetCard generates boutId client-side with `nanoid(21)`** (`components/arena/preset-card.tsx:2007`). The user navigates to `/bout/${boutId}?presetId=...`. The bout page then looks up this ID in the database. If the bout doesn't exist (it won't, because it was just generated), the page falls through to the `initialBout ?? null` path. The auto-start logic (`search.presetId ? { ... } : undefined` in `app/bout/[id]/page.tsx:53-55`) passes the preset/topic/model info to the Arena component, which presumably triggers a bout creation. This flow has a race condition window: if the user refreshes the page before the bout is created, they'll hit a page with no bout data and no auto-start params (the search params are in the URL but the bout row doesn't exist yet). The behaviour depends on the Arena component's handling of `autoStart` with no `initialBout`, which I cannot verify from the diff.

**PresetCard `isSubmitting` state has no timeout or error recovery** (`components/arena/preset-card.tsx:2000-2006`). If `router.push` fails silently (which it can in some Next.js edge cases), the button stays permanently disabled ("Starting...") with no way for the user to retry.

**SharePanel `navigator.clipboard.writeText` has no error handling** (`components/engagement/share-panel.tsx:2187`). `navigator.clipboard` requires a secure context (HTTPS) and can throw in various browser configurations (iframes, sandboxed contexts, permission denied). The `await` will throw and the error will be uncaught, silently breaking the copy button without user feedback.

**SharePanel creates short link on every mount** (`components/engagement/share-panel.tsx:2123-2140`). The `useEffect` fires on mount and creates a short link via POST. If the component is remounted (React strict mode, navigation, parent re-render), it fires again. The API is idempotent so this doesn't create data issues, but it's unnecessary network traffic. The `shortSlug` prop provides an escape hatch, but the default path always hits the API.

**LeaderboardTable styling is inconsistent with the rest of the app** (`components/leaderboard/leaderboard-table.tsx`). The leaderboard uses `bg-white`, `bg-gray-50`, `bg-black text-white`, `border-2 border-black` — a stark black-and-white theme. The rest of the app uses `stone-*` variants (`bg-stone-900`, `bg-stone-800`, `text-stone-400`). The preset card, arena, and message card all use the stone palette. The leaderboard looks like it belongs to a different application.

### Theme 5: Governance Artifacts — Deletions

The diff deletes significant governance infrastructure:
- `bin/qa-progress` (511 lines) — QA checklist CLI tool
- `bin/triangulate` (751 lines) — Cross-model triangulation parser
- `docs/decisions/SD-317-qa-sequencing-data-products.md` and `SD-318-darkcat-alley.md` — Decision documents
- `docs/internal/weaver/darkcat-alley.md`, `darkcat-alley-sequencing.md`, `darkcat-review-instructions.md`, `darkcat-prompt-*.md` — Process documentation
- `docs/internal/weaver/code-review-2026-03-09.md`, `code-review-codex-52.md`, `cross-model-triangulation.md` — Review artifacts
- `docs/internal/weaver/qa-master-checklist.yaml` (979 lines) — Master QA checklist
- Lexicon downgraded from v0.25 to v0.24 (darkcat-alley entry removed)
- Session decisions SD-317 and SD-318 removed from chain
- Backlog items BL-004 and BL-005 removed

This is a large governance rollback. The AGENTS.md references to SD-317 and SD-318 are removed, the lexicon entry for `darkcat_alley` is removed, and the session decisions index is reset from 318 to 316. The `bin/triangulate` tool that this very review's instructions reference is being deleted in the same branch. This appears to be a version-state divergence: the review input file references tooling (`bin/triangulate`) and decisions (SD-317, SD-318) that this branch deletes.

I note this but do not classify it as a code defect — it's a governance decision.

### Theme 6: Page & Route Architecture

**`/b/[id]` short link page** (`app/b/[id]/page.tsx:509-522`). The page resolves a short link slug and redirects to `/bout/{boutId}`. The `resolveShortLink` function is not in the diff. The comment says "Task 25 will convert this into a full replay page." Currently it's a redirect-only page with no caching headers, which means every short link access hits the database.

**Leaderboard page fetches on every request** (`app/leaderboard/page.tsx:589`). `getLeaderboardData(timeRange)` is called in a server component with no caching directive. For a page that could be static or ISR-cached, this means every page load queries the database for vote aggregation. Given the prior review's finding that leaderboard uses in-memory aggregation, this could be a performance concern at scale.

**`/bout/[id]` autoStart has no validation** (`app/bout/[id]/page.tsx:53-55`). The `presetId`, `topic`, and `model` values come directly from `searchParams` with no validation. While these are passed to a client component (Arena) which presumably validates them, unsanitized searchParams reaching server-rendered output is a code smell. The values aren't rendered directly in server HTML (they're passed as props to a client component), so this isn't an XSS vector, but it's worth noting.

---

## Section 2: Structured Findings

```yaml
review:
  model: "claude (claude-opus-4-6)"
  date: "2026-03-09"
  branches:
    - "phase2-ui"
  base_commit: "unknown"

findings:
  - id: F-001
    branch: "phase2-ui"
    file: "app/api/short-links/route.ts"
    line: "1-51"
    severity: medium
    watchdog: WD-CB
    slopodar: none
    title: "Short links endpoint has no rate limiting"
    description: >
      Every other mutation endpoint in the diff has rate limiting (reactions: 30/min,
      votes: 60/hr). Short link creation has none. Unauthenticated, hits DB on every
      call. Idempotency prevents data corruption but not DB load from enumeration/DoS.
    recommendation: "Add rate limiter (e.g., 10/min per IP) matching the pattern in reactions/votes routes"

  - id: F-002
    branch: "phase2-ui"
    file: "app/api/reactions/route.ts"
    line: "281-292"
    severity: high
    watchdog: WD-PG
    slopodar: paper-guardrail
    title: "x-forwarded-for trusted without proxy trust boundary documentation"
    description: >
      getClientIp trusts x-forwarded-for directly, taking first IP in chain.
      Without upstream proxy stripping, any client can spoof their IP to bypass
      rate limiting and impersonate other users' reaction fingerprints.
      Falls back to 127.0.0.1 if no headers present, collapsing all users.
    recommendation: "Document the proxy trust assumption. Consider validating IP format. Add comment noting Vercel-specific behaviour."

  - id: F-003
    branch: "phase2-ui"
    file: "app/api/winner-vote/route.ts"
    line: "448"
    severity: low
    watchdog: WD-CB
    slopodar: none
    title: "ALREADY_VOTED uses string literal instead of API_ERRORS constant"
    description: >
      All other error codes in the codebase use API_ERRORS.XXX constants.
      This one uses a raw string "ALREADY_VOTED". Inconsistent with the established
      pattern and invisible to grep-based error code auditing.
    recommendation: "Add ALREADY_VOTED to API_ERRORS constant object, or use API_ERRORS.CONFLICT"

  - id: F-004
    branch: "phase2-ui"
    file: "app/api/reactions/route.ts"
    line: "330-333"
    severity: medium
    watchdog: WD-LRT
    slopodar: none
    title: "Reaction toggle errors return opaque 500 for all failure modes"
    description: >
      The catch block returns a generic 500 for any toggleReaction error,
      including UNIQUE constraint violations from concurrent toggles.
      Compare with winner-vote route which has specific alreadyVoted handling.
      Two endpoints in the same domain handle conflicts differently.
    recommendation: "Catch specific error types (DB constraint violation) and return appropriate status codes (409 for conflict)"

  - id: F-005
    branch: "phase2-ui"
    file: "components/engagement/share-panel.tsx"
    line: "87"
    severity: low
    watchdog: WD-LRT
    slopodar: none
    title: "navigator.clipboard.writeText has no error handling"
    description: >
      navigator.clipboard requires secure context (HTTPS) and can throw
      in iframes, sandboxed contexts, or when permission is denied.
      The await will throw uncaught, silently breaking the copy button
      without user feedback.
    recommendation: "Wrap in try/catch, fall back to document.execCommand('copy') or show error toast"

  - id: F-006
    branch: "phase2-ui"
    file: "components/leaderboard/leaderboard-table.tsx"
    line: "1-185"
    severity: low
    watchdog: WD-CB
    slopodar: none
    title: "Leaderboard uses black/white/gray palette inconsistent with app stone palette"
    description: >
      The leaderboard uses bg-white, bg-gray-50, bg-black, border-2 border-black.
      The rest of the app uses stone-* variants (bg-stone-900, bg-stone-800, text-stone-400).
      Visually jarring — component looks like it belongs to a different application.
    recommendation: "Replace with stone palette to match arena, message-card, and preset-card components"

  - id: F-007
    branch: "phase2-ui"
    file: "components/arena/preset-card.tsx"
    line: "2000-2006"
    severity: low
    watchdog: none
    slopodar: none
    title: "PresetCard isSubmitting has no timeout or error recovery"
    description: >
      If router.push fails silently, the button stays permanently disabled
      with text "Starting..." and no way for the user to retry.
      No timeout, no error handling on the navigation call.
    recommendation: "Add try/catch around router.push with setIsSubmitting(false) on failure, or add a timeout reset"

  - id: F-008
    branch: "phase2-ui"
    file: "app/api/reactions/route.ts"
    line: "307-310"
    severity: medium
    watchdog: WD-LRT
    slopodar: none
    title: "Rate limiter keys on raw IP while fingerprint uses hashed IP"
    description: >
      Rate limiting uses raw ip as the key. Reaction identity uses
      computeFingerprint(userId, ip) which is a hashed derivative.
      If proxy doesn't set forwarding headers, all anonymous users collapse
      to 127.0.0.1, sharing both rate limit and fingerprint identity.
    recommendation: "Document the proxy dependency. Consider keying rate limit on fingerprint for consistency."

  - id: F-009
    branch: "phase2-ui"
    file: "app/api/short-links/route.ts"
    line: "1-51"
    severity: low
    watchdog: WD-CB
    slopodar: none
    title: "Short link creation accepts non-completed bouts"
    description: >
      The endpoint verifies bout existence but not bout status. Short links
      can be created for bouts that are still running, pending, or failed.
      Sharing a link to an in-progress bout may produce a poor user experience
      on the replay page.
    recommendation: "Add status check: only create short links for completed bouts, or document the intentional behaviour"

  - id: F-010
    branch: "phase2-ui"
    file: "app/leaderboard/page.tsx"
    line: "589"
    severity: low
    watchdog: none
    slopodar: none
    title: "Leaderboard page has no caching — queries DB on every request"
    description: >
      getLeaderboardData is called in a server component with no caching
      directive (no revalidate, no cache headers). Combined with the prior
      finding that leaderboard does in-memory aggregation, every page load
      fetches and aggregates all votes. Will not scale.
    recommendation: "Add ISR revalidation (e.g., revalidate = 60) or cache the aggregation result"

  - id: F-011
    branch: "phase2-ui"
    file: "components/arena/message-card.tsx"
    line: "31-34"
    severity: low
    watchdog: WD-SH
    slopodar: none
    title: "Reaction key format assumes turnIndex:type but has no type documentation"
    description: >
      userReactions is a Set<string> with keys like "0:heart", "1:fire".
      The key format is constructed in MessageCard (turnIndex + ":" + type)
      but there is no type definition, comment, or shared constant defining
      this format. The parent component must know to construct the same format.
      Fragile coupling via implicit string convention.
    recommendation: "Extract key generation to a shared utility function or document the convention"

  - id: F-012
    branch: "phase2-ui"
    file: "components/engagement/share-panel.tsx"
    line: "23-39"
    severity: low
    watchdog: none
    slopodar: none
    title: "SharePanel creates short link on every mount without deduplication"
    description: >
      The useEffect fires on mount and POSTs to /api/short-links. In React
      strict mode (dev) or on parent re-renders, this fires multiple times.
      The API is idempotent so no data issues, but unnecessary network traffic.
      No AbortController cleanup on unmount — response may arrive after unmount.
    recommendation: "Add AbortController cleanup in useEffect return. Consider caching the slug in parent state."

  - id: F-013
    branch: "phase2-ui"
    file: "app/b/[id]/page.tsx"
    line: "509-522"
    severity: low
    watchdog: none
    slopodar: none
    title: "Short link redirect has no caching — DB lookup on every access"
    description: >
      Every short link access queries resolveShortLink with no caching.
      Short link mappings are immutable (same boutId always returns same slug),
      so this is a missed caching opportunity. High-traffic shared links
      will repeatedly hit the database for the same lookup.
    recommendation: "Add Cache-Control or use Next.js revalidation for this route"
```
