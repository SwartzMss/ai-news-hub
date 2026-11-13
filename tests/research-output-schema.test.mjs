import test from 'node:test';
import assert from 'node:assert/strict';
import {Ajv} from 'ajv';
import {OPEN_SOURCE_RESEARCH_SCHEMA,RESEARCH_SCHEMA,TECHNOLOGY_RESEARCH_SCHEMA} from '../dist/apps/server/src/news/report-schema.js';
import {CODEX_OPEN_SOURCE_RESEARCH_SCHEMA,CODEX_RESEARCH_SCHEMA,CODEX_TECHNOLOGY_RESEARCH_SCHEMA,normalizeResearchOutput} from '../dist/apps/server/src/news/structured-output-schema.js';

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

test('daily technology v1 requires focused categories and evidence-backed investment details',()=>{
 const ajv=new Ajv({strict:true});
 checkStrict(CODEX_TECHNOLOGY_RESEARCH_SCHEMA);
 const output={title:'2026-11-13 每日科技投资简报',items:[{
  url:'https://example.com/filing',category:'optical_communications',importance:5,
  factSummary:'光模块厂商披露 1.6T 产品进入客户验证阶段。',
  analysis:'若认证和量产按期推进，可能提高高速产品收入占比。',
  evidenceQuote:'The 1.6T transceiver has entered customer qualification',
  details:{
   kind:'investment',
   background:'公司披露 1.6T 光模块客户验证进展，这是本次新增信息。',
   metrics:[{name:'产品速率',value:'1.6T',unit:'每秒比特',period:'产品规格',comparison:null,basis:'actual',evidenceRefs:['filing']}],
   supplyChain:[{segment:'光模块厂商（代码 · NASDAQ）',direction:'潜在受益',reason:'高速产品认证推进可能改善产品结构，客户供货关系尚未证实。',relationship:'potential',evidenceRefs:['filing']}],
   investmentLogic:'验证通过、量产和订单兑现是后续收入增长的关键前提。',
   watchpoints:['客户认证结果','量产时间与出货规模'],
   risks:['认证进度延后','竞争导致 ASP 下滑'],
   valuation:null,
   evidence:[{id:'filing',name:'公司投资者关系公告',url:'https://example.com/filing',supports:'1.6T 产品验证进度'}],
  },
 }]};
 const validateCodex=ajv.compile(CODEX_TECHNOLOGY_RESEARCH_SCHEMA);
 assert.equal(validateCodex(output),true,JSON.stringify(validateCodex.errors));
 const normalized=normalizeResearchOutput(output,TECHNOLOGY_RESEARCH_SCHEMA);
 const validateArchive=ajv.compile(TECHNOLOGY_RESEARCH_SCHEMA);
 assert.equal(validateArchive(normalized),true,JSON.stringify(validateArchive.errors));
 const wrongCategory=structuredClone(normalized);wrongCategory.items[0].category='industry';
 assert.equal(validateArchive(wrongCategory),false);
 const missingDetails=structuredClone(normalized);delete missingDetails.items[0].details;
 assert.equal(validateArchive(missingDetails),false);
 const missingEvidence=structuredClone(normalized);delete missingEvidence.items[0].details.evidence;
 assert.equal(validateArchive(missingEvidence),false);
 const wrongKind=structuredClone(normalized);wrongKind.items[0].details.kind='news';
 assert.equal(validateArchive(wrongKind),false);
});

test('minimal technology investment output survives normalization and backend validation',()=>{
 const output={title:'2026-11-13 每日科技投资简报',items:[{
  url:'https://example.com/filing',category:'ai_industry_chain',importance:5,
  factSummary:'云厂商上调 AI 数据中心资本开支计划。',
  analysis:'资本开支兑现可能拉动 GPU、服务器和网络设备需求。',
  evidenceQuote:'Official AI model release announcement',
  details:{
   kind:'investment',
   background:'公司在业绩会上更新了 AI 数据中心资本开支计划。',
   evidence:[{id:'filing',name:'公司业绩会纪要',url:'https://example.com/filing',supports:'AI 数据中心资本开支计划'}],
  },
 }]};
 const normalized=normalizeResearchOutput(output,TECHNOLOGY_RESEARCH_SCHEMA);
 const validate=new Ajv({strict:true}).compile(TECHNOLOGY_RESEARCH_SCHEMA);
 assert.equal(validate(normalized),true,JSON.stringify(validate.errors));
});
