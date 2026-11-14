export const promptTemplateReferenceMigration = {
  version: 14,
  name: 'template_referenced_task_configuration',
  sql: `
    UPDATE tasks
      SET configuration_json = json_remove(configuration_json, '$.prompts', '$.topic'),
          prompt = ''
      WHERE configuration_json IS NOT NULL AND json_valid(configuration_json)
        AND json_type(configuration_json, '$.templateId') = 'text'
        AND json_type(configuration_json, '$.templateVersion') = 'integer';
    UPDATE tasks
      SET configuration_json = json_remove(configuration_json, '$.prompts'),
          prompt = '',
          status = 'paused',
          next_run_at = NULL
      WHERE configuration_json IS NOT NULL AND json_valid(configuration_json)
        AND (json_type(configuration_json, '$.templateId') IS NULL
          OR json_type(configuration_json, '$.templateVersion') IS NULL);
    -- Keep historical topic snapshots for archive provenance checks; only remove prompt bodies.
    UPDATE task_runs
      SET configuration_json = json_remove(configuration_json, '$.prompts')
      WHERE configuration_json IS NOT NULL AND json_valid(configuration_json);
  `,
};
