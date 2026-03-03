// Environment validation — lazy initialization pattern
// Import is safe at build time; validation runs on first getEnv() call
import { z } from "zod/v4";

const booleanFlag = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .default("")
  .transform((v) => v === "true" || v === "1");

const baseSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),

  SUBSCRIPTIONS_ENABLED: booleanFlag,
  CREDITS_ENABLED: booleanFlag,
  BYOK_ENABLED: booleanFlag,
  PREMIUM_ENABLED: booleanFlag,

  STRIPE_SECRET_KEY: z.string().optional().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(""),
  STRIPE_PASS_PRICE_ID: z.string().optional().default(""),
  STRIPE_LAB_PRICE_ID: z.string().optional().default(""),
});

const envSchema = baseSchema.superRefine((data, ctx) => {
  if (data.SUBSCRIPTIONS_ENABLED) {
    const stripeFields = [
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_PASS_PRICE_ID",
      "STRIPE_LAB_PRICE_ID",
    ] as const;

    for (const field of stripeFields) {
      if (!data[field]) {
        ctx.addIssue({
          code: "custom",
          message: `${field} is required when SUBSCRIPTIONS_ENABLED is true`,
          path: [field],
        });
      }
    }
  }
});

export type Env = z.infer<typeof baseSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = z.prettifyError(result.error);
    throw new Error(`Environment validation failed:\n${formatted}`);
  }
  cachedEnv = result.data;
  return cachedEnv;
}

// Reset cache — for testing only
export function _resetEnvCache(): void {
  cachedEnv = null;
}
