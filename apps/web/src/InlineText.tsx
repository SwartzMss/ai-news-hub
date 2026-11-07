import type { ReactNode } from "react";

// Only render explicit HTTP(S) Markdown links. Everything else remains escaped text.
export function InlineText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let offset = 0;
  for (const match of text.matchAll(
    /(?<!!)\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/gu,
  )) {
    const index = match.index;
    let safe = false;
    try {
      const url = new URL(match[2]);
      safe =
        !url.username && !url.password && !Array.from(match[2]).some((char) => char.charCodeAt(0) < 32);
    } catch {
      /* Invalid links stay plain text. */
    }
    if (!safe) continue;
    parts.push(text.slice(offset, index));
    parts.push(
      <a key={index} href={match[2]} target="_blank" rel="noopener noreferrer">
        {match[1]}
      </a>,
    );
    offset = index + match[0].length;
  }
  parts.push(text.slice(offset));
  return <>{parts}</>;
}
