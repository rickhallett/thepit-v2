"use client";

// useBout — React hook for consuming bout SSE streams.
// Handles fetch POST to /api/run-bout, SSE parsing, and message state.

import { useState, useCallback, useRef, useEffect } from "react";

export type BoutStatus = "idle" | "streaming" | "done" | "error";

export interface BoutMessage {
  turnIndex: number;
  agentId: string;
  agentName: string;
  agentColor: string;
  content: string;
  isStreaming: boolean;
}

export interface UseBoutReturn {
  messages: BoutMessage[];
  status: BoutStatus;
  shareLine: string | null;
  error: string | null;
  startBout: (params: {
    boutId: string;
    presetId: string;
    topic?: string;
    model?: string;
  }) => void;
}

interface SSEEvent {
  event: string;
  data: string;
}

/**
 * Parse a raw SSE chunk into individual events.
 * SSE format: `event: {type}\ndata: {json}\n\n`
 */
function parseSSEChunk(chunk: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  const blocks = chunk.split("\n\n").filter(Boolean);

  for (const block of blocks) {
    const lines = block.split("\n");
    let event = "";
    let data = "";

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        event = line.slice(7);
      } else if (line.startsWith("data: ")) {
        data = line.slice(6);
      }
    }

    if (event && data) {
      events.push({ event, data });
    }
  }

  return events;
}

export function useBout(): UseBoutReturn {
  const [messages, setMessages] = useState<BoutMessage[]>([]);
  const [status, setStatus] = useState<BoutStatus>("idle");
  const [shareLine, setShareLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const startBout = useCallback(
    (params: { boutId: string; presetId: string; topic?: string; model?: string }) => {
      // Abort any existing request
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Reset state
      setMessages([]);
      setStatus("streaming");
      setShareLine(null);
      setError(null);

      async function run() {
        try {
          const response = await fetch("/api/run-bout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
            signal: controller.signal,
          });

          if (!response.ok) {
            const text = await response.text();
            let errorMessage: string;
            try {
              const parsed = JSON.parse(text) as { message?: string };
              errorMessage = parsed.message || `HTTP ${response.status}`;
            } catch {
              errorMessage = text || `HTTP ${response.status}`;
            }
            setError(errorMessage);
            setStatus("error");
            return;
          }

          const reader = response.body?.getReader();
          if (!reader) {
            setError("No response body");
            setStatus("error");
            return;
          }

          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Only parse complete SSE frames (terminated by \n\n).
            // Partial frames stay in the buffer until the next chunk completes them.
            const lastDoubleNewline = buffer.lastIndexOf("\n\n");
            if (lastDoubleNewline === -1) continue; // No complete frames yet

            const completePart = buffer.slice(0, lastDoubleNewline + 2);
            buffer = buffer.slice(lastDoubleNewline + 2);

            const events = parseSSEChunk(completePart);

            for (const sseEvent of events) {
              let data: Record<string, unknown>;
              try {
                data = JSON.parse(sseEvent.data) as Record<string, unknown>;
              } catch {
                // Malformed JSON in SSE event — skip this event
                continue;
              }

              switch (sseEvent.event) {
                case "data-turn": {
                  const turnIndex = data.turnIndex as number;
                  const agentId = data.agentId as string;
                  const agentName = data.agentName as string;
                  const agentColor = data.agentColor as string;
                  setMessages((prev) => [
                    ...prev,
                    {
                      turnIndex,
                      agentId,
                      agentName,
                      agentColor,
                      content: "",
                      isStreaming: true,
                    },
                  ]);
                  break;
                }

                case "text-start":
                  // No-op — turn already added on data-turn
                  break;

                case "text-delta": {
                  const delta = data.delta as string;
                  const turnIndex = data.turnIndex as number;
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.turnIndex === turnIndex
                        ? { ...msg, content: msg.content + delta }
                        : msg,
                    ),
                  );
                  break;
                }

                case "text-end": {
                  const turnIndex = data.turnIndex as number;
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.turnIndex === turnIndex ? { ...msg, isStreaming: false } : msg,
                    ),
                  );
                  break;
                }

                case "data-share-line": {
                  const line = data.shareLine as string;
                  setShareLine(line);
                  break;
                }

                case "error": {
                  const message = data.message as string;
                  setError(message);
                  setStatus("error");
                  break;
                }

                case "done":
                  setStatus("done");
                  break;
              }
            }
          }
          // Stream ended — if status is still "streaming", set to "done"
          // (handles case where server closes without sending done/error event)
          setStatus((prev) => (prev === "streaming" ? "done" : prev));
        } catch (err) {
          // AbortError is expected on unmount/abort
          if (err instanceof Error && err.name === "AbortError") {
            return;
          }
          setError(err instanceof Error ? err.message : "Network error");
          setStatus("error");
        }
      }

      run();
    },
    [],
  );

  return { messages, status, shareLine, error, startBout };
}
