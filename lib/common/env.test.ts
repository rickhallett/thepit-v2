import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getEnv, _resetEnvCache } from "./env";

const REQUIRED_ENV = {
  DATABASE_URL: "postgres://localhost:5432/thepit",
  ANTHROPIC_API_KEY: "sk-ant-test-key",
  CLERK_SECRET_KEY: "sk_test_clerk",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_clerk",
};

describe("env", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    _resetEnvCache();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    _resetEnvCache();
  });

  it("validates with all required vars present", () => {
    Object.assign(process.env, REQUIRED_ENV);
    const env = getEnv();
    expect(env.DATABASE_URL).toBe(REQUIRED_ENV.DATABASE_URL);
  });

  it("feature flags default to false", () => {
    Object.assign(process.env, REQUIRED_ENV);
    const env = getEnv();
    expect(env.SUBSCRIPTIONS_ENABLED).toBe(false);
    expect(env.CREDITS_ENABLED).toBe(false);
    expect(env.BYOK_ENABLED).toBe(false);
    expect(env.PREMIUM_ENABLED).toBe(false);
  });

  it("throws when required vars are missing", () => {
    // No env vars set — should throw
    expect(() => getEnv()).toThrow("Environment validation failed");
  });

  it("requires stripe vars when SUBSCRIPTIONS_ENABLED is true", () => {
    Object.assign(process.env, {
      ...REQUIRED_ENV,
      SUBSCRIPTIONS_ENABLED: "true",
    });
    expect(() => getEnv()).toThrow("STRIPE_SECRET_KEY");
  });

  it("accepts stripe vars when SUBSCRIPTIONS_ENABLED is true and all present", () => {
    Object.assign(process.env, {
      ...REQUIRED_ENV,
      SUBSCRIPTIONS_ENABLED: "true",
      STRIPE_SECRET_KEY: "sk_test_stripe",
      STRIPE_WEBHOOK_SECRET: "whsec_test",
      STRIPE_PASS_PRICE_ID: "price_pass",
      STRIPE_LAB_PRICE_ID: "price_lab",
    });
    const env = getEnv();
    expect(env.SUBSCRIPTIONS_ENABLED).toBe(true);
    expect(env.STRIPE_SECRET_KEY).toBe("sk_test_stripe");
  });
});
