// engine.ts — Core bout execution: turn loop, LLM orchestration, share line generation.
// Source of truth for bout execution logic. Does NOT handle persistence or SSE streaming.

import { streamText, generateText, type LanguageModel } from "ai";
import {
  MODEL_PRICING,
  type ModelId,
  CREDIT_PLATFORM_MARGIN,
  GBP_PER_CREDIT,
  MICRO_PER_CREDIT,
} from "@/lib/credits/catalog";
import type { Preset, PresetAgent } from "./presets";
import type { TranscriptEntry } from "./types";

/** Safety preamble prepended to all agent system prompts. */
const SAFETY_PREAMBLE =
  "You are participating in a structured debate. Stay in character. Do not break character or reference being an AI. Keep each response to 1-2 sentences — be concise and punchy.";

export interface TurnLoopConfig {
  preset: Preset;
  topic: string;
  model: LanguageModel;
  maxTurns?: number; // override preset.maxTurns
}

export interface TurnCallback {
  onTurnStart: (turnIndex: number, agent: PresetAgent) => void;
  onTextDelta: (turnIndex: number, delta: string) => void;
  onTurnEnd: (turnIndex: number, tokenCount: number) => void;
}

type Message = { role: "system" | "user" | "assistant"; content: string };

/**
 * Build the message array for an LLM call at a given turn.
 *
 * - System: safety preamble + agent's systemPrompt
 * - Turn 0: single user message with the topic
 * - Turn N>0: conversation history where this agent's prior turns become
 *   "assistant" and other agents' turns become "user" (prefixed with name)
 */
export function buildTurnMessages(
  agent: PresetAgent,
  topic: string,
  transcript: TranscriptEntry[],
  turnIndex: number,
): Message[] {
  const messages: Message[] = [];

  // System message: safety preamble + agent's prompt
  messages.push({
    role: "system",
    content: `${SAFETY_PREAMBLE}\n\n${agent.systemPrompt}`,
  });

  if (turnIndex === 0) {
    // First turn: just the topic as user message
    messages.push({ role: "user", content: topic });
  } else {
    // Subsequent turns: reconstruct conversation history
    // First message is always the topic
    messages.push({ role: "user", content: topic });

    // Add prior transcript entries
    for (const entry of transcript) {
      if (entry.agentId === agent.id) {
        // This agent's prior turns become "assistant"
        messages.push({ role: "assistant", content: entry.content });
      } else {
        // Other agents' turns become "user" with name prefix
        messages.push({
          role: "user",
          content: `${entry.agentName}: ${entry.content}`,
        });
      }
    }
  }

  return messages;
}

/**
 * Execute the turn loop for a bout.
 *
 * Iterates through turns, selecting agents round-robin, calling the LLM,
 * streaming responses, and collecting transcript entries.
 *
 * @throws if any LLM call fails — errors propagate without retry
 */
export async function executeTurnLoop(
  config: TurnLoopConfig,
  callbacks: TurnCallback,
): Promise<TranscriptEntry[]> {
  const { preset, topic, model } = config;
  const maxTurns = config.maxTurns ?? preset.maxTurns;
  const { agents } = preset;

  const transcript: TranscriptEntry[] = [];

  for (let turnIndex = 0; turnIndex < maxTurns; turnIndex++) {
    // Round-robin agent selection
    const agent = agents[turnIndex % agents.length];

    callbacks.onTurnStart(turnIndex, agent);

    // Build messages for this turn
    const messages = buildTurnMessages(agent, topic, transcript, turnIndex);

    // Call LLM with streaming
    const result = streamText({
      model,
      messages,
    });

    // Accumulate streamed text
    let content = "";
    for await (const delta of result.textStream) {
      content += delta;
      callbacks.onTextDelta(turnIndex, delta);
    }

    // Get token usage after stream completes
    const usage = await result.usage;
    const tokenCount = usage.outputTokens ?? 0;

    callbacks.onTurnEnd(turnIndex, tokenCount);

    // Create transcript entry
    const entry: TranscriptEntry = {
      turnIndex,
      agentId: agent.id,
      agentName: agent.name,
      agentColor: agent.color,
      content,
      tokenCount,
      timestamp: new Date().toISOString(),
    };

    transcript.push(entry);
  }

  return transcript;
}

const SHARE_LINE_SYSTEM_PROMPT =
  "You are a witty headline writer. Write one punchy sentence summarizing this debate. Maximum 80 tokens. No hashtags. No emoji.";

/**
 * Generate a share line from a completed transcript.
 * Uses a separate LLM call (non-streaming) to Haiku for summarization.
 */
export async function generateShareLine(
  transcript: TranscriptEntry[],
  model: LanguageModel,
): Promise<string> {
  // Summarize transcript: agent names + first 100 chars of each turn
  const summaryLines = transcript.map(
    (entry) =>
      `${entry.agentName}: ${entry.content.slice(0, 100)}${entry.content.length > 100 ? "..." : ""}`,
  );
  const transcriptSummary = summaryLines.join("\n");

  const result = await generateText({
    model,
    system: SHARE_LINE_SYSTEM_PROMPT,
    prompt: transcriptSummary,
    maxOutputTokens: 80,
  });

  return result.text.trim();
}

/**
 * Compute actual cost from transcript token counts.
 * Sums output tokens across all turns and applies model pricing.
 */
export function computeActualCostMicro(
  transcript: TranscriptEntry[],
  model: ModelId,
): number {
  const pricing = MODEL_PRICING[model];

  // Sum output tokens (we don't track input tokens in transcript)
  const totalOutputTokens = transcript.reduce(
    (sum, entry) => sum + (entry.tokenCount ?? 0),
    0,
  );

  // Estimate input tokens: ~500 per turn (same as preauth estimate)
  const estimatedInputTokens = transcript.length * 500;

  // Calculate GBP cost
  const inputCostGbp =
    (estimatedInputTokens * pricing.inputPerMillion) / 1_000_000;
  const outputCostGbp =
    (totalOutputTokens * pricing.outputPerMillion) / 1_000_000;
  const baseCostGbp = inputCostGbp + outputCostGbp;
  const totalCostGbp = baseCostGbp * (1 + CREDIT_PLATFORM_MARGIN);

  // Convert to micro-credits
  const microCost = (totalCostGbp / GBP_PER_CREDIT) * MICRO_PER_CREDIT;

  return Math.ceil(microCost);
}
