import type { SettingsUpdate } from '../../../../packages/shared/src/settings.js';
import { Ajv } from 'ajv';
import { HttpError } from '../errors.js';

const object = (properties: Record<string,unknown>, required = Object.keys(properties)) => ({type:'object',additionalProperties:false,properties,required});
const text = (maxLength:number,minLength=0) => ({type:'string',minLength,maxLength});
export const SETTINGS_SCHEMA = object({
  revision: {type:'integer',minimum:1},
  logLevel:{type:'string',enum:['fatal','error','warn','info','debug','trace','silent']},
  codex:object({binary:text(1024,1),model:text(128)}),
  execution:object({timeoutMs:{type:'integer',minimum:1000,maximum:3600000},concurrency:{type:'integer',minimum:1,maximum:4},maxQueue:{type:'integer',minimum:1,maximum:100}}),
  github:object({enabled:{type:'boolean'},repository:text(201),branch:text(200),token:text(255,20),clearToken:{type:'boolean'}},['repository','branch']),
});
const validate = new Ajv({strict:true,coerceTypes:false,removeAdditional:false}).compile<SettingsUpdate>(SETTINGS_SCHEMA);
export function settingsInput(input:unknown): SettingsUpdate {
  if (!validate(input)) throw new HttpError(400,'invalid_settings');
  if (/\s|\0/.test(input.codex.binary) || /[\r\n\0]/.test(input.codex.model)) throw new HttpError(400,'invalid_settings');
  const {github} = input;
  if (github.token && !/^[A-Za-z0-9_]{20,255}$/.test(github.token) || github.clearToken && github.token) throw new HttpError(400,'invalid_publication_config');
  if (github.repository && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(github.repository)) throw new HttpError(400,'invalid_publication_config');
  if (github.branch && (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(github.branch) || github.branch.includes('..') || github.branch.includes('//') || github.branch.endsWith('/') || github.branch.endsWith('.') || github.branch.split('/').some(x=>x.endsWith('.lock')))) throw new HttpError(400,'invalid_publication_config');
  return input;
}
