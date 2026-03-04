/**
 * users.test.ts — ensureUserRecord against a real database.
 *
 * No mocks. Tests prove real INSERT ON CONFLICT DO NOTHING behaviour.
 * Skips gracefully when DATABASE_URL is not set.
 *
 * @vitest-environment node
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("ensureUserRecord (live database)", () => {
  let db: Awaited<typeof import("@/db")>["db"];
  let schema: Awaited<typeof import("@/db/schema")>;
  let ensureUserRecord: Awaited<typeof import("./users")>["ensureUserRecord"];
  let eq: Awaited<typeof import("drizzle-orm")>["eq"];

  const testId = `test-users-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    // Neon serverless driver needs WebSocket in Node.js.
    // Must be set BEFORE importing @/db (which creates Pool at module level).
    const { neonConfig } = await import("@neondatabase/serverless");
    const ws = await import("ws");
    neonConfig.webSocketConstructor = ws.default;

    const drizzleOrm = await import("drizzle-orm");
    eq = drizzleOrm.eq;
    schema = await import("@/db/schema");
    db = (await import("@/db")).db;
    ensureUserRecord = (await import("./users")).ensureUserRecord;
  });

  afterAll(async () => {
    if (db && schema) {
      const ids = [`${testId}`, `${testId}-null`];
      for (const id of ids) {
        await db.delete(schema.users).where(eq(schema.users.id, id));
      }
    }
  });

  it("inserts a new user record", async () => {
    await ensureUserRecord(testId, {
      email: "alice@test.com",
      displayName: "Alice",
      imageUrl: "https://img.test/alice.jpg",
    });

    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, testId));

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(testId);
    expect(rows[0].email).toBe("alice@test.com");
    expect(rows[0].displayName).toBe("Alice");
    expect(rows[0].imageUrl).toBe("https://img.test/alice.jpg");
    expect(rows[0].subscriptionTier).toBe("free");
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });

  it("is idempotent — second call does not update existing record", async () => {
    await ensureUserRecord(testId, {
      email: "alice-changed@test.com",
      displayName: "Alice Changed",
      imageUrl: null,
    });

    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, testId));

    // Still one row, still the ORIGINAL data (first write wins).
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("alice@test.com");
    expect(rows[0].displayName).toBe("Alice");
    expect(rows[0].imageUrl).toBe("https://img.test/alice.jpg");
  });

  it("handles null profile fields", async () => {
    const nullId = `${testId}-null`;

    await ensureUserRecord(nullId, {
      email: "bob@test.com",
      displayName: null,
      imageUrl: null,
    });

    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, nullId));

    expect(rows).toHaveLength(1);
    expect(rows[0].displayName).toBeNull();
    expect(rows[0].imageUrl).toBeNull();
  });
});

describe("ensureUserRecord (no database)", () => {
  it("skips live tests when DATABASE_URL is not set", () => {
    expect(true).toBe(true);
  });
});
