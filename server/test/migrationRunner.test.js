const test = require('node:test');
const assert = require('node:assert/strict');
const {
  executeMigrationStatement,
  listOrderedMigrations,
  splitSqlStatements
} = require('../database/migrationRunner');

test('listOrderedMigrations keeps only numbered SQL files in lexical order', () => {
  assert.deepEqual(listOrderedMigrations(['002_second.sql', 'README.md', '001_first.sql', 'bad.sql']), [
    '001_first.sql', '002_second.sql',
  ]);
});

test('executeMigrationStatement tolerates only idempotent duplicate schema errors', async () => {
  await executeMigrationStatement({
    query: async () => { const error = new Error('duplicate column'); error.code = 'ER_DUP_FIELDNAME'; throw error; }
  }, 'ALTER TABLE sample ADD COLUMN name TEXT');

  await assert.rejects(
    executeMigrationStatement({
      query: async () => { const error = new Error('syntax error'); error.code = 'ER_PARSE_ERROR'; throw error; }
    }, 'INVALID SQL'),
    /syntax error/
  );
});

test('splitSqlStatements removes comments and returns executable statements', () => {
  const sql = `-- comment\nCREATE TABLE example (id INT);\n\n# another comment\nINSERT INTO example VALUES (1);`;
  assert.deepEqual(splitSqlStatements(sql), [
    'CREATE TABLE example (id INT)',
    'INSERT INTO example VALUES (1)',
  ]);
});
