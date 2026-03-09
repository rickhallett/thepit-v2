/**
 * short-links.test.ts — unit tests for short links library.
 *
 * Mocks the db module for isolated unit testing.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock nanoid to return deterministic values
let nanoidCallCount = 0;
vi.mock("nanoid", () => ({
  nanoid: vi.fn((size: number) => {
    nanoidCallCount++;
    return "slug" + String(nanoidCallCount).padStart(size - 4, "0");
  }),
}));

// Mock the db module
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
}));

// Mock drizzle-orm functions
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col, val) => ({ type: "eq", val })),
}));

// Mock schema
vi.mock("@/db/schema", () => ({
  shortLinks: {
    id: { name: "id" },
    boutId: { name: "bout_id" },
    slug: { name: "slug" },
    createdAt: { name: "created_at" },
  },
}));

describe("createShortLink", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    nanoidCallCount = 0;
  });

  it("returns existing slug when link already exists (idempotent)", async () => {
    const dbModule = await import("@/db");
    const db = dbModule.db as unknown as Record<string, ReturnType<typeof vi.fn>>;

    // First SELECT returns existing slug
    const mockSelectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ slug: "existslug" }]),
    };
    db.select.mockReturnValue(mockSelectChain);

    const { createShortLink } = await import("./short-links");

    const result = await createShortLink("bout_existing");

    expect(result).toBe("existslug");
    // Should not call insert when link exists
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("creates new link when none exists", async () => {
    const dbModule = await import("@/db");
    const db = dbModule.db as unknown as Record<string, ReturnType<typeof vi.fn>>;

    // First SELECT returns empty (no existing link)
    const mockSelectChain1 = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValueOnce([]), // First call: no existing
    };

    // Second SELECT returns the newly created slug
    const mockSelectChain2 = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ slug: "slug0001" }]),
    };

    db.select
      .mockReturnValueOnce(mockSelectChain1)
      .mockReturnValueOnce(mockSelectChain2);

    // Insert chain
    const mockInsertChain = {
      values: vi.fn().mockReturnThis(),
      onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
    };
    db.insert.mockReturnValue(mockInsertChain);

    const { createShortLink } = await import("./short-links");

    const result = await createShortLink("bout_new");

    expect(result).toBe("slug0001");
    expect(db.insert).toHaveBeenCalled();
  });

  it("handles race condition gracefully (ON CONFLICT DO NOTHING)", async () => {
    const dbModule = await import("@/db");
    const db = dbModule.db as unknown as Record<string, ReturnType<typeof vi.fn>>;

    // First SELECT returns empty
    const mockSelectChain1 = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValueOnce([]),
    };

    // After conflict, SELECT returns the winner's slug
    const mockSelectChain2 = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ slug: "racewin1" }]),
    };

    db.select
      .mockReturnValueOnce(mockSelectChain1)
      .mockReturnValueOnce(mockSelectChain2);

    // Insert with conflict handling
    const mockInsertChain = {
      values: vi.fn().mockReturnThis(),
      onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
    };
    db.insert.mockReturnValue(mockInsertChain);

    const { createShortLink } = await import("./short-links");

    const result = await createShortLink("bout_race");

    // Should return whatever is in the DB after the conflict
    expect(result).toBe("racewin1");
  });

  it("generates 8-character slug via nanoid", async () => {
    const dbModule = await import("@/db");
    const db = dbModule.db as unknown as Record<string, ReturnType<typeof vi.fn>>;
    const nanoidModule = await import("nanoid");

    // Setup for new link creation
    const mockSelectChain1 = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValueOnce([]),
    };
    const mockSelectChain2 = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ slug: "12345678" }]),
    };

    db.select
      .mockReturnValueOnce(mockSelectChain1)
      .mockReturnValueOnce(mockSelectChain2);

    const mockInsertChain = {
      values: vi.fn().mockReturnThis(),
      onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
    };
    db.insert.mockReturnValue(mockInsertChain);

    const { createShortLink } = await import("./short-links");

    await createShortLink("bout_check_length");

    // Verify nanoid was called with 8
    expect(nanoidModule.nanoid).toHaveBeenCalledWith(8);
  });
});

describe("resolveShortLink", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns boutId for known slug", async () => {
    const dbModule = await import("@/db");
    const db = dbModule.db as unknown as Record<string, ReturnType<typeof vi.fn>>;

    const mockSelectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ boutId: "bout_found" }]),
    };
    db.select.mockReturnValue(mockSelectChain);

    const { resolveShortLink } = await import("./short-links");

    const result = await resolveShortLink("knownslg");

    expect(result).toBe("bout_found");
  });

  it("returns null for unknown slug", async () => {
    const dbModule = await import("@/db");
    const db = dbModule.db as unknown as Record<string, ReturnType<typeof vi.fn>>;

    const mockSelectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    db.select.mockReturnValue(mockSelectChain);

    const { resolveShortLink } = await import("./short-links");

    const result = await resolveShortLink("notfound");

    expect(result).toBeNull();
  });

  it("returns null when boutId is undefined", async () => {
    const dbModule = await import("@/db");
    const db = dbModule.db as unknown as Record<string, ReturnType<typeof vi.fn>>;

    const mockSelectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ boutId: undefined }]),
    };
    db.select.mockReturnValue(mockSelectChain);

    const { resolveShortLink } = await import("./short-links");

    const result = await resolveShortLink("badentry");

    expect(result).toBeNull();
  });
});

describe("ShortLinkRequestSchema", () => {
  it("validates correct request", async () => {
    const { ShortLinkRequestSchema } = await import("./short-links");

    const result = ShortLinkRequestSchema.safeParse({ boutId: "bout_123" });
    expect(result.success).toBe(true);
  });

  it("rejects empty boutId", async () => {
    const { ShortLinkRequestSchema } = await import("./short-links");

    const result = ShortLinkRequestSchema.safeParse({ boutId: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing boutId", async () => {
    const { ShortLinkRequestSchema } = await import("./short-links");

    const result = ShortLinkRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
