const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const minioModulePath = path.resolve(__dirname, '../config/minio.js');

function loadMinioModule({ client, config, logger }) {
  const source = fs.readFileSync(minioModulePath, 'utf8');
  const module = { exports: {} };
  const localRequire = (request) => {
    if (request === 'minio') return { Client: class { constructor() { return client; } } };
    if (request === 'dotenv') return { config() {} };
    if (request === './env') return { validateMinioEnv: () => config };
    throw new Error(`Unexpected dependency: ${request}`);
  };

  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require: localRequire,
    process: { env: {} },
    console: logger,
  }, { filename: minioModulePath });
  return module.exports;
}

test('creates missing bucket in the configured region before reporting MinIO ready', async () => {
  const calls = [];
  const client = {
    async listBuckets() { calls.push(['listBuckets']); return []; },
    async bucketExists(bucket) { calls.push(['bucketExists', bucket]); return false; },
    async makeBucket(bucket, region) { calls.push(['makeBucket', bucket, region]); },
  };
  const logger = { log() {}, error() {} };
  const config = { bucket: 'fresh-bucket', region: 'ap-southeast-1' };
  const { testConnectionAndCreateBuckets } = loadMinioModule({ client, config, logger });

  assert.equal(await testConnectionAndCreateBuckets({ client, config, logger }), true);
  assert.deepEqual(calls, [
    ['listBuckets'],
    ['bucketExists', 'fresh-bucket'],
    ['makeBucket', 'fresh-bucket', 'ap-southeast-1'],
  ]);
});

test('returns false and reports a MinIO bucket creation error', async () => {
  const errors = [];
  const client = {
    async listBuckets() {},
    async bucketExists() { return false; },
    async makeBucket() { throw new Error('create denied'); },
  };
  const logger = { log() {}, error(...args) { errors.push(args.join(' ')); } };
  const config = { bucket: 'fresh-bucket', region: 'ap-southeast-1' };
  const { testConnectionAndCreateBuckets } = loadMinioModule({ client, config, logger });

  assert.equal(await testConnectionAndCreateBuckets({ client, config, logger }), false);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /create denied/);
});
