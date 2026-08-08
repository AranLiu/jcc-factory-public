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
  '009_four_step_script_unit_workflow.sql'
);

test('four-step script-unit workflow has a forward migration and fresh-schema fields', () => {
  assert.equal(
    fs.existsSync(migrationPath),
    true,
    'missing migration 009_four_step_script_unit_workflow.sql'
  );

  const migrationSql = fs.readFileSync(migrationPath, 'utf8');
  const initSql = fs.readFileSync(
    path.join(rootDir, 'server', 'database', 'init.sql'),
    'utf8'
  );

  for (const column of ['step3_character_graph_completed', 'step4_completed']) {
    assert.match(
      migrationSql,
      new RegExp(`ALTER TABLE script_units ADD COLUMN ${column}\\b`, 'i')
    );
    assert.match(initSql, new RegExp(`\\b${column}\\b`, 'i'));
  }

  assert.match(
    migrationSql,
    /SET step3_character_graph_completed\s*=\s*CASE[\s\S]*step2_character_graph_completed/i
  );
  assert.match(
    migrationSql,
    /step4_completed\s*=\s*CASE[\s\S]*step3_completed/i
  );
});
