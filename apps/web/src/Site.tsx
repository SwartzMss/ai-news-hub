import type { PublicData, Page, Story, Report } from "./types";
const category: Record<string, string> = {
  ai: "AI",
  opensource: "开源",
  developer_tools: "开发工具",
  security: "安全",
  industry: "产业",
  other: "其他",
};
const stamp = (s: string | null) =>
  s
    ? s.replace("T", " ").replace(".000Z", " UTC").replace("Z", " UTC")
    : "未知";
const reportPath = (r: Report) =>
  `/archive/${r.report_date}/opensource/v${String(r.version).padStart(6, "0")}/`;
function Meta({ story }: { story: Story }) {
  return (
    <div className="meta">
      <span>{story.source.name}</span>
      <span>来源发布 {stamp(story.source.published_at)}</span>
    </div>
  );
}
function Row({ story }: { story: Story }) {
  return (
    <article className="entry">
      <div className="entry-content">
        <div className="kicker">
          {category[story.category] ?? story.category}{" "}
          <span>· {story.report_date}</span>
        </div>
        <h2>
          <a href={`/news/${story.key}/`}>{story.evidence_quote}</a>
        </h2>
        <p>{story.fact_summary}</p>
        <Meta story={story} />
      </div>
      <div className="priority">
        <strong>{story.importance}</strong>
        <span>/ 5</span>
      </div>
    </article>
  );
}
function Empty() {
  return (
    <section className="empty">
      <h2>还没有已发布的日报</h2>
      <p>内容经人工允许发布并归档后，会出现在这里。</p>
    </section>
  );
}
function DateList({ reports }: { reports: Report[] }) {
  return (
    <div className="date-list">
      {reports.map((r) => (
        <article key={r.report_id}>
          <div className="kicker">{r.report_date} · 开源生态</div>
          <h2>
            <a href={`/archive/${r.report_date}/`}>{r.title}</a>
          </h2>
          <p>
            {r.items.length} 条来源 · 当前版本 {r.version} ·{" "}
            <a href={reportPath(r)}>版本记录</a>
          </p>
        </article>
      ))}
    </div>
  );
}
export function Site({ data, page }: { data: PublicData; page: Page }) {
  const latestDate = data.latest[0]?.report_date;
  const today = data.current.filter((x) => x.report_date === latestDate);
  const story = data.articles.find((x) => x.key === page.key);
  const daily = page.date
    ? data.latest.find((r) => r.report_date === page.date)
    : undefined;
  const revision =
    page.kind === "report"
      ? data.reports.find(
          (r) => r.report_date === page.date && r.version === page.version,
        )
      : undefined;
  const selected = revision ?? daily;
  const selectedStories = selected?.items.map((item) => ({
    ...item,
    key: data.articles.find((x) => x.id === item.id)!.key,
    report_date: selected.report_date,
    report_version: selected.version,
    first_approved_at: selected.approved_at,
  }));
  return (
    <div className="shell">
      <a className="skip-link" href="#content">
        跳到正文
      </a>
      <header className="masthead">
        <a className="brand" href="/">
          <span className="brand-mark">
            N<i />
          </span>
          <span>
            AI <em>News</em> Hub
          </span>
        </a>
        <span className="header-note">
          来源可追溯 <b>·</b> 把判断留给你
        </span>
        <div className="header-actions">
          <button id="theme-toggle" aria-label="切换明暗主题" type="button">
            ◐
          </button>
          <a className="subscribe" href="/rss/all.xml">
            ◔ 订阅 RSS
          </a>
        </div>
      </header>
      {data.demo && (
        <p className="demo-banner" role="note">
          演示 / 测试站点：以下内容只用于验证页面、历史归档与
          RSS，不作为正式新闻发布。
        </p>
      )}
      <nav className="mobile-nav" aria-label="移动导航">
        <a href="/">今日精选</a>
        <a href="/channel/opensource/">开源生态</a>
        <a href="/archive/">历史归档</a>
      </nav>
      <div className="app-grid">
        <aside className="leftcol">
          <div className="section-label">探索内容</div>
          <nav aria-label="主导航">
            <a className={page.kind === "home" ? "active" : ""} href="/">
              ◈ 今日精选
            </a>
            <a
              className={page.kind === "channel" ? "active" : ""}
              href="/channel/opensource/"
            >
              ⌘ 开源生态
            </a>
            <a
              className={
                ["archive", "date", "report"].includes(page.kind)
                  ? "active"
                  : ""
              }
              href="/archive/"
            >
              ◷ 历史归档
            </a>
          </nav>
          <div className="side-card">
            <strong>少一点噪声，多一点依据。</strong>
            <p>摘要、分析与来源分开展示。重要信息，始终回到原文核对。</p>
            <a href="/rss/opensource.xml">订阅开源频道 →</a>
          </div>
          <p className="side-bottom">静态阅读 · 无需登录</p>
        </aside>
        <main id="content" className="center">
          {page.kind === "home" && (
            <>
              <div className="toprow">
                <span>
                  每日精选 / <b>Daily brief</b>
                </span>
                <span className="mini-tag">
                  {latestDate ?? "等待第一份日报"}
                </span>
              </div>
              <section className="hero">
                <div className="eyebrow">A CLEARER VIEW OF WHAT MATTERS</div>
                <h1>
                  每天发生很多事。
                  <br />
                  重要的，值得看清。
                </h1>
                <p>
                  精选开发者生态动态，区分来源事实与 AI 推断。
                  <br />
                  让每一条信息，都能找到它的出处。
                </p>
                <a href="#highlights">开始阅读 ↓</a>
                <span>人工允许发布 · 保留来源</span>
              </section>
              <div className="divider-title" id="highlights">
                <h2>
                  重点关注 <em>/</em> Editor’s pick
                </h2>
                <span>重要性排序</span>
              </div>
              {today[0] ? (
                <>
                  <section className="feature">
                    <div>
                      <div className="kicker">
                        {category[today[0].category]} · {today[0].source.name}
                      </div>
                      <h2>
                        <a href={`/news/${today[0].key}/`}>
                          {today[0].evidence_quote}
                        </a>
                      </h2>
                      <p>{today[0].fact_summary}</p>
                      <a className="text-link" href={`/news/${today[0].key}/`}>
                        阅读摘要与来源 →
                      </a>
                    </div>
                    <div className="score">
                      <span>AI PRIORITY</span>
                      <strong>
                        {today[0].importance}
                        <small>/5</small>
                      </strong>
                      <span>重要性 · 非热度</span>
                    </div>
                  </section>
                  <div className="divider-title">
                    <h2>更多值得关注</h2>
                    <a href="/archive/">历史日报 →</a>
                  </div>
                  {today.slice(1).map((s) => (
                    <Row key={s.key} story={s} />
                  ))}
                  {today.length === 1 && (
                    <p className="muted">
                      这一期共收录 1 条来源，更多历史内容可在归档中查看。
                    </p>
                  )}
                </>
              ) : (
                <Empty />
              )}
            </>
          )}
          {page.kind === "channel" && (
            <>
              <div className="kicker">CURATED CHANNEL</div>
              <h1>开源生态</h1>
              <p className="intro">
                开源项目、开发工具与基础设施。摘要和推断分开看，来源随时可查。
              </p>
              <div className="controls">
                <span>全部 {data.current.length} 条</span>
                <a href="/rss/opensource.xml">订阅本频道 ↗</a>
                <span className="muted">按日报日期与重要性排序</span>
              </div>
              {data.current.length ? (
                data.current.map((s) => <Row key={s.key} story={s} />)
              ) : (
                <Empty />
              )}
            </>
          )}
          {page.kind === "article" && story && (
            <>
              <div className="breadcrumb">
                <a href="/channel/opensource/">开源生态</a> / 来源详情
              </div>
              <div className="kicker">
                {category[story.category]} · 重要性 {story.importance}/5
              </div>
              <h1 className="article-title">{story.evidence_quote}</h1>
              <Meta story={story} />
              <p className="review-note">
                已人工允许发布 · 仅基于所列来源整理，尚未独立事实核验。
              </p>
              <section className="article-section">
                <h2>来源事实摘要</h2>
                <p>{story.fact_summary}</p>
              </section>
              <section className="article-section analysis">
                <div className="kicker">AI ANALYSIS · INFERENCE</div>
                <h2>分析与推断</h2>
                <p>{story.analysis ?? "本条未附加推断。"}</p>
              </section>
              <section className="article-section">
                <h2>来源证据</h2>
                <blockquote>{story.evidence_quote}</blockquote>
                <p>
                  <a
                    href={story.source.canonical_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {story.source.name} · 阅读原文 ↗
                  </a>
                </p>
                <dl>
                  <dt>来源原始发布时间</dt>
                  <dd>{stamp(story.source.published_at)}</dd>
                  <dt>事件发生时间</dt>
                  <dd>{stamp(story.source.event_at)}</dd>
                  <dt>首次抓取时间</dt>
                  <dd>{stamp(story.source.fetched_at)}</dd>
                  <dt>所属日报</dt>
                  <dd>
                    <a href={`/archive/${story.report_date}/`}>
                      {story.report_date}
                    </a>{" "}
                    · 版本 {story.report_version}
                  </dd>
                </dl>
                <p className="muted">
                  来源可能继续更新。本文保留归档时的信息，重要事实请结合原文核实。
                </p>
              </section>
              <a href="/channel/opensource/">← 返回频道</a>
            </>
          )}
          {page.kind === "archive" && (
            <>
              <div className="kicker">DAILY ARCHIVE</div>
              <h1>把重要信息留在时间里。</h1>
              <p className="intro">
                按日期回看已发布日报，查看每一次修订。日期代表日报归档日，不等于事件发生日。
              </p>
              {data.latest.length ? (
                <DateList reports={data.latest} />
              ) : (
                <Empty />
              )}
            </>
          )}
          {["date", "report"].includes(page.kind) && selected && (
            <>
              <div className="breadcrumb">
                <a href="/archive/">历史归档</a> / {selected.report_date}
              </div>
              <div className="kicker">
                DAILY BRIEF · VERSION {selected.version}
              </div>
              <h1>{selected.title}</h1>
              <p className="intro">
                {selected.report_date} · 开源生态 · {selected.items.length}{" "}
                条来源
              </p>
              <div className="versions">
                历史版本：
                {data.reports
                  .filter((r) => r.report_date === selected.report_date)
                  .map((r) => (
                    <a key={r.report_id} href={reportPath(r)}>
                      v{r.version}
                    </a>
                  ))}
              </div>
              {page.kind === "report" && (
                <p className="review-note">
                  这是不可覆盖的历史版本。
                  <a href={`/archive/${selected.report_date}/`}>
                    查看当日最新版本 →
                  </a>
                </p>
              )}
              {selectedStories?.map((s) => (
                <section className="historical-story" key={s.key}>
                  <Row story={s} />
                  <p>
                    <b>该版本分析（推断）：</b>
                    {s.analysis ?? "无"}
                  </p>
                  <blockquote>{s.evidence_quote}</blockquote>
                  <a
                    href={s.source.canonical_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    该版本原始来源 ↗
                  </a>
                  <p className="muted">
                    来源发布：{stamp(s.source.published_at)} · 事件：
                    {stamp(s.source.event_at)} · 抓取：
                    {stamp(s.source.fetched_at)}
                  </p>
                </section>
              ))}
            </>
          )}
          {page.kind === "404" && (
            <section className="empty">
              <h1>没有找到这页内容</h1>
              <p>请返回首页或按日期查找历史日报。</p>
              <a href="/">返回首页 →</a>
            </section>
          )}
          <footer>
            <span>AI News Hub · 有来源的信息，审慎的判断。</span>
            <a href="/rss/all.xml">RSS</a>
          </footer>
        </main>
        <aside className="rightcol">
          <div className="section-label">阅读速览</div>
          <section className="rail-card">
            <div className="kicker">LATEST BRIEF</div>
            <h2>{latestDate ?? "等待更新"}</h2>
            <div className="rail-number">
              {today.length}
              <span> 条来源</span>
            </div>
            <p>当前公开内容：开源生态。其他频道将在有实际来源后开放。</p>
          </section>
          <section className="rail-card">
            <h2>如何阅读这份简报</h2>
            <ul>
              <li>先读来源事实摘要</li>
              <li>将分析视为推断</li>
              <li>重要事项回到原文核对</li>
            </ul>
            <p className="muted">
              重要性评分由 AI 整理，不是点赞数、热度或投资建议。
            </p>
          </section>
          <section className="rail-card green">
            <h2>让更新自己到来。</h2>
            <p>使用你熟悉的 RSS 阅读器，订阅全站或频道更新。</p>
            <a href="/rss/all.xml">全站 RSS →</a>
          </section>
        </aside>
      </div>
    </div>
  );
}
