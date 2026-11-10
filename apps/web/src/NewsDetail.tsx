import type { NewsDetails, Story } from './types';
import { InlineText } from './InlineText';
import { Source, lead } from './ReadingParts';

const natureLabel:Record<NonNullable<NewsDetails['keyFacts']>[number]['nature'],string>={
  confirmed:'已证实',statement:'当事方表述',reported:'媒体报道',estimate:'估算',inference:'推断',
};
function EvidenceLinks({ids,details}:{ids?:string[];details:NewsDetails}){
  if(!ids?.length)return null;
  return <span className="news-references">{ids.map(id=>{
    const source=details.evidence?.find(item=>item.id===id);
    return source?<a key={id} href={`#news-evidence-${id}`}>{source.name}</a>:null;
  })}</span>;
}
export function NewsDetail({story}:{story:Story}){
  const details=story.details;
  if(!details||details.kind!=='news')return null;
  return <article className="news-detail">
    <header className="news-detail-header"><p className="section-kicker">热点新闻观察</p><h1>{lead(story).title}</h1>
      {lead(story).rest&&<p className="news-detail-summary"><InlineText text={lead(story).rest}/></p>}
      <p className="news-detail-verification">研究资料由 Codex 提供；来源链接和格式校验不等于独立事实核验。</p>
    </header>
    <div className="news-detail-sections">
      <section id="news-background"><h2>事件背景</h2><p><InlineText text={details.background}/></p></section>
      {!!details.keyFacts?.length&&<section id="news-facts"><h2>关键事实</h2><div className="news-facts-scroll"><table><thead><tr><th scope="col">事项</th><th scope="col">内容</th><th scope="col">时间与性质</th><th scope="col">证据</th></tr></thead><tbody>{details.keyFacts.map((fact,index)=><tr key={`${fact.name}-${index}`}><th scope="row">{fact.name}</th><td>{fact.value}{fact.unit&&` ${fact.unit}`}</td><td>{fact.period&&<span>{fact.period}</span>}<span className="news-fact-nature">{natureLabel[fact.nature]}</span></td><td><EvidenceLinks ids={fact.evidenceRefs} details={details}/></td></tr>)}</tbody></table></div></section>}
      {!!details.timeline?.length&&<section id="news-timeline"><h2>事件时间线</h2><ol className="news-timeline">{details.timeline.map((entry,index)=><li key={`${entry.time}-${index}`}><time>{entry.time}</time><p><InlineText text={entry.event}/></p><EvidenceLinks ids={entry.evidenceRefs} details={details}/></li>)}</ol></section>}
      {!!details.positions?.length&&<section id="news-positions"><h2>各方表态</h2><ul className="news-positions">{details.positions.map((position,index)=><li key={`${position.actor}-${index}`}><div><strong>{position.actor}</strong><span>{position.form==='quote'?'原话':'转述'}</span></div><p><InlineText text={position.statement}/></p><EvidenceLinks ids={position.evidenceRefs} details={details}/></li>)}</ul></section>}
      {!!details.impacts?.length&&<section id="news-impacts"><h2>影响</h2><ul className="news-impacts">{details.impacts.map((impact,index)=><li key={index}><span>{impact.status==='observed'?'已观察':'分析推断'}</span><p><InlineText text={impact.description}/></p><EvidenceLinks ids={impact.evidenceRefs} details={details}/></li>)}</ul></section>}
      {!!details.uncertainties?.length&&<section id="news-uncertainties"><h2>未确定事项</h2><ul>{details.uncertainties.map((item,index)=><li key={index}><InlineText text={item}/></li>)}</ul></section>}
      {!!details.watchpoints?.length&&<section id="news-watchpoints"><h2>后续观察</h2><ul>{details.watchpoints.map((item,index)=><li key={index}><InlineText text={item}/></li>)}</ul></section>}
      {story.analysis&&<section id="news-analysis"><h2>分析与推断</h2><p><InlineText text={story.analysis}/></p></section>}
      {!!details.evidence?.length&&<section id="news-evidence"><h2>补充证据</h2><ol className="news-evidence">{details.evidence.map(source=><li id={`news-evidence-${source.id}`} key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.name} ↗</a><p>支持：{source.supports}</p></li>)}</ol></section>}
      <section id="news-primary-source"><h2>本次动态来源</h2><Source story={story}/></section>
    </div>
  </article>;
}
export function NewsAside({details}:{details:NewsDetails}){
  const sections=[['background','事件背景',true],['facts','关键事实',!!details.keyFacts?.length],['timeline','事件时间线',!!details.timeline?.length],['positions','各方表态',!!details.positions?.length],['impacts','影响',!!details.impacts?.length],['uncertainties','未确定事项',!!details.uncertainties?.length],['watchpoints','后续观察',!!details.watchpoints?.length],['evidence','补充证据',!!details.evidence?.length],['primary-source','本次动态来源',true]] as const;
  return <aside className="news-aside"><nav aria-label="本文目录"><h2>本文目录</h2><ol>{sections.filter(([, ,show])=>show).map(([id,label])=><li key={id}><a href={`#news-${id}`}>{label}</a></li>)}</ol></nav></aside>;
}
