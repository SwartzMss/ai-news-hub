import { AppError } from '../errors.js';
import { sourceUrl } from './sources.js';

export interface InvestmentDetails {
  kind: 'investment';
  background: string;
  metrics?: {name:string; value:string; unit:string; period:string; comparison?:string; basis:'actual'|'guidance'|'consensus'|'estimate'|'inference'; evidenceRefs:string[]}[];
  listedCompanies?: {name:string; ticker:string; market:'NASDAQ'|'NYSE'|'SSE'|'SZSE'|'HKEX'|'OTHER'; role:string; relationship:'confirmed'|'potential'; evidenceRefs:string[]}[];
  supplyChain?: {segment:string; direction:string; reason:string; relationship:'confirmed'|'potential'; evidenceRefs?:string[]}[];
  investmentLogic?: string;
  watchpoints?: string[];
  risks?: string[];
  valuation?: string;
  evidence?: {id:string; name:string; url:string; supports:string}[];
}

const text=(maxLength:number)=>({type:'string',minLength:1,maxLength});
const refs={type:'array',minItems:1,maxItems:3,uniqueItems:true,items:{type:'string',pattern:'^[a-z][a-z0-9-]{0,31}$'}};
export const INVESTMENT_DETAILS_SCHEMA={
  type:'object',additionalProperties:false,required:['kind','background'],properties:{
    kind:{const:'investment'},background:text(800),
    metrics:{type:'array',maxItems:6,items:{type:'object',additionalProperties:false,
      required:['name','value','unit','period','basis','evidenceRefs'],properties:{
        name:text(80),value:text(80),unit:text(40),period:text(80),comparison:text(160),
        basis:{enum:['actual','guidance','consensus','estimate','inference']},evidenceRefs:refs,
      }}},
    listedCompanies:{type:'array',maxItems:6,items:{type:'object',additionalProperties:false,
      required:['name','ticker','market','role','relationship','evidenceRefs'],properties:{
        name:text(100),ticker:text(20),market:{enum:['NASDAQ','NYSE','SSE','SZSE','HKEX','OTHER']},role:text(180),relationship:{enum:['confirmed','potential']},evidenceRefs:refs,
      }}},
    supplyChain:{type:'array',maxItems:5,items:{type:'object',additionalProperties:false,
      required:['segment','direction','reason','relationship'],properties:{
        segment:text(100),direction:text(100),reason:text(300),relationship:{enum:['confirmed','potential']},evidenceRefs:refs,
      }}},
    investmentLogic:text(800),watchpoints:{type:'array',maxItems:6,items:text(180)},
    risks:{type:'array',maxItems:6,items:text(180)},valuation:text(500),
    evidence:{type:'array',maxItems:10,items:{type:'object',additionalProperties:false,
      required:['id','name','url','supports'],properties:{
        id:{type:'string',pattern:'^[a-z][a-z0-9-]{0,31}$'},name:text(100),url:text(2048),supports:text(240),
      }}},
  },
};

export function validateInvestmentDetails(details:InvestmentDetails):void {
  if(Buffer.byteLength(JSON.stringify(details))>3000)throw new AppError('report_schema_invalid');
  const ids=new Set<string>();
  for(const source of details.evidence??[]){
    if(ids.has(source.id))throw new AppError('report_schema_invalid');
    ids.add(source.id);
    sourceUrl(source.url);
  }
  for(const metric of details.metrics??[])
    if(metric.evidenceRefs.some(id=>!ids.has(id)))throw new AppError('report_schema_invalid');
  for(const company of details.listedCompanies??[])
    if(company.evidenceRefs.some(id=>!ids.has(id)))throw new AppError('report_schema_invalid');
  for(const relation of details.supplyChain??[]){
    if(relation.relationship==='confirmed'&&!relation.evidenceRefs?.length)throw new AppError('report_schema_invalid');
    if(relation.evidenceRefs?.some(id=>!ids.has(id)))throw new AppError('report_schema_invalid');
  }
}
