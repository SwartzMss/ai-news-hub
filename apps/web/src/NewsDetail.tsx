import type { NewsDetails, Story } from './types';
import { InlineText } from './InlineText';
import { Source, lead } from './ReadingParts';
import { DetailAsideNav, MobileDetailNav, hasText, type DetailSection } from './DetailNavigation';

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
export function newsSections(details:NewsDetails,analysis?:string|null):DetailSection[]{
  const present=(items:{[key:string]:unknown}[]|undefined)=>!!items?.length;
  return [
    {id:'news-background',label:'事件概览',show:hasText(details.background)||details.timeline?.length===1},
    {id:'news-facts',label:'关键事实与数据',show:present(details.keyFacts)},
    {id:'news-timeline',label:'事件时间线',show:(details.timeline?.length??0)>1},
    {id:'news-positions',label:'各方表态',show:present(details.positions)},
    {id:'news-impacts',label:'影响',show:present(details.impacts)},
    {id:'news-uncertainties',label:'未确定事项',show:present(details.uncertainties?.filter(hasText).map(value=>({value})))},
    {id:'news-watchpoints',label:'后续观察',show:present(details.watchpoints?.filter(hasText).map(value=>({value})))},
    {id:'news-analysis',label:'分析与推断',show:hasText(analysis)},
    {id:'news-evidence',label:'来源与证据',show:true},
  ].filter(section=>section.show).map(({id,label})=>({id,label}));
}
export function NewsDetail({story}:{story:Story}){
  const details=story.details;
  if(!details||details.kind!=='news')return null;
  const sections=newsSections(details,story.analysis);
  const show=(id:string)=>sections.some(section=>section.id===id);
  return <article className="news-detail">
    <header className="news-detail-header detail-page-header"><h1 className="detail-page-title">{lead(story).title}</h1>
      {lead(story).rest&&<p className="news-detail-summary"><InlineText text={lead(story).rest}/></p>}
      <p className="news-detail-verification">研究资料由 Codex 提供；来源链接和格式校验不等于独立事实核验。</p>
    </header>
    <MobileDetailNav sections={sections}/>
    <div className="news-detail-sections">
      {show("news-background")&&<section id="news-background"><h2>事件概览</h2>{hasText(details.background)&&<p><InlineText text={details.background}/></p>}{details.timeline?.length===1&&<p><span id="news-timeline"/><time>{details.timeline[0].time}</time>：<InlineText text={details.timeline[0].event}/><EvidenceLinks ids={details.timeline[0].evidenceRefs} details={details}/></p>}</section>}
      {show("news-facts")&&<section id="news-facts"><h2>关键事实与数据</h2><div className="news-facts-scroll"><table><thead><tr><th scope="col">事项</th><th scope="col">内容</th><th scope="col">时间与性质</th><th scope="col">证据</th></tr></thead><tbody>{details.keyFacts?.map((fact,index)=><tr key={`${fact.name}-${index}`}><th scope="row">{fact.name}</th><td>{fact.value}{fact.unit&&` ${fact.unit}`}</td><td>{fact.period&&<span>{fact.period}</span>}<span className="news-fact-nature">{natureLabel[fact.nature]}</span></td><td><EvidenceLinks ids={fact.evidenceRefs} details={details}/></td></tr>)}</tbody></table></div></section>}
      {show("news-timeline")&&<section id="news-timeline"><h2>事件时间线</h2><ol className="news-timeline">{details.timeline?.map((entry,index)=><li key={`${entry.time}-${index}`}><time>{entry.time}</time><p><InlineText text={entry.event}/></p><EvidenceLinks ids={entry.evidenceRefs} details={details}/></li>)}</ol></section>}
      {show("news-positions")&&<section id="news-positions"><h2>各方表态</h2><ul className="news-positions">{details.positions?.map((position,index)=><li key={`${position.actor}-${index}`}><div><strong>{position.actor}</strong><span>{position.form==='quote'?'原话':'转述'}</span></div><p><InlineText text={position.statement}/></p><EvidenceLinks ids={position.evidenceRefs} details={details}/></li>)}</ul></section>}
      {show("news-impacts")&&<section id="news-impacts"><h2>影响</h2><ul className="news-impacts">{details.impacts?.map((impact,index)=><li key={index}><span>{impact.status==='observed'?'已观察':'分析推断'}</span><p><InlineText text={impact.description}/></p><EvidenceLinks ids={impact.evidenceRefs} details={details}/></li>)}</ul></section>}
      {show("news-uncertainties")&&<section id="news-uncertainties"><h2>未确定事项</h2><ul>{details.uncertainties?.filter(hasText).map((item,index)=><li key={index}><InlineText text={item}/></li>)}</ul></section>}
      {show("news-watchpoints")&&<section id="news-watchpoints"><h2>后续观察</h2><ul>{details.watchpoints?.filter(hasText).map((item,index)=><li key={index}><InlineText text={item}/></li>)}</ul></section>}
      {show("news-analysis")&&<section id="news-analysis"><h2>分析与推断</h2><p><InlineText text={story.analysis??""}/></p></section>}
      <section id="news-evidence"><h2>来源与证据</h2><span id="news-primary-source"/><h3>主要原始来源与原文短引</h3><Source story={story} expanded/>{!!details.evidence?.length&&<><h3>其他支持来源</h3><ol className="news-evidence">{details.evidence.map(source=><li id={`news-evidence-${source.id}`} key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.name} ↗</a><p>支持：{source.supports}</p></li>)}</ol></>}</section>
    </div>
  </article>;
}
export function NewsAside({details,analysis}:{details:NewsDetails;analysis?:string|null}){
  return <DetailAsideNav sections={newsSections(details,analysis)} className="news-aside"/>;
}
