// Preset loading — static JSON files validated with Zod on first load.
// Server-side only. Cached and frozen after first call.
//
// Uses fs.readFileSync + process.cwd() by design (plan 06).
// For serverless deploys, ensure presets/ is included in output tracing.

import "server-only";

import { z } from "zod";
import fs from "node:fs";
import path from "node:path";

const PresetAgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  systemPrompt: z.string().min(1),
  color: z.string().min(1),
});

const PresetSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    agents: z.array(PresetAgentSchema).min(2),
    maxTurns: z.number().int().min(2).max(20),
    defaultModel: z.string().min(1),
    tier: z.enum(["free", "premium"]),
  })
  .refine(
    (p) => new Set(p.agents.map((a) => a.id)).size === p.agents.length,
    { message: "Agent IDs must be unique within a preset" },
  );

export type Preset = z.infer<typeof PresetSchema>;
export type PresetAgent = z.infer<typeof PresetAgentSchema>;
export { PresetSchema };

let cached: Preset[] | null = null;

/**
 * Load all preset JSON files from the presets/ directory.
 * Validates each against PresetSchema. Throws on invalid files.
 * Cached after first successful load.
 */
export function getAllPresets(): Preset[] {
  if (cached) return cached;

  const presetsDir = path.join(process.cwd(), "presets");
  if (!fs.existsSync(presetsDir)) {
    throw new Error(`Presets directory not found: ${presetsDir}`);
  }

  const files = fs
    .readdirSync(presetsDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  if (files.length === 0) {
    throw new Error(`No preset JSON files found in ${presetsDir}`);
  }

  const presets: Preset[] = [];
  for (const file of files) {
    const filePath = path.join(presetsDir, file);
    const raw = fs.readFileSync(filePath, "utf-8");

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Invalid JSON in preset file: ${file}`);
    }

    const result = PresetSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `Preset validation failed for ${file}: ${result.error.message}`,
      );
    }

    presets.push(result.data);
  }

  // Check for duplicate IDs.
  const ids = new Set<string>();
  for (const preset of presets) {
    if (ids.has(preset.id)) {
      throw new Error(`Duplicate preset ID: ${preset.id}`);
    }
    ids.add(preset.id);
  }

  // Deep freeze to prevent caller mutation of cached data.
  for (const preset of presets) {
    Object.freeze(preset);
    for (const agent of preset.agents) {
      Object.freeze(agent);
    }
    Object.freeze(preset.agents);
  }
  Object.freeze(presets);

  cached = presets;
  return presets;
}

/** Find a preset by ID. Returns null if not found. */
export function getPresetById(id: string): Preset | null {
  return getAllPresets().find((p) => p.id === id) ?? null;
}

/** Reset the cache — for testing only. */
export function _resetPresetCache(): void {
  cached = null;
}
