import { AppError } from '../errors.js';
import { sourceUrl } from './sources.js';

export interface NewsDetails {
  kind:'news';
  background:string;
  keyFacts?:{name:string;value:string;unit?:string;period?:string;nature:'confirmed'|'statement'|'reported'|'estimate'|'inference';evidenceRefs:string[]}[];
  timeline?:{time:string;precision:'date'|'datetime'|'approximate';event:string;evidenceRefs:string[]}[];
  positions?:{actor:string;statement:string;form:'quote'|'paraphrase';evidenceRefs:string[]}[];
  impacts?:{description:string;status:'observed'|'analysis';evidenceRefs?:string[]}[];
  uncertainties?:string[];
  watchpoints?:string[];
  evidence?:{id:string;name:string;url:string;supports:string}[];
}

const text=(maxLength:number)=>({type:'string',minLength:1,maxLength});
const refs={type:'array',minItems:1,maxItems:3,uniqueItems:true,items:{type:'string',pattern:'^[a-z][a-z0-9-]{0,31}$'}};
export const NEWS_DETAILS_SCHEMA={
  type:'object',additionalProperties:false,required:['kind','background'],properties:{
    kind:{const:'news'},background:text(800),
    keyFacts:{type:'array',maxItems:6,items:{type:'object',additionalProperties:false,
      required:['name','value','nature','evidenceRefs'],properties:{
        name:text(100),value:text(200),unit:text(40),period:text(100),
        nature:{enum:['confirmed','statement','reported','estimate','inference']},evidenceRefs:refs,
      }}},
    timeline:{type:'array',maxItems:6,items:{type:'object',additionalProperties:false,
      required:['time','precision','event','evidenceRefs'],properties:{
        time:text(80),precision:{enum:['date','datetime','approximate']},event:text(260),evidenceRefs:refs,
      }}},
    positions:{type:'array',maxItems:5,items:{type:'object',additionalProperties:false,
      required:['actor','statement','form','evidenceRefs'],properties:{
        actor:text(100),statement:text(320),form:{enum:['quote','paraphrase']},evidenceRefs:refs,
      }}},
    impacts:{type:'array',maxItems:5,items:{type:'object',additionalProperties:false,
      required:['description','status'],properties:{description:text(320),status:{enum:['observed','analysis']},evidenceRefs:refs}}},
    uncertainties:{type:'array',maxItems:6,items:text(200)},
    watchpoints:{type:'array',maxItems:6,items:text(200)},
    evidence:{type:'array',maxItems:10,items:{type:'object',additionalProperties:false,
      required:['id','name','url','supports'],properties:{
        id:{type:'string',pattern:'^[a-z][a-z0-9-]{0,31}$'},name:text(100),url:text(2048),supports:text(240),
      }}},
  },
};

export function validateNewsDetails(details:NewsDetails):void {
  if(Buffer.byteLength(JSON.stringify(details))>2500)throw new AppError('report_schema_invalid');
  const ids=new Set<string>();
  for(const evidence of details.evidence??[]){
    if(ids.has(evidence.id))throw new AppError('report_schema_invalid');
    ids.add(evidence.id);
    sourceUrl(evidence.url);
  }
  const validRefs=(refs:string[]|undefined)=>!refs?.some(id=>!ids.has(id));
  for(const fact of details.keyFacts??[])if(!validRefs(fact.evidenceRefs))throw new AppError('report_schema_invalid');
  for(const item of details.timeline??[]){
    if(!validRefs(item.evidenceRefs))throw new AppError('report_schema_invalid');
    if(item.precision==='date'&&!/^\d{4}-\d{2}-\d{2}$/.test(item.time))throw new AppError('report_schema_invalid');
    if(item.precision==='datetime'&&!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(item.time))throw new AppError('report_schema_invalid');
  }
  for(const position of details.positions??[])if(!validRefs(position.evidenceRefs))throw new AppError('report_schema_invalid');
  for(const impact of details.impacts??[])
    if(impact.status==='observed'&&!impact.evidenceRefs?.length||!validRefs(impact.evidenceRefs))throw new AppError('report_schema_invalid');
}
