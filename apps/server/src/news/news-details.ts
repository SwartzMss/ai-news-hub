import { ReportSchemaError } from '../errors.js';
import { sourceUrl } from './sources.js';

export const HEADLINE_CATEGORIES = [
  'social_event','entertainment','tech_digital','sports','film_animation',
  'gaming','finance_consumption','internet_culture','lifestyle_emotion','international_topic','other',
] as const;

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
const legacyNewsProperties={
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
};
export const NEWS_DETAILS_SCHEMA={
  type:'object',additionalProperties:false,required:['kind','background'],properties:legacyNewsProperties,
};

// The public headlines contract requires reader-facing evidence and excludes
// platform discovery / discussion metadata entirely.
export const HEADLINES_DETAILS_SCHEMA={
  ...NEWS_DETAILS_SCHEMA,
  required:['kind','background','evidence'],
  properties:{
    ...legacyNewsProperties,
    evidence:{...legacyNewsProperties.evidence,minItems:1},
  },
};

export function validateNewsDetails(details:NewsDetails,path='details'):void {
  const fail=(field:string,reason:string):never=>{throw new ReportSchemaError(`${path}${field}`,reason);};
  if(Buffer.byteLength(JSON.stringify(details))>6000)fail('','超过 6000 字节');
  const ids=new Set<string>();
  for(const [index,evidence] of (details.evidence??[]).entries()){
    if(ids.has(evidence.id))fail(`.evidence[${index}].id`,'来源 ID 重复');
    ids.add(evidence.id);
    sourceUrl(evidence.url);
  }
  const validRefs=(refs:string[]|undefined)=>!refs?.some(id=>!ids.has(id));
  for(const [index,fact] of (details.keyFacts??[]).entries())if(!validRefs(fact.evidenceRefs))fail(`.keyFacts[${index}].evidenceRefs`,'引用了不存在的来源 ID');
  for(const [index,item] of (details.timeline??[]).entries()){
    if(!validRefs(item.evidenceRefs))fail(`.timeline[${index}].evidenceRefs`,'引用了不存在的来源 ID');
    if(item.precision==='date'&&!/^\d{4}-\d{2}-\d{2}$/.test(item.time))fail(`.timeline[${index}].time`,'date 需要 YYYY-MM-DD');
    if(item.precision==='datetime'&&!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(item.time))fail(`.timeline[${index}].time`,'datetime 需要带明确时区的 ISO 时间');
  }
  for(const [index,position] of (details.positions??[]).entries())if(!validRefs(position.evidenceRefs))fail(`.positions[${index}].evidenceRefs`,'引用了不存在的来源 ID');
  for(const [index,impact] of (details.impacts??[]).entries())
    if(impact.status==='observed'&&!impact.evidenceRefs?.length||!validRefs(impact.evidenceRefs))fail(`.impacts[${index}].evidenceRefs`,'已观察影响需要有效来源 ID');
}
