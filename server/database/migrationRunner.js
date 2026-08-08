const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

function listOrderedMigrations(files) {
  return files.filter(name => /^\d{3}_[a-z0-9_-]+\.sql$/i.test(name)).sort();
}

function splitSqlStatements(sql) {
  return sql
    .split(/\r?\n/)
    .filter(line => !/^\s*(--|#)/.test(line))
    .join('\n')
    .split(';')
    .map(statement => statement.trim())
    .filter(Boolean);
}

const IDEMPOTENT_SCHEMA_ERRORS = new Set([
  'ER_DUP_FIELDNAME',
  'ER_DUP_KEYNAME',
  'ER_CANT_DROP_FIELD_OR_KEY',
]);

async function executeMigrationStatement(connection, statement) {
  try {
    await connection.query(statement);
  } catch (error) {
    if (!IDEMPOTENT_SCHEMA_ERRORS.has(error.code)) throw error;
  }
}

async function runMigrations(pool, migrationsDir = path.join(__dirname, 'migrations')) {
  const lockConnection = await pool.getConnection();
  try {
    const [[lockResult]] = await lockConnection.query(
      "SELECT GET_LOCK('jcc_factory_schema_migrations', 60) AS acquired"
    );
    if (Number(lockResult.acquired) !== 1) throw new Error('Timed out waiting for migration lock');

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  const files = listOrderedMigrations(await fs.readdir(migrationsDir));
  const [appliedRows] = await pool.execute('SELECT version, checksum FROM schema_migrations');
  const applied = new Map(appliedRows.map(row => [row.version, row.checksum]));

  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    if (applied.has(file)) {
      if (applied.get(file) !== checksum) throw new Error(`Applied migration checksum changed: ${file}`);
      continue;
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const statement of splitSqlStatements(sql)) {
        await executeMigrationStatement(connection, statement);
      }
      await connection.execute('INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)', [file, checksum]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw new Error(`Migration ${file} failed: ${error.message}`);
    } finally {
      connection.release();
    }
  }
    return files;
  } finally {
    try {
      await lockConnection.query("SELECT RELEASE_LOCK('jcc_factory_schema_migrations')");
    } finally {
      lockConnection.release();
    }
  }
}

module.exports = {
  executeMigrationStatement,
  listOrderedMigrations,
  runMigrations,
  splitSqlStatements
};
