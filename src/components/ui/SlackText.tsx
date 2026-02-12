'use client';

import React from 'react';

interface SlackTextProps {
  text: string;
  userMap?: Map<string, string>;
  className?: string;
}

type TextSegment =
  | { type: 'text'; value: string }
  | { type: 'mention'; userId: string; displayName: string }
  | { type: 'channel'; channelId: string; name: string }
  | { type: 'link'; url: string; label: string };

function parseSlackText(text: string, userMap?: Map<string, string>): TextSegment[] {
  const segments: TextSegment[] = [];
  // Match Slack special tokens: <@U...>, <#C...|name>, <url>, <url|label>, <!subteam^...|@name>
  const regex = /<([^>]+)>/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Add text before this match
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }

    const inner = match[1];

    if (inner.startsWith('@')) {
      // User mention: <@U06P60EQL> or <@U06P60EQL|username>
      const parts = inner.substring(1).split('|');
      const userId = parts[0];
      const fallback = parts[1] || userMap?.get(userId) || userId;
      segments.push({ type: 'mention', userId, displayName: fallback });
    } else if (inner.startsWith('#')) {
      // Channel reference: <#C12345|channel-name>
      const parts = inner.substring(1).split('|');
      const channelId = parts[0];
      const name = parts[1] || channelId;
      segments.push({ type: 'channel', channelId, name });
    } else if (inner.startsWith('!')) {
      // Special command: <!subteam^S...|@group> or <!here> etc.
      const parts = inner.split('|');
      const label = parts[1] || inner.substring(1).split('^')[0];
      segments.push({ type: 'mention', userId: '', displayName: label });
    } else {
      // URL: <https://example.com> or <https://example.com|Display Text>
      const pipeIndex = inner.indexOf('|');
      if (pipeIndex !== -1) {
        const url = inner.substring(0, pipeIndex);
        const label = inner.substring(pipeIndex + 1);
        segments.push({ type: 'link', url, label });
      } else {
        segments.push({ type: 'link', url: inner, label: inner });
      }
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return segments;
}

export function SlackText({ text, userMap, className }: SlackTextProps) {
  const segments = parseSlackText(text, userMap);

  return (
    <span className={className}>
      {segments.map((seg, i) => {
        switch (seg.type) {
          case 'text':
            return <React.Fragment key={i}>{seg.value}</React.Fragment>;
          case 'mention':
            return (
              <span
                key={i}
                className="inline-block bg-blue-100 text-blue-800 rounded px-1 text-sm font-medium"
              >
                @{seg.displayName}
              </span>
            );
          case 'channel':
            return (
              <span
                key={i}
                className="inline-block bg-gray-100 text-gray-800 rounded px-1 text-sm font-medium"
              >
                #{seg.name}
              </span>
            );
          case 'link':
            return (
              <a
                key={i}
                href={seg.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline break-all"
              >
                {seg.label}
              </a>
            );
          default:
            return null;
        }
      })}
    </span>
  );
}
