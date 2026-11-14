import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Ajv} from 'ajv';
import addFormats from 'ajv-formats';
import {ARCHIVE_SCHEMA} from '../dist/apps/server/src/publish/archive-schema.js';
import {archiveArtifact,reviewedReport} from '../dist/apps/server/src/publish/artifact.js';
import {publicationFixture} from './fixtures/publication.mjs';

const validator=new Ajv({strict:true});
addFormats(validator);
const validate=validator.compile(ARCHIVE_SCHEMA);
const approvedAt='2026-11-03T01:00:00Z';

test('one v1 schema is the public contract for every topic and matches its documentation',()=>{
 assert.deepEqual(JSON.parse(readFileSync(new URL('../docs/schema/report-archive-v1.schema.json',import.meta.url),'utf8')),ARCHIVE_SCHEMA);
 const f=publicationFixture();
 try{
  const report=reviewedReport(f.db,'r');
  const artifact=archiveArtifact(report,approvedAt);
  const document=JSON.parse(artifact.content);
  assert.equal(document.schema_version,1);
  assert.equal(document.topic.id,report.document.topic.id);
  assert.equal(validate(document),true);
  assert.equal(artifact.path,`reports/topics/${document.topic.id}/2026/11/03/v000001.json`);
  assert.equal(validate({...document,run_id:'private'}),false);
  assert.equal(validate({...document,review_status:'pending'}),false);
  assert.equal(validate({...document,topic:undefined}),false);
  assert.equal(validate({...document,items:[{...document.items[0],details:undefined}]}),false);
  assert.equal(validate({...document,items:[{...document.items[0],research_area:'gpu'}]}),false);
 }finally{f.close();}
});

test('open-source, technology and headlines details share v1 without weakening their detail contracts',()=>{
 const f=publicationFixture();
 try{
  const base=reviewedReport(f.db,'r');
  const project=archiveArtifact({...base,templateId:'daily-opensource'},approvedAt);
  assert.equal(JSON.parse(project.content).schema_version,1);
  assert.equal(JSON.parse(project.content).items[0].details.kind,'project');

  const investmentReport={...base,templateId:'daily-technology',document:{
   ...base.document,
   items:base.document.items.map(item=>({
    ...item,researchArea:undefined,category:'optical_communications',
    details:{kind:'investment',background:'光模块厂商披露 1.6T 产品进入客户验证阶段。',
     metrics:[{name:'产品进度',value:'客户验证',unit:'阶段',period:'2026 Q4',basis:'actual',evidenceRefs:['filing']}],
     evidence:[{id:'filing',name:'公司公告',url:'https://example.com/filing',supports:'1.6T 产品验证进展'}]},
   })),
  }};
  const investment=JSON.parse(archiveArtifact(investmentReport,approvedAt).content);
  assert.equal(investment.schema_version,1);
  assert.equal(investment.items[0].details.kind,'investment');
  assert.equal(validate(investment),true);

  const headlinesReport={...base,templateId:'daily-headlines',document:{
   ...base.document,
   items:base.document.items.map(item=>({
    ...item,researchArea:undefined,category:'social_event',
    details:{kind:'news',background:'主管部门公布了新的鉴定结果。',
     keyFacts:[{name:'鉴定结果',value:'已公布',nature:'confirmed',evidenceRefs:['notice']}],
     evidence:[{id:'notice',name:'正式通报',url:'https://example.com/notice',supports:'鉴定结果及公布时间'}]},
   })),
  }};
  const headlines=JSON.parse(archiveArtifact(headlinesReport,approvedAt).content);
  assert.equal(headlines.schema_version,1);
  assert.equal(headlines.items[0].details.kind,'news');
  assert.equal(validate(headlines),true);
  for(const [field,value] of [
   ['trendTags',['single_platform']],
   ['discussionTags',['debate']],
   ['trendSignals',[]],
   ['publicDiscussion',{summary:'平台讨论摘要',evidenceRefs:['notice']}],
  ]){
   const invalid=JSON.parse(JSON.stringify(headlines));
   invalid.items[0].details[field]=value;
   assert.equal(validate(invalid),false,field);
  }
  const missingEvidence=JSON.parse(JSON.stringify(headlines));
  delete missingEvidence.items[0].details.evidence;
  assert.equal(validate(missingEvidence),false);
 }finally{f.close();}
});

test('archive publication rejects missing topic/details and template/detail mismatches',()=>{
 const f=publicationFixture();
 try{
  const base=reviewedReport(f.db,'r');
  assert.throws(()=>archiveArtifact({...base,document:{...base.document,topic:undefined}},approvedAt),/archive_schema_invalid/);
  assert.throws(()=>archiveArtifact({...base,document:{...base.document,items:base.document.items.map(({details,...item})=>item)}},approvedAt),/archive_schema_invalid/);
  assert.throws(()=>archiveArtifact({...base,templateId:'daily-headlines'},approvedAt),/archive_schema_invalid/);
  assert.throws(()=>archiveArtifact({...base,templateId:'daily-technology'},approvedAt),/archive_schema_invalid/);
 }finally{f.close();}
});
