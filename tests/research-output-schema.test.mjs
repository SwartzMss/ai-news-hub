import test from 'node:test';
import assert from 'node:assert/strict';
import {Ajv} from 'ajv';
import {RESEARCH_SCHEMA} from '../dist/apps/server/src/news/report-schema.js';
import {CODEX_RESEARCH_SCHEMA,normalizeResearchOutput} from '../dist/apps/server/src/news/structured-output-schema.js';

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
