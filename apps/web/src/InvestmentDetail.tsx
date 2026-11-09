import type { InvestmentDetails, Story } from './types';
import { InlineText } from './InlineText';
import { Source, lead } from './ReadingParts';

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

export function InvestmentDetail({story}:{story:Story}){
  const details=story.details;
  if(!details || details.kind!=='investment')return null;
  return <article className="investment-detail">
    <header className="investment-header">
      <p className="investment-topic">科技投资研究</p>
      <h1>{lead(story).title}</h1>
      {lead(story).rest&&<p className="investment-summary"><InlineText text={lead(story).rest}/></p>}
      <p className="investment-verification">研究资料由 Codex 提供；来源链接和格式校验不等于独立事实核验。</p>
    </header>
    <div className="investment-sections">
      <section id="investment-background"><h2>事件背景</h2><p><InlineText text={details.background}/></p></section>
      {!!details.metrics?.length&&<section id="investment-metrics"><h2>核心数据</h2><div className="investment-table-scroll"><table><thead><tr><th scope="col">指标</th><th scope="col">数值</th><th scope="col">期间与口径</th><th scope="col">性质与证据</th></tr></thead><tbody>{details.metrics.map((metric,index)=><tr key={`${metric.name}-${index}`}><th scope="row">{metric.name}</th><td>{metric.value} {metric.unit}</td><td>{metric.period}{metric.comparison&&<span>{metric.comparison}</span>}</td><td><span className="investment-basis">{basisLabel[metric.basis]}</span><EvidenceLinks ids={metric.evidenceRefs} details={details}/></td></tr>)}</tbody></table></div></section>}
      {!!details.supplyChain?.length&&<section id="investment-chain"><h2>产业链影响</h2><ul className="investment-chain">{details.supplyChain.map((item,index)=><li key={`${item.segment}-${index}`}><div><strong>{item.segment}</strong><span className={item.relationship==='confirmed'?'confirmed':'potential'}>{item.relationship==='confirmed'?'已确认关系':'潜在影响'}</span></div><p>{item.direction}：<InlineText text={item.reason}/></p><EvidenceLinks ids={item.evidenceRefs} details={details}/></li>)}</ul></section>}
      {details.investmentLogic&&<section id="investment-logic"><h2>投资逻辑</h2><p><InlineText text={details.investmentLogic}/></p></section>}
      {!!details.watchpoints?.length&&<section id="investment-watchpoints"><h2>后续观察指标</h2><ul>{details.watchpoints.map((item,index)=><li key={index}><InlineText text={item}/></li>)}</ul></section>}
      {!!details.risks?.length&&<section id="investment-risks"><h2>风险与反证</h2><ul>{details.risks.map((item,index)=><li key={index}><InlineText text={item}/></li>)}</ul></section>}
      {details.valuation&&<section id="investment-valuation"><h2>估值与市场预期</h2><p><InlineText text={details.valuation}/></p></section>}
      {story.analysis&&<section id="investment-analysis" className="investment-analysis"><h2>编辑判断</h2><p><InlineText text={story.analysis}/></p></section>}
      {!!details.evidence?.length&&<section id="investment-evidence"><h2>补充证据</h2><ol className="investment-evidence">{details.evidence.map(source=><li id={`investment-evidence-${source.id}`} key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.name} ↗</a><p>支持：{source.supports}</p></li>)}</ol></section>}
      <section id="investment-primary-source"><h2>本次动态来源</h2><Source story={story}/></section>
    </div>
  </article>;
}

export function InvestmentAside({details}:{details:InvestmentDetails}){
  const sections=[
    ['background','事件背景',true],['metrics','核心数据',!!details.metrics?.length],['chain','产业链影响',!!details.supplyChain?.length],
    ['logic','投资逻辑',!!details.investmentLogic],['watchpoints','后续观察指标',!!details.watchpoints?.length],
    ['risks','风险与反证',!!details.risks?.length],['valuation','估值与市场预期',!!details.valuation],
    ['evidence','补充证据',!!details.evidence?.length],['primary-source','本次动态来源',true],
  ] as const;
  return <aside className="investment-aside"><nav aria-label="本文目录"><h2>本文目录</h2><ol>{sections.filter(([, ,show])=>show).map(([id,label])=><li key={id}><a href={`#investment-${id}`}>{label}</a></li>)}</ol></nav></aside>;
}
