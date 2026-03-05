// No-op stub for server-only package in vitest.
// The real package throws when imported from client code in Next.js.
// In tests, this guard is irrelevant — tests run server-side.
export {};
