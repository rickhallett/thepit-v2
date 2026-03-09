/**
 * Vitest setup file — loads .env so live-DB tests can detect DATABASE_URL.
 * Runs before every test file. Does not override existing env vars.
 */
import { config } from "dotenv";

config(); // loads .env
config({ path: ".env.local", override: true }); // .env.local overrides
