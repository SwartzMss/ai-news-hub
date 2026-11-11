import type { ProjectDetails, Story } from './types';
import { InlineText } from './InlineText';
import { Source, lead } from './ReadingParts';
import { DetailAsideNav, MobileDetailNav, hasText, type DetailSection } from './DetailNavigation';
function EvidenceLinks({ids,details}:{ids?:string[];details:ProjectDetails}){
  if(!ids?.length)return null;
  return <span className="project-evidence-refs"> {ids.map(id=>{const source=details.evidence.find(item=>item.id===id);return source?<a key={id} href={`#project-evidence-${id}`}>[{source.name}]</a>:null;})}</span>;
}
export function structuredProjectSections(details:ProjectDetails):DetailSection[]{
  return [
    {id:'project-overview',label:'项目概览',show:hasText(details.overview)},
    {id:'project-change',label:'本次更新',show:hasText(details.change?.summary)},
    {id:'project-technical',label:'技术与架构',show:!!details.technical?.some(item=>hasText(item.description))},
    {id:'project-use-cases',label:'适用场景',show:!!details.useCases?.some(item=>hasText(item.description))},
    {id:'project-license',label:'许可证与授权范围',show:hasText(details.license?.code)},
    {id:'project-evaluation',label:'试用建议与限制',show:!!details.evaluation?.some(item=>hasText(item.description))},
    {id:'project-evidence',label:'来源与证据',show:true},
  ].filter(section=>section.show).map(({id,label})=>({id,label}));
}
export function StructuredProjectDetail({story,number}:{story:Story;number?:number}){
  const details=story.details;
  if(!details||details.kind!=='project')return null;
  const sections=structuredProjectSections(details);
  const show=(id:string)=>sections.some(section=>section.id===id);
  return <article className="project-detail">
    <header className="project-header"><div className="project-heading">{number&&<span className="project-number">{String(number).padStart(2,'0')}.</span>}<h1>{lead(story).title}</h1></div></header>
    <MobileDetailNav sections={sections}/>
    <div className="project-sections">
      {show("project-overview")&&<section id="project-overview"><h2>项目概览</h2><p><InlineText text={details.overview}/></p></section>}
      {show("project-change")&&<section id="project-change"><h2>本次更新</h2><p><InlineText text={details.change?.summary??""}/><EvidenceLinks ids={details.change?.evidenceRefs} details={details}/></p>{(details.change?.version||details.change?.publishedAt)&&<p>{details.change?.version&&`版本：${details.change?.version}`}{details.change?.version&&details.change?.publishedAt?' · ':''}{details.change?.publishedAt&&`发布日期：${details.change?.publishedAt}`}</p>}</section>}
      {show("project-technical")&&<section id="project-technical"><h2>技术与架构</h2><ul>{details.technical?.filter(entry=>hasText(entry.description)).map((entry,i)=><li key={i}><InlineText text={entry.description}/><EvidenceLinks ids={entry.evidenceRefs} details={details}/></li>)}</ul></section>}
      {show("project-use-cases")&&<section id="project-use-cases"><h2>适用场景</h2><ul>{details.useCases?.filter(entry=>hasText(entry.description)).map((entry,i)=><li key={i}><InlineText text={entry.description}/><EvidenceLinks ids={entry.evidenceRefs} details={details}/></li>)}</ul></section>}
      {show("project-license")&&<section id="project-license"><h2>许可证与授权范围</h2><p>代码：<InlineText text={details.license?.code??""}/>{details.license?.scope&&<>；其他范围：<InlineText text={details.license?.scope}/></>}<EvidenceLinks ids={details.license?.evidenceRefs} details={details}/></p></section>}
      {show("project-evaluation")&&<section id="project-evaluation"><h2>试用建议与限制</h2><ul>{details.evaluation?.filter(entry=>hasText(entry.description)).map((entry,i)=><li key={i}><strong>{entry.nature==='analysis'?'编辑判断':'来源事实'}：</strong><InlineText text={entry.description}/><EvidenceLinks ids={entry.evidenceRefs} details={details}/></li>)}</ul></section>}
      <section id="project-evidence"><h2>来源与证据</h2><span id="project-source"/><h3>主要原始来源与原文短引</h3><Source story={story} expanded/><h3>其他支持来源</h3><ol>{details.evidence.map(source=><li id={`project-evidence-${source.id}`} key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.name} ↗</a>：{source.supports}</li>)}</ol></section>

    </div>
  </article>;
}
export function StructuredProjectAside({details}:{details:ProjectDetails}){
  return <DetailAsideNav sections={structuredProjectSections(details)} className="project-aside"/>;
}
