import type { ProjectDetails, Story } from './types';
import { InlineText } from './InlineText';
import { Source, lead } from './ReadingParts';
function EvidenceLinks({ids,details}:{ids?:string[];details:ProjectDetails}){
  if(!ids?.length)return null;
  return <span className="project-evidence-refs"> {ids.map(id=>{const source=details.evidence.find(item=>item.id===id);return source?<a key={id} href={`#project-evidence-${id}`}>[{source.name}]</a>:null;})}</span>;
}
export function StructuredProjectDetail({story,number}:{story:Story;number?:number}){
  const details=story.details;
  if(!details||details.kind!=='project')return null;
  return <article className="project-detail">
    <header className="project-header"><div className="project-heading">{number&&<span className="project-number">{String(number).padStart(2,'0')}.</span>}<h1>{lead(story).title}</h1></div></header>
    <div className="project-sections">
      <section id="project-overview"><h2>项目概览</h2><p><InlineText text={details.overview}/></p></section>
      {details.change&&<section id="project-change"><h2>本次更新</h2><p><InlineText text={details.change.summary}/><EvidenceLinks ids={details.change.evidenceRefs} details={details}/></p>{(details.change.version||details.change.publishedAt)&&<p>{details.change.version&&`版本：${details.change.version}`}{details.change.version&&details.change.publishedAt?' · ':''}{details.change.publishedAt&&`发布日期：${details.change.publishedAt}`}</p>}</section>}
      {!!details.technical?.length&&<section id="project-technical"><h2>技术与架构</h2><ul>{details.technical.map((entry,i)=><li key={i}><InlineText text={entry.description}/><EvidenceLinks ids={entry.evidenceRefs} details={details}/></li>)}</ul></section>}
      {!!details.useCases?.length&&<section id="project-use-cases"><h2>适用场景</h2><ul>{details.useCases.map((entry,i)=><li key={i}><InlineText text={entry.description}/><EvidenceLinks ids={entry.evidenceRefs} details={details}/></li>)}</ul></section>}
      {details.license&&<section id="project-license"><h2>许可证与授权范围</h2><p>代码：<InlineText text={details.license.code}/>{details.license.scope&&<>；其他范围：<InlineText text={details.license.scope}/></>}<EvidenceLinks ids={details.license.evidenceRefs} details={details}/></p></section>}
      {!!details.evaluation?.length&&<section id="project-evaluation"><h2>试用建议与限制</h2><ul>{details.evaluation.map((entry,i)=><li key={i}><strong>{entry.nature==='analysis'?'编辑判断':'来源事实'}：</strong><InlineText text={entry.description}/><EvidenceLinks ids={entry.evidenceRefs} details={details}/></li>)}</ul></section>}
      <section id="project-evidence"><h2>来源与证据</h2><ol>{details.evidence.map(source=><li id={`project-evidence-${source.id}`} key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.name} ↗</a>：{source.supports}</li>)}</ol></section>
      <div id="project-source"><Source story={story}/></div>
    </div>
  </article>;
}
export function StructuredProjectAside({details}:{details:ProjectDetails}){
  const sections=[['overview','项目概览',true],['change','本次更新',!!details.change],['technical','技术与架构',!!details.technical?.length],['use-cases','适用场景',!!details.useCases?.length],['license','许可证与授权范围',!!details.license],['evaluation','试用建议与限制',!!details.evaluation?.length],['evidence','来源与证据',true],['source','本次动态来源',true]] as const;
  return <aside className="project-aside"><nav aria-label="本文目录" className="project-toc"><h2>本文目录</h2><ol>{sections.filter(([, ,show])=>show).map(([id,label])=><li key={id}><a href={`#project-${id}`}>{label}</a></li>)}</ol></nav></aside>;
}
