'use strict';

// Initialise the SQLite database from schema.sql. Idempotent — safe to run
// multiple times. Usage: `npm run init-db`.

const fs = require('fs');
const path = require('path');
const db = require('../src/db');

const schemaPath = path.join(__dirname, '..', 'src', 'schema.sql');
const skillsSchemaPath = path.join(__dirname, '..', 'src', 'schema-skills.sql');
const sql = fs.readFileSync(schemaPath, 'utf8');
const skillsSql = fs.readFileSync(skillsSchemaPath, 'utf8');

console.log('Applying schema from', schemaPath, '→', db.path);
db.exec(sql);
console.log('Applying skill graph schema from', skillsSchemaPath);
db.exec(skillsSql);

const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all();
console.log('Tables present:');
for (const t of tables) {
  const n = db.prepare(`SELECT COUNT(*) AS n FROM "${t.name}"`).get().n;
  console.log(`  ${t.name.padEnd(22)}  rows: ${n}`);
}
console.log('\n✓ Schema applied. Next: `npm run seed`.');
