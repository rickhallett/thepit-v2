/**
 * use-bout.test.ts — Tests for useBout React hook.
 *
 * Uses @testing-library/react for hook testing.
 * Mocks globalThis.fetch to return mock SSE streams.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useBout } from "./use-bout";

/**
 * Create a mock Response with an SSE stream body.
 */
function createMockSSEResponse(
  events: Array<{ event: string; data: object }>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const e of events) {
        const formatted = `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`;
        controller.enqueue(encoder.encode(formatted));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

/**
 * Create a mock Response with SSE events that arrive over time.
 */
function createDelayedSSEResponse(
  events: Array<{ event: string; data: object; delay?: number }>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for (const e of events) {
        if (e.delay) {
          await new Promise((resolve) => setTimeout(resolve, e.delay));
        }
        const formatted = `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`;
        controller.enqueue(encoder.encode(formatted));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("useBout", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("returns initial state with idle status", () => {
    const { result } = renderHook(() => useBout());

    expect(result.current.status).toBe("idle");
    expect(result.current.messages).toEqual([]);
    expect(result.current.shareLine).toBeNull();
    expect(result.current.error).toBeNull();
    expect(typeof result.current.startBout).toBe("function");
  });

  it("sets status to streaming when startBout is called", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockSSEResponse([{ event: "done", data: {} }]),
    );

    const { result } = renderHook(() => useBout());

    act(() => {
      result.current.startBout({
        boutId: "test-bout-id",
        presetId: "test-preset",
      });
    });

    // Status should immediately be streaming
    expect(result.current.status).toBe("streaming");

    // Wait for completion
    await waitFor(() => {
      expect(result.current.status).toBe("done");
    });
  });

  it("adds a message on data-turn event", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockSSEResponse([
        {
          event: "data-turn",
          data: {
            turnIndex: 0,
            agentId: "agent-1",
            agentName: "Alice",
            agentColor: "#ff0000",
          },
        },
        { event: "done", data: {} },
      ]),
    );

    const { result } = renderHook(() => useBout());

    act(() => {
      result.current.startBout({
        boutId: "test-bout-id",
        presetId: "test-preset",
      });
    });

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });

    expect(result.current.messages[0]).toEqual({
      turnIndex: 0,
      agentId: "agent-1",
      agentName: "Alice",
      agentColor: "#ff0000",
      content: "",
      isStreaming: true,
    });
  });

  it("appends text-delta to current message content", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockSSEResponse([
        {
          event: "data-turn",
          data: {
            turnIndex: 0,
            agentId: "agent-1",
            agentName: "Alice",
            agentColor: "#ff0000",
          },
        },
        { event: "text-start", data: { turnIndex: 0 } },
        { event: "text-delta", data: { turnIndex: 0, delta: "Hello " } },
        { event: "text-delta", data: { turnIndex: 0, delta: "world!" } },
        { event: "done", data: {} },
      ]),
    );

    const { result } = renderHook(() => useBout());

    act(() => {
      result.current.startBout({
        boutId: "test-bout-id",
        presetId: "test-preset",
      });
    });

    await waitFor(() => {
      expect(result.current.status).toBe("done");
    });

    expect(result.current.messages[0]?.content).toBe("Hello world!");
  });

  it("marks message as not streaming on text-end", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockSSEResponse([
        {
          event: "data-turn",
          data: {
            turnIndex: 0,
            agentId: "agent-1",
            agentName: "Alice",
            agentColor: "#ff0000",
          },
        },
        { event: "text-start", data: { turnIndex: 0 } },
        { event: "text-delta", data: { turnIndex: 0, delta: "Hello" } },
        { event: "text-end", data: { turnIndex: 0, tokenCount: 5 } },
        { event: "done", data: {} },
      ]),
    );

    const { result } = renderHook(() => useBout());

    act(() => {
      result.current.startBout({
        boutId: "test-bout-id",
        presetId: "test-preset",
      });
    });

    await waitFor(() => {
      expect(result.current.status).toBe("done");
    });

    expect(result.current.messages[0]?.isStreaming).toBe(false);
  });

  it("sets shareLine on data-share-line event", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockSSEResponse([
        {
          event: "data-share-line",
          data: { shareLine: "Check out this debate!" },
        },
        { event: "done", data: {} },
      ]),
    );

    const { result } = renderHook(() => useBout());

    act(() => {
      result.current.startBout({
        boutId: "test-bout-id",
        presetId: "test-preset",
      });
    });

    await waitFor(() => {
      expect(result.current.shareLine).toBe("Check out this debate!");
    });
  });

  it("sets status to done on done event", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockSSEResponse([{ event: "done", data: {} }]),
    );

    const { result } = renderHook(() => useBout());

    act(() => {
      result.current.startBout({
        boutId: "test-bout-id",
        presetId: "test-preset",
      });
    });

    await waitFor(() => {
      expect(result.current.status).toBe("done");
    });
  });

  it("sets status to error and error message on error event", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockSSEResponse([
        {
          event: "error",
          data: { code: "TURN_LOOP_ERROR", message: "Something went wrong" },
        },
      ]),
    );

    const { result } = renderHook(() => useBout());

    act(() => {
      result.current.startBout({
        boutId: "test-bout-id",
        presetId: "test-preset",
      });
    });

    await waitFor(() => {
      expect(result.current.status).toBe("error");
      expect(result.current.error).toBe("Something went wrong");
    });
  });

  it("handles full two-turn sequence correctly", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockSSEResponse([
        // Turn 0
        {
          event: "data-turn",
          data: {
            turnIndex: 0,
            agentId: "agent-1",
            agentName: "Alice",
            agentColor: "#ff0000",
          },
        },
        { event: "text-start", data: { turnIndex: 0 } },
        { event: "text-delta", data: { turnIndex: 0, delta: "First " } },
        { event: "text-delta", data: { turnIndex: 0, delta: "message." } },
        { event: "text-end", data: { turnIndex: 0, tokenCount: 10 } },
        // Turn 1
        {
          event: "data-turn",
          data: {
            turnIndex: 1,
            agentId: "agent-2",
            agentName: "Bob",
            agentColor: "#0000ff",
          },
        },
        { event: "text-start", data: { turnIndex: 1 } },
        { event: "text-delta", data: { turnIndex: 1, delta: "Second " } },
        { event: "text-delta", data: { turnIndex: 1, delta: "message." } },
        { event: "text-end", data: { turnIndex: 1, tokenCount: 12 } },
        // Done
        { event: "done", data: {} },
      ]),
    );

    const { result } = renderHook(() => useBout());

    act(() => {
      result.current.startBout({
        boutId: "test-bout-id",
        presetId: "test-preset",
      });
    });

    await waitFor(() => {
      expect(result.current.status).toBe("done");
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toEqual({
      turnIndex: 0,
      agentId: "agent-1",
      agentName: "Alice",
      agentColor: "#ff0000",
      content: "First message.",
      isStreaming: false,
    });
    expect(result.current.messages[1]).toEqual({
      turnIndex: 1,
      agentId: "agent-2",
      agentName: "Bob",
      agentColor: "#0000ff",
      content: "Second message.",
      isStreaming: false,
    });
  });

  it("sets error state on fetch failure (network error)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useBout());

    act(() => {
      result.current.startBout({
        boutId: "test-bout-id",
        presetId: "test-preset",
      });
    });

    await waitFor(() => {
      expect(result.current.status).toBe("error");
      expect(result.current.error).toBe("Network error");
    });
  });

  it("sets error state on non-200 response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ message: "Invalid preset" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    );

    const { result } = renderHook(() => useBout());

    act(() => {
      result.current.startBout({
        boutId: "test-bout-id",
        presetId: "invalid-preset",
      });
    });

    await waitFor(() => {
      expect(result.current.status).toBe("error");
      expect(result.current.error).toBe("Invalid preset");
    });
  });

  it("calls fetch with correct parameters", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      createMockSSEResponse([{ event: "done", data: {} }]),
    );
    globalThis.fetch = mockFetch;

    const { result } = renderHook(() => useBout());

    act(() => {
      result.current.startBout({
        boutId: "bout-123",
        presetId: "preset-abc",
        topic: "Climate change",
        model: "claude-haiku",
      });
    });

    await waitFor(() => {
      expect(result.current.status).toBe("done");
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/run-bout",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          boutId: "bout-123",
          presetId: "preset-abc",
          topic: "Climate change",
          model: "claude-haiku",
        }),
      }),
    );
  });

  it("handles SSE events split across chunk boundaries", async () => {
    const encoder = new TextEncoder();
    // Simulate a data-turn event split mid-JSON across two chunks
    const fullEvent = `event: data-turn\ndata: {"turnIndex":0,"agentId":"agent-1","agentName":"Alice","agentColor":"#ff0000"}\n\nevent: text-delta\ndata: {"turnIndex":0,"delta":"Hello"}\n\nevent: done\ndata: {}\n\n`;
    // Split in the middle of the JSON payload
    const splitPoint = 40; // Inside `{"turnIndex":0,"agentId":"ag`
    const chunk1 = fullEvent.slice(0, splitPoint);
    const chunk2 = fullEvent.slice(splitPoint);

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(chunk1));
        controller.enqueue(encoder.encode(chunk2));
        controller.close();
      },
    });
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    const { result } = renderHook(() => useBout());

    act(() => {
      result.current.startBout({
        boutId: "test-bout-id",
        presetId: "test-preset",
      });
    });

    await waitFor(() => {
      expect(result.current.status).toBe("done");
    });

    // Should have parsed all events correctly despite chunk split
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]?.agentName).toBe("Alice");
    expect(result.current.messages[0]?.content).toBe("Hello");
    expect(result.current.error).toBeNull();
  });

  it("resets state when startBout is called again", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockSSEResponse([
          {
            event: "data-turn",
            data: {
              turnIndex: 0,
              agentId: "agent-1",
              agentName: "Alice",
              agentColor: "#ff0000",
            },
          },
          { event: "text-delta", data: { turnIndex: 0, delta: "First" } },
          { event: "done", data: {} },
        ]),
      )
      .mockResolvedValueOnce(
        createMockSSEResponse([{ event: "done", data: {} }]),
      );

    const { result } = renderHook(() => useBout());

    // First bout
    act(() => {
      result.current.startBout({
        boutId: "bout-1",
        presetId: "preset-1",
      });
    });

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });

    // Second bout should reset state
    act(() => {
      result.current.startBout({
        boutId: "bout-2",
        presetId: "preset-2",
      });
    });

    // Messages should be reset immediately
    expect(result.current.messages).toEqual([]);
    expect(result.current.status).toBe("streaming");

    await waitFor(() => {
      expect(result.current.status).toBe("done");
    });
  });
});
