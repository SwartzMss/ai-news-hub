import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Ajv} from 'ajv';
import addFormats from 'ajv-formats';
import {ARCHIVE_SCHEMA,ARCHIVE_V2_SCHEMA,ARCHIVE_V3_SCHEMA,ARCHIVE_V4_SCHEMA,ARCHIVE_V5_SCHEMA} from '../dist/apps/server/src/publish/archive-schema.js';
import {archiveArtifact,reviewedReport} from '../dist/apps/server/src/publish/artifact.js';
import {publicationFixture} from './fixtures/publication.mjs';
test('published contract matches documented schema and excludes internal metadata',()=>{
 assert.deepEqual(JSON.parse(readFileSync(new URL('../docs/schema/report-archive-v1.schema.json',import.meta.url),'utf8')),ARCHIVE_SCHEMA);
 const validator=new Ajv({strict:true});addFormats(validator);const validate=validator.compile(ARCHIVE_SCHEMA);
 const s=publicationFixture();try{const artifact=archiveArtifact(reviewedReport(s.db,'r'),'2026-11-03T01:00:00Z');const doc=JSON.parse(artifact.content);assert.equal(validate(doc),true);assert.equal(validate({...doc,run_id:'private'}),false);assert.equal(validate({...doc,review_status:'pending'}),false);}finally{s.close();}
});

test('v2 contract adds only required topic identity and uses its own archive path',()=>{
 assert.deepEqual(JSON.parse(readFileSync(new URL('../docs/schema/report-archive-v2.schema.json',import.meta.url),'utf8')),ARCHIVE_V2_SCHEMA);
 const clone=structuredClone(ARCHIVE_V2_SCHEMA);clone.properties.schema_version={const:1};delete clone.properties.topic;clone.required=clone.required.filter(key=>key!=='topic');assert.deepEqual(clone,ARCHIVE_SCHEMA);
 const validator=new Ajv({strict:true});addFormats(validator);const validate=validator.compile(ARCHIVE_V2_SCHEMA),validateLegacy=validator.compile(ARCHIVE_SCHEMA);
 const s=publicationFixture();try{
  const report=reviewedReport(s.db,'r');report.document.topic={id:'t-'+'a'.repeat(24),name:'AI'};
  const artifact=archiveArtifact(report,'2026-11-03T01:00:00Z'),document=JSON.parse(artifact.content);
  assert.equal(artifact.path,'reports/topics/t-aaaaaaaaaaaaaaaaaaaaaaaa/2026/11/03/v000001.json');assert.equal(validate(document),true);assert.equal(validateLegacy(document),false);
  for(const topic of [undefined,{},null,{id:'../../private',name:'AI'},{id:'t-'+'a'.repeat(23),name:'AI'},{id:'t-'+'a'.repeat(24),name:''},{id:'t-'+'a'.repeat(24),name:'a'.repeat(201)},{id:'t-'+'a'.repeat(24),name:'AI',run_id:'private'}])assert.equal(validate({...document,topic}),false);
  report.document.topic.id='../../private';assert.throws(()=>archiveArtifact(report,'2026-11-03T01:00:00Z'),/archive_schema_invalid/);
 }finally{s.close();}
});


test('v3 topic archive adds required research area without changing v1/v2 contracts',()=>{
 assert.deepEqual(JSON.parse(readFileSync(new URL('../docs/schema/report-archive-v3.schema.json',import.meta.url),'utf8')),ARCHIVE_V3_SCHEMA);
 const validator=new Ajv({strict:true});addFormats(validator);const validate=validator.compile(ARCHIVE_V3_SCHEMA);
 const f=publicationFixture();
 try{
  const base=reviewedReport(f.db,'r');
  const report={...base,document:{...base.document,topic:{id:'t-'+'c'.repeat(24),name:'每日开源项目'},items:base.document.items.map(item=>({...item,researchArea:'rust'}))}};
  const artifact=archiveArtifact(report,'2026-11-03T01:00:00Z');
  const document=JSON.parse(artifact.content);
  assert.equal(document.schema_version,3);
  assert.equal(document.items[0].research_area,'rust');
  assert.equal(validate(document),true);
  assert.equal(validate({...document,items:[{...document.items[0],research_area:'gpu'}]}),false);
  assert.equal(artifact.path,'reports/topics/t-cccccccccccccccccccccccc/2026/11/03/v000001.json');
 }finally{f.close();}
});

test('v4 topic archive adds structured social trend details without changing v1-v3 contracts',()=>{
 assert.deepEqual(JSON.parse(readFileSync(new URL('../docs/schema/report-archive-v4.schema.json',import.meta.url),'utf8')),ARCHIVE_V4_SCHEMA);
 const validator=new Ajv({strict:true});addFormats(validator);const validate=validator.compile(ARCHIVE_V4_SCHEMA);
 const f=publicationFixture();
 try{
  f.db.prepare("UPDATE task_runs SET configuration_json=? WHERE id='run'").run(JSON.stringify({templateId:'daily-headlines'}));
  const report=reviewedReport(f.db,'r');
  assert.equal(report.templateId,'daily-headlines');
  report.document.topic={id:'t-'+'d'.repeat(24),name:'每日热点观察'};
  report.document.items=report.document.items.map(item=>({...item,category:'social_event',details:{
   kind:'news',
   background:'话题在最近 24 小时于微博出现传播。',
   trendTags:['single_platform'],
   contentTags:['short_video'],
   trendSignals:[{platform:'weibo',contentType:'hashtag',metric:'rank',value:'热榜第 2 位',observedAt:'2026-11-13T06:00:00+08:00',evidenceType:'direct',evidenceRefs:['trend']}],
   contentSuitability:'recommended',
   contentReason:'话题有明确事实和解释空间。',
   contentAngles:[{angle:'解释讨论焦点',suggestedTitle:'大家为什么关注？',hook:'讨论焦点是什么？',corePoints:['还原已确认事实'],evidenceRefs:['source']}],
   evidence:[
    {id:'trend',name:'微博话题页',url:'https://example.com/weibo',supports:'微博热榜排名'},
    {id:'source',name:'事件来源',url:'https://example.com/source',supports:'话题背景'},
   ],
  }}));
  const artifact=archiveArtifact(report,'2026-11-13T08:00:00Z');
  const document=JSON.parse(artifact.content);
  assert.equal(document.schema_version,4);
  assert.equal(validate(document),true);
  assert.throws(()=>archiveArtifact({...report,templateId:undefined},'2026-11-13T08:00:00Z'),/archive_schema_invalid/);
  assert.equal(artifact.path,'reports/topics/t-'+'d'.repeat(24)+'/2026/11/03/v000001.json');
  assert.equal(validate({...document,schema_version:3}),false);
 }finally{f.close();}
});


test('v5 topic archive is reserved for focused technology investment reports',()=>{
 assert.deepEqual(JSON.parse(readFileSync(new URL('../docs/schema/report-archive-v5.schema.json',import.meta.url),'utf8')),ARCHIVE_V5_SCHEMA);
 const validator=new Ajv({strict:true});addFormats(validator);const validate=validator.compile(ARCHIVE_V5_SCHEMA);
 const f=publicationFixture();
 try{
  // The legacy fixture is reconstructed using its original generic schema first.
  // Simulate the technology archive routing separately; the full persisted
  // technology reconstruction/approval path is covered in managed-tasks.test.mjs.
  const report=reviewedReport(f.db,'r');
  report.templateId='daily-technology';
  report.document.topic={id:'t-'+'f'.repeat(24),name:'每日科技投资简报'};
  report.document.items=report.document.items.map(item=>({...item,category:'optical_communications',details:{
   kind:'investment',
   background:'光模块厂商披露 1.6T 产品进入客户验证阶段。',
   supplyChain:[{segment:'光模块厂商（代码 · NASDAQ）',direction:'潜在受益',reason:'产品认证可能提升高速产品收入占比。',relationship:'potential'}],
   evidence:[{id:'release',name:'公司公告',url:'https://example.com/release',supports:'1.6T 产品验证进展'}],
  }}));
  const artifact=archiveArtifact(report,'2026-11-13T08:00:00Z');
  const document=JSON.parse(artifact.content);
  assert.equal(document.schema_version,5);
  assert.equal(validate(document),true);
  assert.equal(artifact.path,'reports/topics/t-'+'f'.repeat(24)+'/2026/11/03/v000001.json');
  const wrongCategory=structuredClone(document);wrongCategory.items[0].category='industry';
  assert.equal(validate(wrongCategory),false);
  const missingEvidence=structuredClone(document);delete missingEvidence.items[0].details.evidence;
  assert.equal(validate(missingEvidence),false);
  assert.throws(()=>archiveArtifact({...report,templateId:undefined},'2026-11-13T08:00:00Z'),/archive_schema_invalid/);
 }finally{f.close();}
});
