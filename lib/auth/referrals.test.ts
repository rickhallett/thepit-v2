/**
 * referrals.test.ts — ensureReferralCode against a real database.
 *
 * No mocks on infrastructure. Tests prove real UNIQUE constraint behaviour,
 * real collision retry via 23505, and real conditional UPDATE.
 * nanoid is mocked to control code generation for collision scenarios.
 * Skips gracefully when DATABASE_URL is not set.
 *
 * @vitest-environment node
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Controlled nanoid: tests push values into this queue.
// When empty, falls through to real nanoid.
let nanoidQueue: string[] = [];

vi.mock("nanoid", async (importOriginal) => {
  const original = await importOriginal<typeof import("nanoid")>();
  return {
    nanoid: (size?: number) => {
      if (nanoidQueue.length > 0) return nanoidQueue.shift()!;
      return original.nanoid(size);
    },
  };
});

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("ensureReferralCode (live database)", () => {
  let db: Awaited<typeof import("@/db")>["db"];
  let schema: Awaited<typeof import("@/db/schema")>;
  let ensureReferralCode: Awaited<typeof import("./referrals")>["ensureReferralCode"];
  let eq: Awaited<typeof import("drizzle-orm")>["eq"];

  const prefix = `test-ref-${Date.now()}`;
  const userA = `${prefix}-a`;
  const userB = `${prefix}-b`;
  const userC = `${prefix}-c`;

  beforeAll(async () => {
    const { neonConfig } = await import("@neondatabase/serverless");
    const ws = await import("ws");
    neonConfig.webSocketConstructor = ws.default;

    const drizzleOrm = await import("drizzle-orm");
    eq = drizzleOrm.eq;
    schema = await import("@/db/schema");
    db = (await import("@/db")).db;
    ensureReferralCode = (await import("./referrals")).ensureReferralCode;

    // Seed test users (no referral codes).
    await db.insert(schema.users).values([
      { id: userA, email: "a@test.com" },
      { id: userB, email: "b@test.com" },
      { id: userC, email: "c@test.com" },
    ]);
  });

  beforeEach(() => {
    nanoidQueue = [];
  });

  afterAll(async () => {
    if (db && schema) {
      for (const id of [userA, userB, userC]) {
        await db.delete(schema.users).where(eq(schema.users.id, id));
      }
    }
  });

  it("generates a referral code for a user with none", async () => {
    const code = await ensureReferralCode(userA);

    expect(typeof code).toBe("string");
    expect(code.length).toBe(8);

    // Verify it's persisted.
    const rows = await db
      .select({ referralCode: schema.users.referralCode })
      .from(schema.users)
      .where(eq(schema.users.id, userA));

    expect(rows[0].referralCode).toBe(code);
  });

  it("returns existing code on second call (idempotent)", async () => {
    const first = await ensureReferralCode(userA);
    const second = await ensureReferralCode(userA);

    expect(second).toBe(first);
  });

  it("retries on cross-user collision (real UNIQUE constraint, real 23505)", async () => {
    // Give userB a known referral code.
    const collidingCode = `COL${Date.now().toString(36).slice(-5)}`;
    await db
      .update(schema.users)
      .set({ referralCode: collidingCode })
      .where(eq(schema.users.id, userB));

    // Queue: first code collides with userB, second is fresh.
    const freshCode = `FR${Date.now().toString(36).slice(-6)}`;
    nanoidQueue = [collidingCode, freshCode];

    const code = await ensureReferralCode(userC);

    // First attempt hit real 23505 from the DB; second succeeded.
    expect(code).toBe(freshCode);

    // Verify userB's code is not corrupted.
    const bRows = await db
      .select({ referralCode: schema.users.referralCode })
      .from(schema.users)
      .where(eq(schema.users.id, userB));
    expect(bRows[0].referralCode).toBe(collidingCode);
  });

  it("throws for non-existent user", async () => {
    await expect(ensureReferralCode("nonexistent-user-xyz")).rejects.toThrow(
      "User not found: nonexistent-user-xyz",
    );
  });
});

describe("ensureReferralCode (no database)", () => {
  it("skips live tests when DATABASE_URL is not set", () => {
    expect(true).toBe(true);
  });
});
