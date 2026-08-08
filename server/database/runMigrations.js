require('dotenv').config({ path: require('node:path').join(__dirname, '../.env') });
const { pool } = require('../config/database');
const { runMigrations } = require('./migrationRunner');

runMigrations(pool)
  .then(files => console.log(`Migrations verified: ${files.length}`))
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
