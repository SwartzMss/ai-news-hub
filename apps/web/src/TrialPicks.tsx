import type { Story } from "./types";
import { lead } from "./ReadingParts";

export function TrialPicks({ items, href }: { items: Story[]; href: (story: Story) => string }) {
  const picks = items.flatMap(story => {
    const match = /^上手优先级 ([1-3])\/3：/u.exec(story.analysis ?? "");
    return match ? [{ rank: Number(match[1]), story }] : [];
  }).sort((a, b) => a.rank - b.rank);
  if (picks.length !== 3 || picks.some((pick, index) => pick.rank !== index + 1)) return null;
  return (
    <section className="trial-picks" aria-label="最值得试用的三个项目">
      <h2>最值得实际试用的 3 个项目</h2>
      <ol>
        {picks.map(({ rank, story }) => <li key={story.id}>
          <span>上手优先级 {rank}</span>
          <a href={href(story)}>{lead(story).title}</a>
        </li>)}
      </ol>
    </section>
  );
}
