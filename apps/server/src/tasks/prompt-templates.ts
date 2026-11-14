import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { HttpError } from '../errors.js';

export type TemplateSchemaId = 'headlines' | 'technology' | 'opensource';
export interface PromptTemplate {
  id: string;
  version: number;
  name: string;
  topic: string;
  schemaId: TemplateSchemaId;
  prompts: string[];
}
export interface PromptTemplateOption {
  id: string;
  version: number;
  name: string;
  topic: string;
  promptCount: number;
}
const templateCache = new Map<string, PromptTemplate[]>();
/** Keep old versioned template files while tasks or historical runs still reference them. */
export function promptTemplates(directory = resolve('prompt-templates')): PromptTemplate[] {
  const cached = templateCache.get(directory);
  if (cached) return cached;
  const templates = readdirSync(directory)
    .filter(name => /^[a-z0-9-]+\.v\d+\.json$/.test(name))
    .sort()
    .map(name => {
      const value = JSON.parse(readFileSync(resolve(directory, name), 'utf8')) as PromptTemplate;
      if (
        !/^[a-z0-9-]+$/.test(value.id) ||
        !Number.isSafeInteger(value.version) ||
        value.version < 1 ||
        name !== value.id + '.v' + value.version + '.json' ||
        typeof value.name !== 'string' || !value.name.trim() ||
        typeof value.topic !== 'string' || !value.topic.trim() ||
        !['headlines', 'technology', 'opensource'].includes(value.schemaId) ||
        !Array.isArray(value.prompts) ||
        value.prompts.length < 1 || value.prompts.length > 20 ||
        value.prompts.some(prompt => typeof prompt !== 'string' || !prompt.trim() || prompt.length > 8000)
      )
        throw new Error('invalid_prompt_template');
      return value;
    });
  templateCache.set(directory, templates);
  return templates;
}
export function findPromptTemplate(
  id: string,
  version: number,
  directory = resolve('prompt-templates'),
): PromptTemplate | undefined {
  return promptTemplates(directory).find(template => template.id === id && template.version === version);
}
export function getPromptTemplate(
  id: string,
  version: number,
  directory = resolve('prompt-templates'),
): PromptTemplate {
  const template = findPromptTemplate(id, version, directory);
  if (!template) throw new HttpError(400, 'prompt_template_not_found');
  return template;
}
export function promptTemplateOptions(directory = resolve('prompt-templates')): PromptTemplateOption[] {
  return promptTemplates(directory).map(({ id, version, name, topic, prompts }) => ({
    id, version, name, topic, promptCount: prompts.length,
  }));
}
