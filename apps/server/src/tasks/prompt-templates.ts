import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { taskInput } from './configuration.js';

export interface PromptTemplate {
  id: string;
  version: number;
  name: string;
  topic: string;
  prompts: string[];
}
export function promptTemplates(directory = resolve('prompt-templates')): PromptTemplate[] {
  const templates = readdirSync(directory).filter(name => /^[a-z0-9-]+\.v\d+\.json$/.test(name)).sort().map(name => {
    const value = JSON.parse(readFileSync(resolve(directory, name), 'utf8')) as PromptTemplate;
    if (!/^[a-z0-9-]+$/.test(value.id) || !Number.isSafeInteger(value.version) || value.version < 1 || name !== `${value.id}.v${value.version}.json`)
      throw new Error('invalid_prompt_template');
    taskInput({ name: value.name, topic: value.topic, prompts: value.prompts, autoPublish: false, schedule: {kind:'manual'} });
    return value;
  });
  const latest = new Map<string, PromptTemplate>();
  for (const template of templates) {
    const previous = latest.get(template.id);
    if (!previous || previous.version < template.version) latest.set(template.id, template);
  }
  return [...latest.values()].sort((a, b) => a.id.localeCompare(b.id));
}
