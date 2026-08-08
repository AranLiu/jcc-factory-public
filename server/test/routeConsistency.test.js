const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  const endIndex = end ? source.indexOf(end, startIndex + start.length) : source.length;
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('global character content uses one task type and migrates only legacy manual rows', () => {
  const aiRoutes = read('server/routes/ai.js');
  const putSection = section(
    aiRoutes,
    "router.put('/project/:projectId/global-character-content'",
    "router.get('/project/:projectId/global-character-content'"
  );
  const getSection = section(
    aiRoutes,
    "router.get('/project/:projectId/global-character-content'",
    'module.exports'
  );
  const migrationRelativePath = 'server/database/migrations/012_global_character_content_task_type.sql';
  assert.equal(
    fs.existsSync(path.join(rootDir, migrationRelativePath)),
    true,
    'missing migration 012_global_character_content_task_type.sql'
  );
  const migration = read(migrationRelativePath);

  assert.match(putSection, /'global_character_content'/);
  assert.doesNotMatch(putSection, /'character_integration'/);
  assert.match(getSection, /'global_character_content'/);
  assert.match(
    migration,
    /UPDATE\s+ai_tasks\s+SET\s+task_type\s*=\s*'global_character_content'\s+WHERE\s+task_type\s*=\s*'character_integration'\s+AND\s+prompt\s*=\s*'手动录入全局角色图谱'/i
  );
});

test('project list maps every accepted UI status before binding the database filter', () => {
  const projectRoutes = read('server/routes/projects.js');
  const listSection = section(projectRoutes, "router.get('/',", "router.get('/:id'");
  assert.equal(
    (listSection.match(/params\.push\(mapUiToDbStatus\(status\)\)/g) || []).length,
    2
  );
  assert.equal((listSection.match(/params\.push\(status\)/g) || []).length, 0);
});

test('knowledge restore invalidates its cache and contains no unreachable local-storage branch', () => {
  const knowledgeRoutes = read('server/routes/knowledgeBase.js');
  const restoreSection = section(
    knowledgeRoutes,
    "router.post('/:id/restore-from-content'",
    'module.exports'
  );
  const cacheDeleteIndex = restoreSection.indexOf(
    'serverCache.delete(`content_${entryId}_${entries[0].user_id}`)'
  );
  const successIndex = restoreSection.indexOf("return res.json({ message: 'File restored successfully' })");

  assert.ok(cacheDeleteIndex >= 0, 'restore must invalidate the same cache key used by content reads');
  assert.ok(cacheDeleteIndex < successIndex, 'cache invalidation must happen before reporting success');
  assert.doesNotMatch(restoreSection, /const absolutePath = path\.join\(process\.cwd\(\), file_path\)/);
});

test('documents router does not expose a no-op knowledge-base update endpoint', () => {
  const documentRoutes = read('server/routes/documents.js');
  assert.doesNotMatch(documentRoutes, /router\.put\('\/knowledge-base\/:fileId'/);
  assert.doesNotMatch(documentRoutes, /message:\s*'文档更新成功'/);
});

test('knowledge archive validates and uses one safe display title', () => {
  const knowledgeRoutes = read('server/routes/knowledgeBase.js');
  const archiveSection = section(
    knowledgeRoutes,
    "router.post('/archive'",
    "router.get('/',"
  );

  assert.match(knowledgeRoutes, /const \{ sanitizeDisplayName \} = require\('\.\.\/utils\/security'\)/);
  assert.match(archiveSection, /sanitizeDisplayName\(/);
  assert.doesNotMatch(archiveSection, /const sanitizedTitle = title\.replace/);
  assert.doesNotMatch(archiveSection, /let finalTitle = title\.endsWith/);
});

test('knowledge integrity route contains no unreachable legacy local branch', () => {
  const knowledgeRoutes = read('server/routes/knowledgeBase.js');
  const integritySection = section(
    knowledgeRoutes,
    "router.get('/:id/check-integrity'",
    "router.post('/:id/restore-from-content'"
  );

  assert.match(integritySection, /minioService\.getFileBuffer\(/);
  assert.doesNotMatch(integritySection, /path\.join\(process\.cwd\(\), file_path\)/);
});

test('file and knowledge-base deletion cannot swallow object-storage failures', () => {
  for (const [relativePath, routeStart, databaseDelete] of [
    ['server/routes/files.js', "router.delete('/:id'", "DELETE FROM files WHERE id = ?"],
    ['server/routes/knowledgeBase.js', "router.delete('/:id'", "DELETE FROM knowledge_base WHERE id = ?"],
  ]) {
    const source = read(relativePath);
    const deleteSection = section(source, routeStart, databaseDelete);
    assert.match(deleteSection, /await deleteStoredObjects\(/, `${relativePath} must use strict storage deletion`);
    assert.doesNotMatch(deleteSection, /删除.*失败[\s\S]*console\.warn/, `${relativePath} must not swallow storage errors`);
  }
});

test('project deletion enumerates associated MinIO objects before the cascading database delete', () => {
  const projectRoutes = read('server/routes/projects.js');
  const deleteSection = section(projectRoutes, "router.delete('/:id'", 'module.exports');
  const enumerateIndex = deleteSection.indexOf('FROM files WHERE project_id = ?');
  const storageDeleteIndex = deleteSection.indexOf('await deleteStoredObjects(');
  const databaseDeleteIndex = deleteSection.indexOf("DELETE FROM projects WHERE id = ?");

  assert.ok(enumerateIndex >= 0, 'project deletion must enumerate associated file objects');
  assert.ok(storageDeleteIndex > enumerateIndex, 'project storage deletion must follow enumeration');
  assert.ok(databaseDeleteIndex > storageDeleteIndex, 'database cascade must happen only after storage deletion');
  assert.match(deleteSection, /pool\.getConnection\(\)/);
  assert.match(deleteSection, /beginTransaction\(\)/);
  assert.match(deleteSection, /SELECT[\s\S]*FROM projects[\s\S]*FOR UPDATE/);
  assert.match(deleteSection, /FROM files WHERE project_id = \?[\s\S]*FOR UPDATE/);
  assert.match(deleteSection, /await connection\.commit\(\)/);
  assert.match(deleteSection, /await connection\.rollback\(\)/);
  assert.match(deleteSection, /connection\?\.release\(\)/);
});
