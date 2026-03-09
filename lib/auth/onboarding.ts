// Onboarding orchestrator — first-load sequence for authenticated users.
// Calls user mirroring, referral code generation, and credit account setup.

import { ensureUserRecord, type UserProfile } from "./users";
import { ensureReferralCode } from "./referrals";
import { ensureCreditAccount } from "@/lib/credits/balance";

/**
 * Runs the full first-load initialisation sequence for a user.
 * Idempotent — safe to call on every authenticated page load.
 *
 * Sequence: mirror user → generate referral code → ensure credit account.
 */
export async function initializeUserSession(
  clerkUserId: string,
  profile: UserProfile,
): Promise<void> {
  await ensureUserRecord(clerkUserId, profile);
  await ensureReferralCode(clerkUserId);
  await ensureCreditAccount(clerkUserId);
}
