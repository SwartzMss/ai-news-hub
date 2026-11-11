import type { Story } from "./types";
import { InlineText } from "./InlineText";
import { Source, lead } from "./ReadingParts";
import { storyPath } from "./paths";
import { DetailLinks, MobileDetailNav, type DetailSection } from "./DetailNavigation";

const factHeadings: Record<string, string> = {
  用途: "核心用途",
  技术要点: "技术要点",
  主要技术栈: "主要技术栈",
  核心架构: "核心架构",
  架构流程: "架构流程",
  近期证据: "近期关注原因",
  适用场景: "适用场景",
  许可证: "许可证",
};
const analysisHeadings: Record<string, string> = {
  推荐理由: "推荐理由",
  试用建议: "试用建议",
  限制: "限制",
  注意事项: "注意事项",
};
type Field = { heading: string; value: string; key: string };

function fields(text: string, headings: Record<string, string>) {
  const keys = Object.keys(headings).join("|");
  const pattern = new RegExp(`(?:^|；)\\s*(${keys})：`, "gu");
  const matches = [...text.matchAll(pattern)];
  return {
    prefix: text.slice(0, matches[0]?.index ?? text.length).replace(/^；|；$/gu, "").trim(),
    fields: matches.map((match, index): Field => ({
      key: match[1],
      heading: headings[match[1]],
      value: text.slice((match.index ?? 0) + match[0].length, matches[index + 1]?.index ?? text.length).replace(/^；|；$/gu, "").trim(),
    })).filter((field) => field.value),
  };
}

export function projectDetail(story: Story) {
  const { title, rest } = lead(story);
  const repoMatch = rest.match(/\[(?:项目仓库|代码仓库|GitHub|GitLab)\]\((https:\/\/[^\s)]+)\)/u);
  if (!repoMatch) return null;
  let repository: URL;
  try {
    repository = new URL(repoMatch[1]);
  } catch {
    return null;
  }
  if (repository.username || repository.password || !["github.com", "gitlab.com", "codeberg.org"].includes(repository.hostname)) return null;
  const path = repository.pathname.split("/").filter(Boolean);
  if (path.length < 2) return null;
  const cleanRest = rest.replace(repoMatch[0], "").replace(/[；。\s]+$/gu, "");
  const facts = fields(cleanRest, factHeadings);
  if (facts.fields.length < 2) return null;
  const analysis = story.analysis ? fields(story.analysis, analysisHeadings) : null;
  const name = title.match(/^(.+?)\s+(?=(?:正式|公开)?发布|推出|上线|更新|开源|新增|增加)/u)?.[1] ?? path[1];
  const subtitle = title === name ? "" : title;
  const status = facts.prefix.match(/【([^】]+)】/u)?.[1];
  const attribution = facts.prefix.replace(/【[^】]+】/u, "").trim();
  return { name, subtitle, status, attribution, repository: repoMatch[1], repositoryLabel: `${path[0]}/${path[1]}`, facts: facts.fields, analysis };
}

function legacySections(project:NonNullable<ReturnType<typeof projectDetail>>):DetailSection[]{
  return [...project.facts.map((field,index)=>({id:`project-fact-${index}`,label:field.heading})),
    ...(project.analysis?.prefix?[{id:'project-analysis-intro',label:'编辑判断'}]:[]),
    ...(project.analysis?.fields.map((field,index)=>({id:`project-analysis-${index}`,label:field.heading}))??[]),
    {id:'project-source',label:'来源与证据'}];
}
export function ProjectDetail({ story, number }: { story: Story; number?: number }) {
  const project = projectDetail(story);
  if (!project) return null;
  return (
    <article className="project-detail">
      <header className="project-header">
        <div className="project-heading">
          {number && <span className="project-number">{String(number).padStart(2, "0")}.</span>}
          <h1>{project.name}</h1>
        </div>
        {project.subtitle && <p className="project-subtitle">{project.subtitle}</p>}
        <a className="project-repository" href={project.repository} target="_blank" rel="noopener noreferrer">{project.repositoryLabel} ↗</a>
        {(project.status || project.attribution) && <p className="project-status">{[project.attribution, project.status].filter(Boolean).join(" · ")}</p>}
      </header>
      <MobileDetailNav sections={legacySections(project)}/>
      <div className="project-sections">
        {project.facts.map((field, index) => (
          <section id={`project-fact-${index}`} className={field.key === "技术要点" ? "project-technical" : undefined} key={field.key}>
            <h2>{field.heading}</h2>
            {field.key === "架构流程" ? <pre className="project-flow">{field.value}</pre> : field.key === "技术要点" && field.value.includes("；") ? (
              <ul>{field.value.split("；").filter(Boolean).map((point, i) => <li key={i}><InlineText text={point} /></li>)}</ul>
            ) : <p><InlineText text={field.value} /></p>}
          </section>
        ))}
        {project.analysis && (project.analysis.prefix || project.analysis.fields.length > 0) && (
          <section className="project-judgement">
            {project.analysis.prefix && <div id="project-analysis-intro"><h2>编辑判断</h2><p><InlineText text={project.analysis.prefix} /></p></div>}
            {project.analysis.fields.map((field, index) => <div id={`project-analysis-${index}`} key={field.key}><h2>{field.heading}</h2><p><InlineText text={field.value} /></p></div>)}
          </section>
        )}
        <div id="project-source"><Source story={story} /></div>
      </div>
    </article>
  );
}

export function ProjectAside({ project, related }: { project: NonNullable<ReturnType<typeof projectDetail>>; related: Story[] }) {
  return (
    <aside className="project-aside">
      <nav aria-label="本文目录" className="project-toc">
        <h2>本文目录</h2>
        <DetailLinks sections={legacySections(project)}/>
      </nav>
      {related.length > 0 && (
        <nav aria-label="本期其他项目" className="project-related">
          <h2>本期其他项目</h2>
          <ol>
            {related.map((item) => <li key={item.id}><a href={storyPath(item)}>{lead(item).title}</a></li>)}
          </ol>
        </nav>
      )}
    </aside>
  );
}
