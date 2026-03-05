/**
 * presets.test.ts — Preset loading and validation.
 *
 * Tests run against the real JSON files in presets/.
 * No mocks — reads real filesystem, validates with real Zod schemas.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  getAllPresets,
  getPresetById,
  _resetPresetCache,
  PresetSchema,
} from "./presets";

beforeEach(() => {
  _resetPresetCache();
});

describe("getAllPresets", () => {
  it("returns an array with at least 4 presets", () => {
    const presets = getAllPresets();
    expect(presets.length).toBeGreaterThanOrEqual(4);
  });

  it("returns presets that each pass schema validation", () => {
    const presets = getAllPresets();
    for (const preset of presets) {
      const result = PresetSchema.safeParse(preset);
      expect(result.success).toBe(true);
    }
  });

  it("returns presets with unique IDs", () => {
    const presets = getAllPresets();
    const ids = presets.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns presets that each have at least 2 agents", () => {
    const presets = getAllPresets();
    for (const preset of presets) {
      expect(preset.agents.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("caches presets after first load", () => {
    const first = getAllPresets();
    const second = getAllPresets();
    expect(first).toBe(second); // Same reference.
  });
});

describe("getPresetById", () => {
  it("returns the correct preset for a known ID", () => {
    const preset = getPresetById("darwin-special");
    expect(preset).not.toBeNull();
    expect(preset!.id).toBe("darwin-special");
    expect(preset!.name).toBe("Darwin Special");
    expect(preset!.agents.length).toBe(2);
  });

  it("returns null for an unknown ID", () => {
    const preset = getPresetById("does-not-exist");
    expect(preset).toBeNull();
  });

  it("returns the 3-agent preset correctly", () => {
    const preset = getPresetById("philosophers-club");
    expect(preset).not.toBeNull();
    expect(preset!.agents.length).toBe(3);
  });

  it("returns the shorter bout preset correctly", () => {
    const preset = getPresetById("startup-pitch");
    expect(preset).not.toBeNull();
    expect(preset!.maxTurns).toBe(4);
  });
});
