import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Ajv} from 'ajv';
import addFormats from 'ajv-formats';
import {ARCHIVE_SCHEMA} from '../dist/apps/server/src/publish/archive-schema.js';
import {archiveArtifact,reviewedReport} from '../dist/apps/server/src/publish/artifact.js';
import {publicationFixture} from './fixtures/publication.mjs';
test('published contract matches documented schema and excludes internal metadata',()=>{
 assert.deepEqual(JSON.parse(readFileSync(new URL('../docs/schema/report-archive-v1.schema.json',import.meta.url),'utf8')),ARCHIVE_SCHEMA);
 const validator=new Ajv({strict:true});addFormats(validator);const validate=validator.compile(ARCHIVE_SCHEMA);
 const s=publicationFixture();try{const artifact=archiveArtifact(reviewedReport(s.db,'r'),'2026-11-03T01:00:00Z');const doc=JSON.parse(artifact.content);assert.equal(validate(doc),true);assert.equal(validate({...doc,run_id:'private'}),false);assert.equal(validate({...doc,review_status:'pending'}),false);}finally{s.close();}
});
