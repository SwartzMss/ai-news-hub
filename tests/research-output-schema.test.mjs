import test from 'node:test';
import assert from 'node:assert/strict';
import {Ajv} from 'ajv';
import {OPEN_SOURCE_RESEARCH_SCHEMA,RESEARCH_SCHEMA} from '../dist/apps/server/src/news/report-schema.js';
import {CODEX_OPEN_SOURCE_RESEARCH_SCHEMA,CODEX_RESEARCH_SCHEMA,normalizeResearchOutput} from '../dist/apps/server/src/news/structured-output-schema.js';

function checkStrict(node){
  assert.equal(node.oneOf,undefined);
  assert.equal(node.uniqueItems,undefined);
  assert.equal(node.minLength,undefined);
  assert.equal(node.maxLength,undefined);
  if(node.type==='object'){
    assert.equal(node.additionalProperties,false);
    assert.deepEqual([...node.required].sort(),Object.keys(node.properties).sort());
    for(const child of Object.values(node.properties))checkStrict(child);
  }
  if(node.items)checkStrict(node.items);
  for(const child of node.anyOf??[])checkStrict(child);
}

test('Codex output schema requires nullable optional fields at every level and normalizes them for archive validation',()=>{
  checkStrict(CODEX_RESEARCH_SCHEMA);
  const output={title:'每日热点观察',items:[
    {url:'https://example.com/news',category:'industry',importance:4,factSummary:'官方发布更新。',analysis:null,evidenceQuote:'Official update announcement',details:{
      kind:'news',background:'此前已有草案。',keyFacts:[{name:'发布日期',value:'2026-11-11',unit:null,period:null,nature:'confirmed',evidenceRefs:['notice']}],
      timeline:null,positions:null,impacts:null,uncertainties:null,watchpoints:null,
      evidence:[{id:'notice',name:'官方公告',url:'https://example.com/news',supports:'发布日期'}],
    }},
    {url:'https://example.com/other',category:'other',importance:2,factSummary:'另一项更新。',analysis:null,evidenceQuote:'Another official update',details:null},
  ]};
  const ajv=new Ajv({strict:true});
  const validateCodex=ajv.compile(CODEX_RESEARCH_SCHEMA);
  assert.equal(validateCodex(output),true,JSON.stringify(validateCodex.errors));
  const normalized=normalizeResearchOutput(output);
  assert.equal(normalized.items[0].details.keyFacts[0].unit,undefined);
  assert.equal(normalized.items[0].details.timeline,undefined);
  assert.equal(normalized.items[1].details,undefined);
  assert.equal(normalized.items[1].analysis,null);
  const validateArchive=ajv.compile(RESEARCH_SCHEMA);
  assert.equal(validateArchive(normalized),true,JSON.stringify(validateArchive.errors));
});
test('strict Codex project output normalizes optional project fields',()=>{
 const project={kind:'project',overview:'本地代码检索工具。',change:{summary:'新增增量索引。',version:null,type:null,publishedAt:null,evidenceRefs:['release']},technical:[{description:'只处理变更文件。',evidenceRefs:['release']}],useCases:null,license:null,evaluation:null,evidence:[{id:'release',name:'发布说明',url:'https://example.com/release',supports:'增量索引'}]};
 const output={title:'每日开源项目',items:[{url:'https://example.com/release',category:'opensource',importance:4,factSummary:'项目发布更新。',analysis:null,evidenceQuote:'Released new incremental indexing',details:project}]};
 const ajv=new Ajv({strict:true});const validateCodex=ajv.compile(CODEX_RESEARCH_SCHEMA);
 assert.equal(validateCodex(output),true,JSON.stringify(validateCodex.errors));
 const normalized=normalizeResearchOutput(output);
 assert.equal(normalized.items[0].details.change.version,undefined);
 assert.equal(normalized.items[0].details.useCases,undefined);
 const validateArchive=ajv.compile(RESEARCH_SCHEMA);
 assert.equal(validateArchive(normalized),true,JSON.stringify(validateArchive.errors));
});


test('daily open-source schema requires one of five research areas and structured project details',()=>{
 const project={kind:'project',overview:'Rust 文件处理工具。',change:{summary:'新增并行流式读取。',version:null,type:null,publishedAt:null,evidenceRefs:['release']},technical:[{description:'按块并行读取并保持输出顺序。',evidenceRefs:['release']}],useCases:null,license:null,evaluation:null,evidence:[{id:'release',name:'官方发布说明',url:'https://example.com/release',supports:'并行流式读取'}]};
 const output={title:'每日开源项目',items:[{url:'https://example.com/release',researchArea:'rust',category:'opensource',importance:4,factSummary:'工具新增并行流式读取。适合大文件处理。',analysis:'可评估用于批量文件流水线。',evidenceQuote:'Added parallel streaming file reads',details:project}]};
 const ajv=new Ajv({strict:true});
 const validateCodex=ajv.compile(CODEX_OPEN_SOURCE_RESEARCH_SCHEMA);
 assert.equal(validateCodex(output),true,JSON.stringify(validateCodex.errors));
 const normalized=normalizeResearchOutput(output,OPEN_SOURCE_RESEARCH_SCHEMA);
 assert.equal(normalized.items[0].details.change.version,undefined);
 assert.equal(normalized.items[0].details.useCases,undefined);
 const validateArchive=ajv.compile(OPEN_SOURCE_RESEARCH_SCHEMA);
 assert.equal(validateArchive(normalized),true,JSON.stringify(validateArchive.errors));
 const missingArea=JSON.parse(JSON.stringify(normalized));delete missingArea.items[0].researchArea;
 assert.equal(validateArchive(missingArea),false);
 const missingDetails=JSON.parse(JSON.stringify(normalized));delete missingDetails.items[0].details;
 assert.equal(validateArchive(missingDetails),false);
 const wrongArea=JSON.parse(JSON.stringify(normalized));wrongArea.items[0].researchArea='gpu';
 assert.equal(validateArchive(wrongArea),false);
});
