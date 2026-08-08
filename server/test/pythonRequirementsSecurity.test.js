const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const requirements = fs.readFileSync(
  path.resolve(__dirname, '../python_services/requirements.txt'),
  'utf8'
);

function pinnedVersion(packageName) {
  const match = requirements.match(new RegExp(`^${packageName}==([^\\s#]+)$`, 'mi'));
  return match?.[1] || null;
}

test('Python transitive dependencies remain pinned to the audited fixed versions', () => {
  assert.equal(pinnedVersion('idna'), '3.15');
  assert.equal(pinnedVersion('pyasn1'), '0.6.4');
  assert.equal(pinnedVersion('requests'), '2.33.0');
  assert.equal(pinnedVersion('urllib3'), '2.7.0');
});
