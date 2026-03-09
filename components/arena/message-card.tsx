"use client";

// MessageCard — displays a single agent turn in the bout.
// Shows agent name, colored left border, turn number, content, and reaction buttons.
// Blinking cursor indicator during streaming.

interface MessageCardProps {
  agentName: string;
  agentColor: string;
  content: string;
  turnIndex: number;
  isStreaming?: boolean;
  reactionCounts?: { heart: number; fire: number };
  userReactions?: Set<string>;
  onReact?: (turnIndex: number, type: "heart" | "fire") => void;
}

export function MessageCard({
  agentName,
  agentColor,
  content,
  turnIndex,
  isStreaming,
  reactionCounts,
  userReactions,
  onReact,
}: MessageCardProps) {
  const heartKey = `${turnIndex}:heart`;
  const fireKey = `${turnIndex}:fire`;
  const hasHeart = userReactions?.has(heartKey) ?? false;
  const hasFire = userReactions?.has(fireKey) ?? false;

  return (
    <div
      data-testid="message-card"
      className="border-l-4 bg-stone-900 p-4"
      style={{ borderLeftColor: agentColor }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-sm font-bold" style={{ color: agentColor }}>
          {agentName}
        </span>
        <span className="font-mono text-xs text-stone-500">
          Turn {turnIndex + 1}
        </span>
      </div>
      <div className="whitespace-pre-wrap text-stone-200">
        {content}
        {isStreaming && (
          <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-stone-400" />
        )}
      </div>
      {reactionCounts && onReact && (
        <div className="mt-3 flex gap-3">
          <button
            data-testid="reaction-heart"
            type="button"
            aria-pressed={hasHeart}
            onClick={() => onReact(turnIndex, "heart")}
            className={`flex items-center gap-1 rounded px-2 py-1 font-mono text-sm transition-colors ${
              hasHeart
                ? "bg-red-900 text-red-300"
                : "bg-stone-800 text-stone-400 hover:bg-stone-700"
            }`}
          >
            <span>{"<3"}</span>
            <span>{reactionCounts.heart}</span>
          </button>
          <button
            data-testid="reaction-fire"
            type="button"
            aria-pressed={hasFire}
            onClick={() => onReact(turnIndex, "fire")}
            className={`flex items-center gap-1 rounded px-2 py-1 font-mono text-sm transition-colors ${
              hasFire
                ? "bg-orange-900 text-orange-300"
                : "bg-stone-800 text-stone-400 hover:bg-stone-700"
            }`}
          >
            <span>{"^"}</span>
            <span>{reactionCounts.fire}</span>
          </button>
        </div>
      )}
    </div>
  );
}
