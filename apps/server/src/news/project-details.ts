import { AppError } from '../errors.js';
import { sourceUrl } from './sources.js';
export interface ProjectDetails {
  kind:'project'; overview:string;
  change?:{summary:string;version?:string;type?:'release'|'feature'|'technical'|'community';publishedAt?:string;evidenceRefs:string[]};
  technical?:{description:string;evidenceRefs:string[]}[];
  useCases?:{description:string;evidenceRefs:string[]}[];
  license?:{code:string;scope?:string;evidenceRefs:string[]};
  evaluation?:{description:string;nature:'fact'|'analysis';evidenceRefs?:string[]}[];
  evidence:{id:string;name:string;url:string;supports:string}[];
}
const text=(maxLength:number)=>({type:'string',minLength:1,maxLength});
const refs={type:'array',minItems:1,maxItems:3,uniqueItems:true,items:{type:'string',pattern:'^[a-z][a-z0-9-]{0,31}$'}};
const point={type:'object',additionalProperties:false,required:['description','evidenceRefs'],properties:{description:text(320),evidenceRefs:refs}};
export const PROJECT_DETAILS_SCHEMA={type:'object',additionalProperties:false,required:['kind','overview','evidence'],properties:{
  kind:{const:'project'},overview:text(600),
  change:{type:'object',additionalProperties:false,required:['summary','evidenceRefs'],properties:{summary:text(400),version:text(80),type:{enum:['release','feature','technical','community']},publishedAt:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},evidenceRefs:refs}},
  technical:{type:'array',maxItems:5,items:point},useCases:{type:'array',maxItems:4,items:point},
  license:{type:'object',additionalProperties:false,required:['code','evidenceRefs'],properties:{code:text(160),scope:text(240),evidenceRefs:refs}},
  evaluation:{type:'array',maxItems:5,items:{type:'object',additionalProperties:false,required:['description','nature'],properties:{description:text(280),nature:{enum:['fact','analysis']},evidenceRefs:refs}}},
  evidence:{type:'array',minItems:1,maxItems:10,items:{type:'object',additionalProperties:false,required:['id','name','url','supports'],properties:{id:{type:'string',pattern:'^[a-z][a-z0-9-]{0,31}$'},name:text(100),url:text(2048),supports:text(240)}}},
}};
export function validateProjectDetails(details:ProjectDetails):void {
  if(Buffer.byteLength(JSON.stringify(details))>2500)throw new AppError('report_schema_invalid');
  const ids=new Set<string>();
  for(const source of details.evidence){if(ids.has(source.id))throw new AppError('report_schema_invalid');ids.add(source.id);sourceUrl(source.url);}
  for(const entry of [details.change,...(details.technical??[]),...(details.useCases??[]),details.license,...(details.evaluation??[])]){
    if(!entry)continue;
    if('nature' in entry&&entry.nature==='fact'&&!entry.evidenceRefs?.length)throw new AppError('report_schema_invalid');
    if(entry.evidenceRefs?.some(id=>!ids.has(id)))throw new AppError('report_schema_invalid');
  }
}
