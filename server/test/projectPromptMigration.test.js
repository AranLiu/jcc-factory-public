const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const migrationPath = path.join(
  rootDir,
  'server',
  'database',
  'migrations',
  '010_project_character_prompts.sql'
);

test('project character prompts have an ordered migration and a complete API mapping', () => {
  assert.equal(
    fs.existsSync(migrationPath),
    true,
    'missing migration 010_project_character_prompts.sql'
  );

  const migrationSql = fs.readFileSync(migrationPath, 'utf8');
  const initSql = fs.readFileSync(
    path.join(rootDir, 'server', 'database', 'init.sql'),
    'utf8'
  );
  const projectRoutes = fs.readFileSync(
    path.join(rootDir, 'server', 'routes', 'projects.js'),
    'utf8'
  );

  for (const column of [
    'character_knowledge_graph_prompt',
    'character_integration_prompt',
    'character_prompt',
  ]) {
    assert.match(
      migrationSql,
      new RegExp(`ALTER TABLE projects ADD COLUMN ${column}\\b`, 'i')
    );
    assert.match(initSql, new RegExp(`\\b${column}\\b`, 'i'));
  }

  assert.match(projectRoutes, /character_prompt[\s\S]*updates\.push\('character_prompt = \?'\)/);
});
