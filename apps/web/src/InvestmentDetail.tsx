import type { InvestmentDetails, Story } from './types';
import { InlineText } from './InlineText';
import { Source, lead } from './ReadingParts';
import { DetailAsideNav, MobileDetailNav, hasText, type DetailSection } from './DetailNavigation';

const basisLabel:Record<NonNullable<InvestmentDetails['metrics']>[number]['basis'],string>={
  actual:'实际值',guidance:'公司指引',consensus:'市场预期',estimate:'估算',inference:'推断',
};

function EvidenceLinks({ids,details}:{ids?:string[];details:InvestmentDetails}){
  if(!ids?.length)return null;
  return <span className="investment-references">{ids.map(id=>{
    const source=details.evidence?.find(item=>item.id===id);
    return source?<a key={id} href={`#investment-evidence-${id}`}>{source.name}</a>:null;
  })}</span>;
}

export function investmentSections(details:InvestmentDetails,analysis?:string|null):DetailSection[]{
  return [
    {id:'investment-background',label:'事件概览',show:hasText(details.background)},
    {id:'investment-metrics',label:'核心数据',show:!!details.metrics?.length},
    {id:'investment-chain',label:'产业链影响',show:!!details.supplyChain?.length},
    {id:'investment-logic',label:'投资逻辑',show:hasText(details.investmentLogic)},
    {id:'investment-watchpoints',label:'后续观察指标',show:!!details.watchpoints?.some(hasText)},
    {id:'investment-risks',label:'风险与反证',show:!!details.risks?.some(hasText)},
    {id:'investment-valuation',label:'估值与市场预期',show:hasText(details.valuation)},
    {id:'investment-analysis',label:'编辑判断',show:hasText(analysis)},
    {id:'investment-evidence',label:'来源与证据',show:true},
  ].filter(section=>section.show).map(({id,label})=>({id,label}));
}
export function InvestmentDetail({story}:{story:Story}){
  const details=story.details;
  if(!details || details.kind!=='investment')return null;
  const sections=investmentSections(details,story.analysis);
  const show=(id:string)=>sections.some(section=>section.id===id);
  return <article className="investment-detail">
    <header className="investment-header detail-page-header">
      <h1 className="detail-page-title">{lead(story).title}</h1>
      {lead(story).rest&&<p className="investment-summary"><InlineText text={lead(story).rest}/></p>}
      <p className="investment-verification">研究资料由 Codex 提供；来源链接和格式校验不等于独立事实核验。</p>
    </header>
    <MobileDetailNav sections={sections}/>
    <div className="investment-sections">
      {show("investment-background")&&<section id="investment-background"><h2>事件概览</h2><p><InlineText text={details.background}/></p></section>}
      {show("investment-metrics")&&<section id="investment-metrics"><h2>核心数据</h2><div className="investment-table-scroll"><table><thead><tr><th scope="col">指标</th><th scope="col">数值</th><th scope="col">期间与口径</th><th scope="col">性质与证据</th></tr></thead><tbody>{details.metrics?.map((metric,index)=><tr key={`${metric.name}-${index}`}><th scope="row">{metric.name}</th><td>{metric.value} {metric.unit}</td><td>{metric.period}{metric.comparison&&<span>{metric.comparison}</span>}</td><td><span className="investment-basis">{basisLabel[metric.basis]}</span><EvidenceLinks ids={metric.evidenceRefs} details={details}/></td></tr>)}</tbody></table></div></section>}
      {show("investment-chain")&&<section id="investment-chain"><h2>产业链影响</h2><ul className="investment-chain">{details.supplyChain?.map((item,index)=><li key={`${item.segment}-${index}`}><div><strong>{item.segment}</strong><span className={item.relationship==='confirmed'?'confirmed':'potential'}>{item.relationship==='confirmed'?'已确认关系':'潜在影响'}</span></div><p>{item.direction}：<InlineText text={item.reason}/></p><EvidenceLinks ids={item.evidenceRefs} details={details}/></li>)}</ul></section>}
      {show("investment-logic")&&<section id="investment-logic"><h2>投资逻辑</h2><p><InlineText text={details.investmentLogic??""}/></p></section>}
      {show("investment-watchpoints")&&<section id="investment-watchpoints"><h2>后续观察指标</h2><ul>{details.watchpoints?.filter(hasText).map((item,index)=><li key={index}><InlineText text={item}/></li>)}</ul></section>}
      {show("investment-risks")&&<section id="investment-risks"><h2>风险与反证</h2><ul>{details.risks?.filter(hasText).map((item,index)=><li key={index}><InlineText text={item}/></li>)}</ul></section>}
      {show("investment-valuation")&&<section id="investment-valuation"><h2>估值与市场预期</h2><p><InlineText text={details.valuation??""}/></p></section>}
      {show("investment-analysis")&&<section id="investment-analysis" className="investment-analysis"><h2>编辑判断</h2><p><InlineText text={story.analysis??""}/></p></section>}
      <section id="investment-evidence"><h2>来源与证据</h2><span id="investment-primary-source"/><h3>主要原始来源与原文短引</h3><Source story={story} expanded/>{!!details.evidence?.length&&<><h3>其他支持来源</h3><ol className="investment-evidence">{details.evidence.map(source=><li id={`investment-evidence-${source.id}`} key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.name} ↗</a><p>支持：{source.supports}</p></li>)}</ol></>}</section>
    </div>
  </article>;
}

export function InvestmentAside({details,analysis}:{details:InvestmentDetails;analysis?:string|null}){
  return <DetailAsideNav sections={investmentSections(details,analysis)} className="investment-aside"/>;
}
