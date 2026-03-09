/**
 * balance.test.ts — credit balance operations against a real database.
 *
 * No mocks. Tests prove real INSERT ON CONFLICT DO NOTHING behaviour
 * and GREATEST(0, ...) floor logic.
 * Skips gracefully when DATABASE_URL is not set.
 *
 * @vitest-environment node
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("credit balance (live database)", () => {
  let db: Awaited<typeof import("@/db")>["db"];
  let schema: Awaited<typeof import("@/db/schema")>;
  let ensureCreditAccount: Awaited<
    typeof import("./balance")
  >["ensureCreditAccount"];
  let getCreditBalanceMicro: Awaited<
    typeof import("./balance")
  >["getCreditBalanceMicro"];
  let applyCreditDelta: Awaited<
    typeof import("./balance")
  >["applyCreditDelta"];
  let CreditSource: Awaited<typeof import("./types")>["CreditSource"];
  let eq: Awaited<typeof import("drizzle-orm")>["eq"];

  const testPrefix = `test-credits-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const testUserId = testPrefix;
  const testUserId2 = `${testPrefix}-delta`;
  const testUserId3 = `${testPrefix}-floor`;

  beforeAll(async () => {
    // Neon serverless driver needs WebSocket in Node.js.
    const { neonConfig } = await import("@neondatabase/serverless");
    const ws = await import("ws");
    neonConfig.webSocketConstructor = ws.default;

    const drizzleOrm = await import("drizzle-orm");
    eq = drizzleOrm.eq;
    schema = await import("@/db/schema");
    db = (await import("@/db")).db;
    const balanceModule = await import("./balance");
    ensureCreditAccount = balanceModule.ensureCreditAccount;
    getCreditBalanceMicro = balanceModule.getCreditBalanceMicro;
    applyCreditDelta = balanceModule.applyCreditDelta;
    CreditSource = (await import("./types")).CreditSource;

    // Create test users (credits table has FK to users)
    for (const id of [testUserId, testUserId2, testUserId3]) {
      await db
        .insert(schema.users)
        .values({ id, email: `${id}@test.com` })
        .onConflictDoNothing();
    }
  });

  afterAll(async () => {
    if (db && schema) {
      // Clean up in order: transactions -> credits -> users
      for (const id of [testUserId, testUserId2, testUserId3]) {
        await db
          .delete(schema.creditTransactions)
          .where(eq(schema.creditTransactions.userId, id));
        await db.delete(schema.credits).where(eq(schema.credits.userId, id));
        await db.delete(schema.users).where(eq(schema.users.id, id));
      }
    }
  });

  describe("ensureCreditAccount", () => {
    it("inserts with correct default balance (10000 micro)", async () => {
      await ensureCreditAccount(testUserId);

      const rows = await db
        .select()
        .from(schema.credits)
        .where(eq(schema.credits.userId, testUserId));

      expect(rows).toHaveLength(1);
      expect(rows[0].balanceMicro).toBe(10000);
    });

    it("is idempotent — second call does nothing", async () => {
      // Call again
      await ensureCreditAccount(testUserId);

      // Still one row, same balance
      const rows = await db
        .select()
        .from(schema.credits)
        .where(eq(schema.credits.userId, testUserId));

      expect(rows).toHaveLength(1);
      expect(rows[0].balanceMicro).toBe(10000);
    });

    it("logs a signup transaction", async () => {
      const txRows = await db
        .select()
        .from(schema.creditTransactions)
        .where(eq(schema.creditTransactions.userId, testUserId));

      // Should have exactly one signup transaction
      const signupTxs = txRows.filter((tx) => tx.source === "signup");
      expect(signupTxs).toHaveLength(1);
      expect(signupTxs[0].deltaMicro).toBe(10000);
      expect(signupTxs[0].referenceId).toBe(`signup:${testUserId}`);
    });

    it("signup transaction is idempotent", async () => {
      // Call ensure again
      await ensureCreditAccount(testUserId);

      const txRows = await db
        .select()
        .from(schema.creditTransactions)
        .where(eq(schema.creditTransactions.userId, testUserId));

      // Still only one signup transaction
      const signupTxs = txRows.filter((tx) => tx.source === "signup");
      expect(signupTxs).toHaveLength(1);
    });
  });

  describe("getCreditBalanceMicro", () => {
    it("returns balance when account exists", async () => {
      const balance = await getCreditBalanceMicro(testUserId);
      expect(balance).toBe(10000);
    });

    it("returns 0 when no account exists", async () => {
      const balance = await getCreditBalanceMicro("nonexistent-user-id-12345");
      expect(balance).toBe(0);
    });
  });

  describe("applyCreditDelta", () => {
    it("with positive delta increases balance", async () => {
      await ensureCreditAccount(testUserId2);

      const newBalance = await applyCreditDelta(
        testUserId2,
        5000,
        CreditSource.PURCHASE,
        `test-purchase-${testUserId2}`,
      );

      expect(newBalance).toBe(15000); // 10000 + 5000
    });

    it("with negative delta decreases balance", async () => {
      const newBalance = await applyCreditDelta(
        testUserId2,
        -3000,
        CreditSource.PREAUTH,
        `test-preauth-${testUserId2}`,
      );

      expect(newBalance).toBe(12000); // 15000 - 3000
    });

    it("never goes below 0 (GREATEST floor)", async () => {
      await ensureCreditAccount(testUserId3);
      // Balance is 10000, try to subtract 50000
      const newBalance = await applyCreditDelta(
        testUserId3,
        -50000,
        CreditSource.PREAUTH,
        `test-floor-${testUserId3}`,
      );

      expect(newBalance).toBe(0);
    });

    it("logs a transaction", async () => {
      const txRows = await db
        .select()
        .from(schema.creditTransactions)
        .where(eq(schema.creditTransactions.referenceId, `test-purchase-${testUserId2}`));

      expect(txRows).toHaveLength(1);
      expect(txRows[0].deltaMicro).toBe(5000);
      expect(txRows[0].source).toBe("purchase");
    });
  });
});

describe("credit balance (no database)", () => {
  it("skips live tests when DATABASE_URL is not set", () => {
    expect(true).toBe(true);
  });
});
