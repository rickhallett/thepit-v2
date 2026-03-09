"use client";

// Arena — bout viewer component.
// Renders completed bout transcripts statically, or streams live bouts via useBout hook.
// Auto-scrolls to bottom during streaming.

import { useEffect, useRef } from "react";
import { useBout, type BoutMessage } from "@/lib/bouts/use-bout";
import { MessageCard } from "./message-card";
import { SharePanel } from "@/components/engagement/share-panel";
import type { TranscriptEntry } from "@/lib/bouts/types";

interface ArenaProps {
  boutId: string;
  initialBout: {
    transcript: TranscriptEntry[] | null;
    status: string;
    shareLine: string | null;
    presetId: string;
    topic: string;
  } | null;
  autoStart?: {
    presetId: string;
    topic?: string;
    model?: string;
  };
}

export function Arena({ boutId, initialBout, autoStart }: ArenaProps) {
  const { messages, status, shareLine, error, startBout } = useBout();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-start streaming if autoStart is provided and no existing bout
  useEffect(() => {
    if (autoStart && !initialBout) {
      startBout({
        boutId,
        presetId: autoStart.presetId,
        topic: autoStart.topic,
        model: autoStart.model,
      });
    }
  }, [autoStart, initialBout, boutId, startBout]);

  // Auto-scroll to bottom during streaming — triggers on every text delta,
  // not just new turns, so long messages keep the viewport at the bottom.
  useEffect(() => {
    if (status === "streaming" && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, status]);

  // Determine what to render: static transcript or streaming messages.
  // Status is already normalized by page.tsx: "done" | "streaming" | "error" | "idle"
  const isCompleted = initialBout?.status === "done";
  const displayMessages: BoutMessage[] = isCompleted
    ? (initialBout.transcript ?? []).map((entry) => ({
        turnIndex: entry.turnIndex,
        agentId: entry.agentId,
        agentName: entry.agentName,
        agentColor: entry.agentColor,
        content: entry.content,
        isStreaming: false,
      }))
    : messages;

  const displayShareLine = isCompleted ? initialBout.shareLine : shareLine;
  const displayStatus = isCompleted ? "done" : status;

  return (
    <div className="mx-auto max-w-3xl py-8">
      {/* Pre-messages status (streaming indicator, idle, error) */}
      <div className="mb-6">
        {displayStatus === "streaming" && (
          <div className="flex items-center gap-2 text-stone-400">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-green-500" />
            Streaming...
          </div>
        )}
        {displayStatus === "error" && (
          <div className="text-red-500">{error || "An error occurred"}</div>
        )}
        {displayStatus === "idle" && !initialBout && (
          <div className="text-stone-400">Waiting to start...</div>
        )}
      </div>

      {/* Messages */}
      <div className="space-y-4">
        {displayMessages.map((msg) => (
          <MessageCard
            key={msg.turnIndex}
            agentName={msg.agentName}
            agentColor={msg.agentColor}
            content={msg.content}
            turnIndex={msg.turnIndex}
            isStreaming={msg.isStreaming}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Post-messages status — "Debate complete" appears at bottom where user is looking */}
      {displayStatus === "done" && (
        <div className="mt-6 text-center text-stone-400">Debate complete</div>
      )}

      {/* Share line + Share panel */}
      {displayShareLine && displayStatus === "done" && (
        <div className="mt-8 border-t border-stone-700 pt-6">
          <p className="text-sm text-stone-500">Share line</p>
          <p className="mt-1 text-lg font-medium italic text-stone-300">
            &ldquo;{displayShareLine}&rdquo;
          </p>
          <SharePanel boutId={boutId} shareLine={displayShareLine} />
        </div>
      )}
    </div>
  );
}
