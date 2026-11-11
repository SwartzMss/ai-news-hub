export type DetailSection = {id:string;label:string};
export function DetailLinks({sections}:{sections:DetailSection[]}){
  return <ol>{sections.map(section=><li key={section.id}><a data-detail-target={section.id} href={`#${section.id}`}>{section.label}</a></li>)}</ol>;
}
export function MobileDetailNav({sections}:{sections:DetailSection[]}){
  if(sections.length<2)return null;
  return <details className="detail-mobile-nav"><summary>本文目录</summary><nav aria-label="移动端本文目录"><DetailLinks sections={sections}/></nav></details>;
}
export function DetailAsideNav({sections,className}:{sections:DetailSection[];className:string}){
  if(sections.length<2)return null;
  return <aside className={className}><nav aria-label="本文目录"><h2>本文目录</h2><DetailLinks sections={sections}/></nav></aside>;
}
export const hasText=(value:string|null|undefined)=>!!value?.trim();
