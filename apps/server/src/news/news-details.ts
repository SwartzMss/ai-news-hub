import { AppError } from '../errors.js';
import { sourceUrl } from './sources.js';

export const SOCIAL_PLATFORMS = ['weibo','douyin','bilibili','xiaohongshu','zhihu','x','reddit','other'] as const;
export type SocialPlatform = typeof SOCIAL_PLATFORMS[number];
export const HEADLINE_CATEGORIES = [
  'social_event','entertainment','tech_digital','sports','film_animation',
  'gaming','finance_consumption','internet_culture','lifestyle_emotion','international_topic','other',
] as const;
export const TREND_TAGS = ['cross_platform','single_platform','controversial','viral_video','sustained_discussion'] as const;
export const CONTENT_TAGS = ['short_video','debate','story_reversal','explainer','emotional_resonance','entertainment','not_suitable'] as const;

export interface NewsDetails {
  kind:'news';
  background:string;
  keyFacts?:{name:string;value:string;unit?:string;period?:string;nature:'confirmed'|'statement'|'reported'|'estimate'|'inference';evidenceRefs:string[]}[];
  timeline?:{time:string;precision:'date'|'datetime'|'approximate';event:string;evidenceRefs:string[]}[];
  positions?:{actor:string;statement:string;form:'quote'|'paraphrase';evidenceRefs:string[]}[];
  impacts?:{description:string;status:'observed'|'analysis';evidenceRefs?:string[]}[];
  uncertainties?:string[];
  watchpoints?:string[];
  trendTags?:typeof TREND_TAGS[number][];
  contentTags?:typeof CONTENT_TAGS[number][];
  trendSignals?:{platform:SocialPlatform;contentType:'hashtag'|'post'|'video'|'thread'|'topic_page'|'other';metric:'rank'|'views'|'likes'|'comments'|'shares'|'posts'|'discussion'|'other';value:string;observedAt:string;evidenceType:'direct'|'reported';evidenceRefs:string[]}[];
  publicDiscussion?:{
    summary:string;
    evidenceRefs:string[];
    viewpoints?:{label:string;summary:string;sentiment:'supportive'|'critical'|'concerned'|'mixed'|'humorous'|'neutral';evidenceRefs:string[]}[];
    controversies?:{topic:string;sides:string[];evidenceRefs:string[]}[];
    representativeComments?:{platform:SocialPlatform;quote:string;evidenceRefs:string[]}[];
  };
  contentSuitability?:'recommended'|'not_recommended';
  contentReason?:string;
  contentAngles?:{angle:string;suggestedTitle:string;hook:string;corePoints:string[];evidenceRefs:string[]}[];
  evidence?:{id:string;name:string;url:string;supports:string}[];
}

const text=(maxLength:number)=>({type:'string',minLength:1,maxLength});
const refs={type:'array',minItems:1,maxItems:3,uniqueItems:true,items:{type:'string',pattern:'^[a-z][a-z0-9-]{0,31}$'}};
const stringList=(maxItems:number,maxLength:number,minItems=0)=>({type:'array',minItems,maxItems,items:text(maxLength)});
const uniqueEnumList=(values:readonly string[],maxItems:number,minItems=0)=>({type:'array',minItems,maxItems,uniqueItems:true,items:{type:'string',enum:[...values]}});
const trendSignalSchema={type:'object',additionalProperties:false,required:['platform','contentType','metric','value','observedAt','evidenceType','evidenceRefs'],properties:{
  platform:{type:'string',enum:[...SOCIAL_PLATFORMS]},
  contentType:{type:'string',enum:['hashtag','post','video','thread','topic_page','other']},
  metric:{type:'string',enum:['rank','views','likes','comments','shares','posts','discussion','other']},
  value:text(100),observedAt:{type:'string',minLength:20,maxLength:40,pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2})?(?:Z|[+-]\\d{2}:\\d{2})$'},
  evidenceType:{type:'string',enum:['direct','reported']},evidenceRefs:refs,
}};
const publicDiscussionSchema={type:'object',additionalProperties:false,required:['summary','evidenceRefs'],properties:{
  summary:text(500),evidenceRefs:refs,
  viewpoints:{type:'array',maxItems:4,items:{type:'object',additionalProperties:false,required:['label','summary','sentiment','evidenceRefs'],properties:{
    label:text(80),summary:text(240),sentiment:{type:'string',enum:['supportive','critical','concerned','mixed','humorous','neutral']},evidenceRefs:refs,
  }}},
  controversies:{type:'array',maxItems:4,items:{type:'object',additionalProperties:false,required:['topic','sides','evidenceRefs'],properties:{
    topic:text(120),sides:stringList(3,180,2),evidenceRefs:refs,
  }}},
  representativeComments:{type:'array',maxItems:3,items:{type:'object',additionalProperties:false,required:['platform','quote','evidenceRefs'],properties:{
    platform:{type:'string',enum:[...SOCIAL_PLATFORMS]},quote:text(240),evidenceRefs:refs,
  }}},
}};
const contentAngleSchema={type:'object',additionalProperties:false,required:['angle','suggestedTitle','hook','corePoints','evidenceRefs'],properties:{
  angle:text(180),suggestedTitle:text(100),hook:text(180),corePoints:stringList(3,180,1),evidenceRefs:refs,
}};

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
export const LEGACY_NEWS_DETAILS_SCHEMA={
  type:'object',additionalProperties:false,required:['kind','background'],properties:legacyNewsProperties,
};
export const NEWS_DETAILS_SCHEMA={
  ...LEGACY_NEWS_DETAILS_SCHEMA,
  properties:{
    ...legacyNewsProperties,
    trendTags:uniqueEnumList(TREND_TAGS,5),
    contentTags:uniqueEnumList(CONTENT_TAGS,7),
    trendSignals:{type:'array',maxItems:8,items:trendSignalSchema},
    publicDiscussion:publicDiscussionSchema,
    contentSuitability:{type:'string',enum:['recommended','not_recommended']},
    contentReason:text(320),
    contentAngles:{type:'array',maxItems:3,items:contentAngleSchema},
  },
};

export const HEADLINES_DETAILS_SCHEMA={
  ...NEWS_DETAILS_SCHEMA,
  required:[...NEWS_DETAILS_SCHEMA.required,'trendTags','contentTags','trendSignals','contentSuitability','contentReason','contentAngles'],
  properties:{
    ...NEWS_DETAILS_SCHEMA.properties,
    trendTags:uniqueEnumList(TREND_TAGS,5),
    contentTags:uniqueEnumList(CONTENT_TAGS,7),
    trendSignals:{type:'array',minItems:1,maxItems:8,items:trendSignalSchema},
    contentSuitability:{type:'string',enum:['recommended','not_recommended']},
    contentReason:text(320),
    contentAngles:{type:'array',maxItems:3,items:contentAngleSchema},
  },
};

export function validateNewsDetails(details:NewsDetails):void {
  const extended=!!(details.trendSignals||details.trendTags||details.contentTags||details.publicDiscussion||details.contentSuitability||details.contentAngles);
  if(Buffer.byteLength(JSON.stringify(details))>(extended?6000:2500))throw new AppError('report_schema_invalid');
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
  for(const signal of details.trendSignals??[]){
    if(!validRefs(signal.evidenceRefs)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(signal.observedAt)||!Number.isFinite(Date.parse(signal.observedAt)))throw new AppError('report_schema_invalid');
  }
  if(details.publicDiscussion){
    if(!validRefs(details.publicDiscussion.evidenceRefs))throw new AppError('report_schema_invalid');
    for(const item of [...(details.publicDiscussion.viewpoints??[]),...(details.publicDiscussion.controversies??[]),...(details.publicDiscussion.representativeComments??[])])
      if(!validRefs(item.evidenceRefs))throw new AppError('report_schema_invalid');
  }
  for(const angle of details.contentAngles??[])if(!validRefs(angle.evidenceRefs))throw new AppError('report_schema_invalid');

  const platforms=new Set((details.trendSignals??[]).map(signal=>signal.platform));
  const trendTags=new Set(details.trendTags??[]);
  if(details.trendSignals?.length&&platforms.size>=2&&!trendTags.has('cross_platform'))throw new AppError('report_schema_invalid');
  if(details.trendSignals?.length&&platforms.size===1&&!trendTags.has('single_platform'))throw new AppError('report_schema_invalid');
  if(trendTags.has('cross_platform')&&platforms.size<2)throw new AppError('report_schema_invalid');
  if(trendTags.has('single_platform')&&platforms.size!==1)throw new AppError('report_schema_invalid');
  if(trendTags.has('cross_platform')&&trendTags.has('single_platform'))throw new AppError('report_schema_invalid');
  if(trendTags.has('controversial')&&!details.publicDiscussion?.controversies?.length)throw new AppError('report_schema_invalid');
  if(trendTags.has('viral_video')&&!details.trendSignals?.some(signal=>signal.contentType==='video'))throw new AppError('report_schema_invalid');
  if(trendTags.has('sustained_discussion')){
    const repeated=new Set((details.trendSignals??[]).filter((signal,index,all)=>all.some((other,otherIndex)=>otherIndex!==index&&other.platform===signal.platform&&other.observedAt!==signal.observedAt)).map(signal=>signal.platform));
    if(!repeated.size)throw new AppError('report_schema_invalid');
  }
  if(details.contentSuitability==='recommended'&&(!details.contentAngles?.length||!details.contentTags?.length||details.contentTags.includes('not_suitable')))throw new AppError('report_schema_invalid');
  if(details.contentSuitability==='not_recommended'&&(!!details.contentAngles?.length||!details.contentTags?.includes('not_suitable')))throw new AppError('report_schema_invalid');
}
