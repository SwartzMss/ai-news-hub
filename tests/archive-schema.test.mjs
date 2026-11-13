import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Ajv} from 'ajv';
import addFormats from 'ajv-formats';
import {ARCHIVE_SCHEMA,ARCHIVE_V2_SCHEMA,ARCHIVE_V3_SCHEMA} from '../dist/apps/server/src/publish/archive-schema.js';
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
