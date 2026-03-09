# QA Signoff — T-007 through T-022

> Captain verification of bout engine, UI layer, and engagement features.
> Created: 2026-03-08 (T-007–T-016), extended 2026-03-09 (T-020–T-022 + darkcat fixes).
> Covers: Phase 2+3 complete — core product loop with reactions, votes, leaderboard, sharing.
> PR: #1 (phase2-ui → main)

## 1. Gate & Test Suite

- [ ] `pnpm run typecheck` exits 0
- [ ] `pnpm run lint` exits 0 (known: 2 pre-existing AbortController warnings in use-bout.ts)
- [ ] `pnpm run test` — 154 tests total: 145 pass, 9 skip
- [ ] Test files: 15 total (schema, auth/users, auth/referrals, common/api-utils, common/rate-limit, common/env, bouts/presets, bouts/validation, bouts/engine, bouts/streaming, bouts/use-bout, engagement/reactions, engagement/votes, engagement/leaderboard, sharing/short-links)

## 2. Bout Types & Validation (T-007)

- [ ] Read `lib/bouts/types.ts` — BoutStatus enum has `running`, `completed`, `error`
- [ ] Read `lib/bouts/types.ts` — SSEEventType union includes all 7 event types
- [ ] Read `lib/bouts/types.ts` — `VALID_BOUT_MODELS` is `["claude-haiku", "claude-sonnet"]`
- [ ] Read `lib/bouts/types.ts` — BoutCreateRequestSchema validates boutId length 10–21
- [ ] Read `lib/bouts/validation.ts` — containsUnsafeContent checks hate keywords, injection patterns, special char ratio
- [ ] Run `pnpm run test -- lib/bouts/validation.test.ts` — 21 tests pass

## 3. Bout Engine (T-008)

- [ ] Read `lib/bouts/engine.ts` — SAFETY_PREAMBLE exists and is prepended to system prompts
- [ ] Read `lib/bouts/engine.ts` — buildTurnMessages: own turns = assistant, other turns = user (perspective trick)
- [ ] Read `lib/bouts/engine.ts` — executeTurnLoop: round-robin via `agents[turnIndex % agents.length]`
- [ ] Read `lib/bouts/engine.ts` — Uses `streamText` from `ai` SDK (not `generateText`)
- [ ] Run `pnpm run test -- lib/bouts/engine.test.ts` — 13 tests pass

## 4. SSE Streaming (T-009)

- [ ] Read `lib/bouts/streaming.ts` — Event format: `event: {type}\ndata: {json}\n\n`
- [ ] Read `lib/bouts/streaming.ts` — Double-close guarded with try/catch in finally block
- [ ] Read `lib/bouts/streaming.ts` — Known limitation comment about cancel not aborting LLM calls
- [ ] Run `pnpm run test -- lib/bouts/streaming.test.ts` — 12 tests pass
- [ ] Read `app/api/run-bout/route.ts` — MODEL_MAP has explicit mapping, unknown models return 400
- [ ] Read `app/api/run-bout/route.ts` — Header says credits/persistence deferred to task 13

## 5. useBout Hook (T-014)

- [ ] Read `lib/bouts/use-bout.ts` — has `"use client"` directive at top
- [ ] Read `lib/bouts/use-bout.ts` — Uses `fetch` + `ReadableStream.getReader()` (not EventSource)
- [ ] Read `lib/bouts/use-bout.ts` — SSE parsing: only `\n\n`-terminated frames parsed (chunk-safe)
- [ ] Read `lib/bouts/use-bout.ts` — JSON.parse wrapped in try/catch (malformed events skipped)
- [ ] Read `lib/bouts/use-bout.ts` — AbortController cleanup in useEffect return
- [ ] Read `lib/bouts/use-bout.ts` — Stream-end fallback: status → done if no explicit done/error
- [ ] Run `pnpm run test -- lib/bouts/use-bout.test.ts` — 14 tests pass (including chunk-splitting test)

## 6. Bout Viewer Page (T-015)

- [ ] Read `app/bout/[id]/page.tsx` — server component (no "use client")
- [ ] Read `app/bout/[id]/page.tsx` — Reads searchParams for autoStart (presetId, topic, model)
- [ ] Read `app/bout/[id]/page.tsx` — autoStart params truncated to max column lengths (darkcat fix #23)
- [ ] Read `app/bout/[id]/page.tsx` — Status normalization: running→streaming, completed→done
- [ ] Read `components/arena/arena.tsx` — client component (has "use client")
- [ ] Read `components/arena/arena.tsx` — Auto-scroll via messagesEndRef + useEffect on messages.length
- [ ] Read `components/arena/arena.tsx` — Static transcript for completed bouts (isCompleted check)
- [ ] Read `components/arena/message-card.tsx` — data-testid="message-card" present
- [ ] Read `components/arena/message-card.tsx` — Colored left border via inline style (agentColor)
- [ ] Read `components/arena/message-card.tsx` — Blinking cursor animation during streaming
- [ ] Read `components/arena/message-card.tsx` — Reaction buttons present on each message card

## 7. Arena Page (T-016)

- [ ] Read `app/arena/page.tsx` — server component, calls getAllPresets()
- [ ] Read `app/arena/page.tsx` — TODO(phase4-economy) comment for credit balance (darkcat fix #27)
- [ ] Read `app/arena/page.tsx` — 2-column responsive grid (grid-cols-1 md:grid-cols-2)
- [ ] Read `components/arena/preset-card.tsx` — client component (has "use client")
- [ ] Read `components/arena/preset-card.tsx` — Comment documents intentional flow: bout created on page load, not on click (darkcat fix #11)
- [ ] Read `components/arena/preset-card.tsx` — Model values match schema: `claude-haiku`, `claude-sonnet`
- [ ] Read `components/arena/preset-card.tsx` — nanoid(21) boutId generation
- [ ] Read `components/arena/preset-card.tsx` — router.push to /bout/{id} with searchParams

## 8. Reactions (T-020)

- [ ] Read `lib/engagement/reactions.ts` — `ReactionRequestSchema` has `.min(1)` on boutId (darkcat fix #14)
- [ ] Read `lib/engagement/reactions.ts` — `toggleReaction` wrapped in `db.transaction()` (darkcat fix #1, CRITICAL)
- [ ] Read `lib/engagement/reactions.ts` — Transaction contains: select existing → toggle → count, all atomic
- [ ] Read `lib/engagement/reactions.ts` — `computeFingerprint`: userId for auth, `anon:{sha256(ip).slice(0,16)}` for anon
- [ ] Read `lib/engagement/reactions.ts` — `getCountsForTurn` returns `{heart: number, fire: number}`
- [ ] Read `lib/engagement/reactions.ts` — `getReactionCounts` returns `Map<turnIndex, ReactionCounts>`
- [ ] Read `lib/engagement/reactions.ts` — `getUserReactions` returns `Set<"turnIndex:reactionType">`
- [ ] Run `pnpm run test -- lib/engagement/reactions.test.ts` — 12 tests pass
- [ ] Tests verify: insert (action=added), delete (action=removed), correct counts, transaction mock

## 9. Reactions API Route

- [ ] Read `app/api/reactions/route.ts` — Comment says "hashed-IP fingerprint" not "IP-based" (darkcat fix #25)
- [ ] Read `app/api/reactions/route.ts` — Trust boundary documented for Vercel deployment
- [ ] Read `app/api/reactions/route.ts` — `getClientIp` uses LAST IP from x-forwarded-for (darkcat fix #5/#6)
- [ ] Read `app/api/reactions/route.ts` — `TRUSTED_PROXY_HEADER` env var supported for non-Vercel deployments
- [ ] Read `app/api/reactions/route.ts` — Fails closed when no userId and no IP available (darkcat fix #16)
- [ ] Read `app/api/reactions/route.ts` — Rate limit keyed by fingerprint, not raw IP (darkcat fix #7)
- [ ] Read `app/api/reactions/route.ts` — Rate limits configurable via env: `REACTION_RATE_WINDOW_MS`, `REACTION_RATE_MAX`
- [ ] Read `app/api/reactions/route.ts` — Comment documents in-memory rate limiter serverless limitation (darkcat fix #13)

## 10. Votes (T-021)

- [ ] Read `lib/engagement/votes.ts` — `WinnerVoteRequestSchema` has `.min(1).max()` on both IDs (darkcat fix #4)
- [ ] Read `lib/engagement/votes.ts` — `VoteValidationError` class with typed codes
- [ ] Read `lib/engagement/votes.ts` — `castWinnerVote` validates: bout exists, status=completed, agent in lineup (darkcat fixes #8/#9)
- [ ] Read `lib/engagement/votes.ts` — Uses `.returning()` not `.rowCount` for conflict detection (darkcat fix #10)
- [ ] Read `lib/engagement/votes.ts` — `getWinnerVoteCounts` returns `Map<agentId, count>`
- [ ] Read `lib/engagement/votes.ts` — `getUserWinnerVote` returns `agentId | null`
- [ ] Run `pnpm run test -- lib/engagement/votes.test.ts` — 13 tests pass
- [ ] Tests verify: successful vote, conflict (already voted), bout-not-found, bout-not-completed, agent-not-in-bout

## 11. Winner Vote API Route

- [ ] Read `app/api/winner-vote/route.ts` — Auth required via `requireAuth()`
- [ ] Read `app/api/winner-vote/route.ts` — `VoteValidationError` caught with correct HTTP status mapping (404/400)
- [ ] Read `app/api/winner-vote/route.ts` — Rate limits configurable via env: `VOTE_RATE_WINDOW_MS`, `VOTE_RATE_MAX` (darkcat fix #12)
- [ ] Read `app/api/winner-vote/route.ts` — Already-voted returns 409 with "ALREADY_VOTED" code

## 12. Leaderboard (T-021)

- [ ] Read `lib/engagement/leaderboard.ts` — TODO comment about pushing aggregation to SQL when dataset grows (darkcat fix #2)
- [ ] Read `lib/engagement/leaderboard.ts` — Tie policy: no winner when tied — explicit, deterministic (darkcat fix #17)
- [ ] Read `lib/engagement/leaderboard.ts` — Empty agentIds array guarded before ANY() query (darkcat fix #15)
- [ ] Read `lib/engagement/leaderboard.ts` — Time range filtering: all, week (7d), month (30d)
- [ ] Read `lib/engagement/leaderboard.ts` — Results capped at top 50
- [ ] Read `lib/engagement/leaderboard.ts` — Sort: wins DESC, totalVotes DESC
- [ ] Run `pnpm run test -- lib/engagement/leaderboard.test.ts` — 10 tests pass
- [ ] Tests verify: empty votes, sorting, ranking, clear winner, tie (no winner awarded), top 50 limit, unknown agent names, time range filters
- [ ] Read `app/leaderboard/page.tsx` — server component, calls getLeaderboardData
- [ ] Read `components/leaderboard/leaderboard-table.tsx` — client component, renders table with rank/name/wins/votes

## 13. Short Links + Sharing (T-022)

- [ ] Read `lib/sharing/short-links.ts` — `ShortLinkRequestSchema` has `.min(1)` on boutId
- [ ] Read `lib/sharing/short-links.ts` — `createShortLink` has retry loop: `MAX_SLUG_RETRIES=3` (darkcat fix #3/#18/#21)
- [ ] Read `lib/sharing/short-links.ts` — Catches unique constraint violation on slug collision and retries with new slug
- [ ] Read `lib/sharing/short-links.ts` — Idempotent: checks existing before insert, handles race with ON CONFLICT
- [ ] Read `lib/sharing/short-links.ts` — No non-null assertion on result (removed `result.slug!`)
- [ ] Run `pnpm run test -- lib/sharing/short-links.test.ts` — 10 tests pass
- [ ] Read `app/api/short-links/route.ts` — Enforces `bout.status === "completed"` before creating link (darkcat fix #19)
- [ ] Read `app/b/[id]/page.tsx` — Resolves slug → boutId, redirects to `/bout/{boutId}`

## 14. Share Panel

- [ ] Read `components/engagement/share-panel.tsx` — Error state for failed short link creation (darkcat fix #22)
- [ ] Read `components/engagement/share-panel.tsx` — All `window.open` calls have `"noopener,noreferrer"` (darkcat fix #24)
- [ ] Read `components/engagement/share-panel.tsx` — 6 platforms: X, Reddit, WhatsApp, Telegram, LinkedIn, Copy Link
- [ ] Read `components/engagement/share-panel.tsx` — Loading state with pulse animation
- [ ] Read `components/engagement/share-panel.tsx` — Error state renders red text, not silent failure

## 15. End-to-End Flow (Manual — requires dev server)

- [ ] `pnpm run dev` starts without errors
- [ ] Navigate to http://localhost:3000/arena — preset cards render
- [ ] Each preset card shows: name, description, agent badges with colors, turn count, tier
- [ ] Topic input accepts text, placeholder says "Custom topic (optional)"
- [ ] Model dropdown shows "Haiku (fast)" selected, "Sonnet (coming soon)" disabled
- [ ] Click "Start Debate" → URL changes to `/bout/{nanoid}?presetId=...&model=claude-haiku`
- [ ] Bout page shows streaming indicator
- [ ] SSE events stream in: message cards appear with colored borders, agent names, turn numbers
- [ ] Content appears incrementally (streaming text deltas visible)
- [ ] After all turns: "Debate complete" text appears
- [ ] Page auto-scrolls as new messages arrive
- [ ] Reaction buttons visible on each message card
- [ ] Heart/fire toggle works (click adds, click again removes)
- [ ] Reaction counts update after toggle
- [ ] Share panel appears after bout completion
- [ ] Share panel creates short link (loading → link available)
- [ ] Copy Link button copies URL to clipboard
- [ ] Social share buttons open correct URLs in new tabs (with noopener)
- [ ] Navigate to /leaderboard — table renders (may be empty with no votes)

## 16. Error Handling (Manual — requires dev server)

- [ ] Navigate to `/bout/nonexistent-id` without searchParams → Arena renders in new-bout mode
- [ ] If ANTHROPIC_API_KEY is missing/invalid → error event appears in SSE → error message displayed
- [ ] Submit empty boutId to /api/reactions → 400 validation error (not 500)
- [ ] Submit vote on running bout → 400 "BOUT_NOT_COMPLETED"
- [ ] Submit vote for agent not in bout → 400 "AGENT_NOT_IN_BOUT"

## 17. Darkcat Alley — All 29 Findings Resolved

### Converged (2+ model agreement)

- [ ] #1 CRITICAL: `toggleReaction` TOCTOU → wrapped in `db.transaction()` (reactions.ts)
- [ ] #2 HIGH: Leaderboard in-memory + nondeterministic tie → no-winner-on-tie policy (leaderboard.ts)
- [ ] #3 HIGH: Slug collision unhandled → retry loop with 3 attempts (short-links.ts)
- [ ] #4 MEDIUM: Zod IDs unconstrained → `.min(1).max()` on all schemas (votes.ts, reactions.ts)

### Single-Model HIGH

- [ ] #5/#6 IP spoofing → last IP from x-forwarded-for, trust boundary documented (reactions/route.ts)
- [ ] #7 Rate limit scope mismatch → keyed by fingerprint not raw IP (reactions/route.ts)
- [ ] #8 Vote doesn't verify agent belongs to bout → validates against agentLineup (votes.ts)
- [ ] #9 Vote doesn't check bout status → validates status=completed (votes.ts)
- [ ] #10 Drizzle rowCount unreliable → `.returning()` for conflict detection (votes.ts)
- [ ] #11 Arena navigates before bout exists → documented as intentional (preset-card.tsx)
- [ ] #12 Hardcoded rate limits → env vars with safe defaults (winner-vote/route.ts)

### Single-Model MEDIUM

- [ ] #13 In-memory rate limiter in serverless → documented, env-configurable (reactions/route.ts)
- [ ] #14 Missing .min(1) on reaction schema → added (reactions.ts)
- [ ] #15 ANY() empty array → guarded with length check (leaderboard.ts)
- [ ] #16 Fallback IP 127.0.0.1 → fail closed when no identity (reactions/route.ts)
- [ ] #17 Nondeterministic ties → explicit no-winner policy (leaderboard.ts)
- [ ] #18/#21 Slug collision crash → retry loop (short-links.ts)
- [ ] #19 Short-link on non-completed bout → enforce status=completed (short-links/route.ts)
- [ ] #20 Tie test codifies wrong behaviour → new test for no-winner policy (leaderboard.test.ts)
- [ ] #22 Share panel fetch error → try/catch with error state (share-panel.tsx)
- [ ] #23 autoStart params unvalidated → truncated to max lengths (bout/[id]/page.tsx)

### Single-Model LOW

- [ ] #24 window.open without noopener → added "noopener,noreferrer" (share-panel.tsx)
- [ ] #25 Comment says "IP-based" → corrected to "hashed-IP fingerprint" (reactions/route.ts)
- [ ] #26 Reaction test doesn't verify insert call → tx mock verifies insert/delete (reactions.test.ts)
- [ ] #27 Dead code comment → TODO(phase4-economy) (arena/page.tsx)

## 18. Known Limitations (Accepted, Documented)

- [ ] Cancel stops SSE emission but does not abort in-flight LLM calls (cost leak, deferred to T-013)
- [ ] No bout persistence — bouts are not saved to DB yet (deferred to T-013)
- [ ] No credits — all bouts are free (CREDITS_ENABLED=false, deferred to T-013)
- [ ] In-memory rate limiter resets on cold start in serverless (acceptable for MVP)
- [ ] Leaderboard loads all votes into memory (acceptable until ~10K votes, then push to SQL)
- [ ] E2e test stubs only — no executable Playwright tests yet (deferred to Phase 6)

## 19. Code Conventions

- [ ] All new source files have header comments
- [ ] All new test files co-located beside their modules
- [ ] "use client" on all client components, absent on server components
- [ ] 2 spaces indentation throughout
- [ ] Conventional commit messages on all commits
- [ ] Error handling follows `lib/common/api-utils.ts` patterns

## 20. Commit History (T-007 through T-022 + fixes)

- [ ] `80a2b89` — feat: T-016 arena page — preset grid, preset card, autoStart wiring
- [ ] `5748515` — feat: T-020 reactions — toggle API, fingerprinting, message card buttons
- [ ] `f9120eb` — feat: T-021 votes + leaderboard — winner vote API, leaderboard data, page + table
- [ ] `7512e3d` — feat: T-022 short links + sharing — idempotent links, share panel, /b/[id] redirect
- [ ] `d2eb0e4` — fix: add FormData, AbortController, globalThis to eslint globals
- [ ] `084d744` — fix: address all 29 darkcat alley findings for phase2-ui
- [ ] `1825585` — lexicon v0.25: add 'sortie' — the complete feature-to-commit cycle

---

## Signoff

```
Captain:
Date:
Findings:
Test run: 154 total (145 pass, 9 skip)
PR: #1 (phase2-ui → main)
```
