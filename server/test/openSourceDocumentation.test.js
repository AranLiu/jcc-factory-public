const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const readRoot = (...parts) => fs.readFileSync(path.join(rootDir, ...parts), 'utf8');

const requiredDocuments = [
  'README.md',
  'LICENSE',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'docs/DEPLOYMENT.md',
  'docs/API.md',
  'docs/API_RELAY_COMPLIANCE.md',
  'docs/OPEN_SOURCE_RELEASE.md',
];

test('required governance and operating documents exist', () => {
  for (const relativePath of requiredDocuments) {
    assert.ok(fs.existsSync(path.join(rootDir, relativePath)), `missing ${relativePath}`);
  }
});

test('API relay guidance uses accurate boundaries and official provider sources', () => {
  const guidance = readRoot('docs/API_RELAY_COMPLIANCE.md');

  for (const exactText of [
    'API relay',
    'not a VPN',
    'regional availability',
    'provider terms',
    'privacy',
    'https://ai.google.dev/gemini-api/terms',
    'https://ai.google.dev/gemini-api/docs/available-regions',
    'https://policies.google.com/terms/generative-ai/use-policy',
    'https://developers.google.com/terms',
  ]) {
    assert.ok(guidance.includes(exactText), `relay guidance must include: ${exactText}`);
  }

  assert.match(guidance, /内部自建[\s\S]*授权第三方[\s\S]*公开转售/);
  assert.match(guidance, /地区[\s\S]*安全[\s\S]*(绕过|规避)/);
  assert.match(guidance, /跨境[\s\S]*(数据|传输)/);
  assert.match(guidance, /不是法律意见/);
  assert.match(guidance, /(公开|商业)[\s\S]*(当地|本地|适用法域)[\s\S]*(律师|法律顾问)/);
  assert.match(guidance, /当前实现[\s\S]*持久化[\s\S]*system_config/);
  assert.match(guidance, /(静态加密|at rest)[\s\S]*(备份|转储|dump)/i);
  assert.match(guidance, /秘密管理[\s\S]*(单独|另行)[\s\S]*(集成|实现)/);
});

test('README gives users a copyable Docker journey and safe lifecycle commands', () => {
  const readme = readRoot('README.md');

  for (const exactText of [
    'npm run quickstart',
    'npm run docker:down',
    'npm run docker:up',
    'npm run docker:logs',
    'npm run docker:reset',
    'http://127.0.0.1:${APP_PORT:-8080}',
    'http://127.0.0.1:8080',
    'SeaweedFS',
    '.env',
    'server/.env',
  ]) {
    assert.ok(readme.includes(exactText), `README must include: ${exactText}`);
  }

  assert.match(readme, /Docker (Desktop|Engine)[\s\S]*Compose v2/i);
  assert.match(readme, /第一次使用[\s\S]*\/setup/);
  assert.match(readme, /(再次执行|重新运行)[\s\S]*复用[\s\S]*\.env[\s\S]*不会覆盖/);
  assert.match(readme, /(销毁|删除)[\s\S]*(数据卷|全部本地数据)/);
  assert.match(readme, /--wait[\s\S]*应用[\s\S]*健康/);
});

test('documentation makes browser setup the default and headless provisioning an explicit opt-in', () => {
  const readme = readRoot('README.md');
  const deployment = readRoot('docs/DEPLOYMENT.md');
  const api = readRoot('docs/API.md');
  const combined = `${readme}\n${deployment}\n${api}`;
  const setupSection = api.match(/## 一次性首次设置([\s\S]*?)(?=\n## |$)/)?.[1];

  assert.match(readme, /http:\/\/127\.0\.0\.1:8080\/setup/);
  assert.match(deployment, /\/setup/);
  assert.match(deployment, /AUTO_PROVISION_ADMIN=true/);
  assert.match(deployment, /npm run setup:admin/);
  assert.ok(setupSection, 'API must contain a dedicated first-run setup section');
  assert.match(setupSection, /GET \/api\/auth\/setup-status/);
  assert.match(setupSection, /POST \/api\/auth\/setup[\s\S]*?成功时返回 `201`/);
  assert.match(setupSection, /\{\s*"initialized"\s*:\s*false\s*\}/);
  assert.match(setupSection, /\{\s*"initialized"\s*:\s*true\s*\}/);
  assert.match(
    setupSection,
    /初始化完成后[\s\S]*?POST \/api\/auth\/setup[\s\S]*?永久返回 `409`[\s\S]*?already_initialized/
  );
  assert.match(combined, /(one-time|一次性|仅一次|永久关闭)/i);
  assert.match(combined, /(existing users|已有用户)[\s\S]*(login|登录)/i);
  assert.doesNotMatch(combined, /ADMIN_PASSWORD\s*=\s*[^\s`|]+/);
});

test('README stays user-facing while documenting setup, formats, and developer entry points', () => {
  const readme = readRoot('README.md');

  for (const exactText of [
    'Node.js 22.15+',
    'npm 10+',
    'Python 3.12',
    'MySQL 8.4',
    'npm ci',
    'npm ci --prefix server',
    'npm ci --prefix client',
    'npm run migrate',
    'npm run dev',
    'GEMINI_API_KEY',
    'GEMINI_DEFAULT_MODEL',
    'AI_PROVIDER_TIMEOUT_MS',
    '.docx',
    '.txt',
    'npm test',
    'npm run build',
    'npm run audit:all',
  ]) {
    assert.ok(readme.includes(exactText), `README must include: ${exactText}`);
  }

  assert.match(readme, /Gemini[\s\S]*暂不配置[\s\S]*(任务|功能)/i);
  assert.match(readme, /模型[\s\S]*(可用性|可用)[\s\S]*(变化|选择)/);
  assert.doesNotMatch(readme, /证据边界|公开发布门禁|候选公开历史|历史凭据|gitleaks/);
});

test('README documents user-facing multi-provider setup and capability limits', () => {
  const readme = readRoot('README.md');

  for (const exactText of [
    'OpenAI、Gemini、DeepSeek',
    'AI 与工作流配置',
    '文本生成服务',
    '视频解析与角色图谱仍使用 Gemini',
    'API Base URL',
  ]) {
    assert.ok(readme.includes(exactText), `README must include provider guidance: ${exactText}`);
  }

  assert.match(readme, /密钥[\s\S]*只写不回显/);
  assert.match(readme, /HTTPS[\s\S]*(localhost|127\.0\.0\.1)/);
  assert.match(readme, /第三方服务[\s\S]*(费用|内容政策)[\s\S]*数据处理/);
});

test('public product positioning exposes short-drama analysis as the only creation entry', () => {
  const readme = readRoot('README.md');
  const packageJson = JSON.parse(readRoot('package.json'));
  const introduction = readme.split('\n').slice(0, 12).join('\n');

  assert.match(introduction, /当前版本[\s\S]*仅支持短剧拆解/);
  assert.doesNotMatch(introduction, /视频[、/]小说|小说分析/);
  assert.doesNotMatch(packageJson.description, /小说/);
});

test('README leaves audit history and release governance to dedicated documents', () => {
  const readme = readRoot('README.md');
  const release = readRoot('docs/OPEN_SOURCE_RELEASE.md');

  assert.doesNotMatch(readme, /证据边界|历史实测|公开发布清单|公开发布门禁|内部历史|候选公开/);
  assert.match(release, /仓库内可完成/);
  assert.match(release, /外部负责人/);
  assert.match(release, /候选公开历史|candidate public history/);
});

test('README keeps custom application ports paired with allowed origins', () => {
  const readme = readRoot('README.md');

  assert.match(
    readme,
    /APP_PORT=8081[\s\S]*ALLOWED_ORIGINS=http:\/\/localhost:8081,http:\/\/127\.0\.0\.1:8081/
  );
  assert.ok(
    readme.includes('http://127.0.0.1:${APP_PORT:-8080}/api/health'),
    'health URL must follow APP_PORT with an explicit default'
  );
  assert.match(readme, /默认端口[\s\S]*(无需修改|直接使用)[\s\S]*APP_PORT=8081/);
});

test('contributing guide stays concise and covers the contributor workflow', () => {
  const contributing = readRoot('CONTRIBUTING.md');

  assert.match(contributing, /本地开发/);
  assert.match(contributing, /npm test[\s\S]*npm run build[\s\S]*npm run audit:all[\s\S]*git diff --check/);
  assert.match(contributing, /安全漏洞[\s\S]*Security Policy/);
  assert.match(contributing, /不要提交[\s\S]*API key[\s\S]*node_modules/);
  assert.doesNotMatch(contributing, /公开发布历史|候选公开历史|OPEN_SOURCE_RELEASE/);
});

test('current documentation rejects legacy and proprietary positioning', () => {
  const currentDocs = [
    'README.md',
    'docs/DEPLOYMENT.md',
    'docs/API.md',
    'docs/OPEN_SOURCE_RELEASE.md',
    'SECURITY.md',
    'CONTRIBUTING.md',
  ];
  const text = currentDocs.map((relativePath) => readRoot(relativePath)).join('\n');

  assert.doesNotMatch(text, /gendrama\.com|sendman\.cn|Node(?:\.js)?\s*16|MySQL\s*5\.7/i);
  assert.doesNotMatch(text, /下线归档|archive[- ]only|archived product/i);
});

test('deployment, API, security, and release documents state their required contracts', () => {
  const deployment = readRoot('docs/DEPLOYMENT.md');
  const api = readRoot('docs/API.md');
  const security = readRoot('SECURITY.md');
  const release = readRoot('docs/OPEN_SOURCE_RELEASE.md');

  for (const exactText of ['HTTPS', 'NODE_ENV=production', 'ALLOWED_ORIGINS', 'Apache-2.0', 'SeaweedFS 4.41', 'S3', 'schema_migrations', '/api/health']) {
    assert.ok(deployment.includes(exactText), `DEPLOYMENT must include: ${exactText}`);
  }
  assert.match(deployment, /SESSION_COOKIE_SECURE=true/);
  assert.match(deployment, /Docker Compose[\s\S]*SESSION_COOKIE_SECURE=false/);
  assert.match(deployment, /MySQL[\s\S]*S3[\s\S]*(不得|禁止)[\s\S]*(公开|公网)/);
  assert.match(deployment, /minio_data[\s\S]*object_storage_data[\s\S]*(不得|不属于受支持)/);
  assert.match(deployment, /(备份|backup)[\s\S]*(恢复|restore)/i);
  assert.match(deployment, /(租约|lease)[\s\S]*(日志|log)[\s\S]*(资源|内存|CPU)/i);
  assert.match(deployment, /Docker[\s\S]*根[\s\S]*`\.env`[\s\S]*host[\s\S]*`server\/\.env`/i);
  assert.match(deployment, /非空[\s\S]*(环境变量|environment)[\s\S]*(优先|覆盖)[\s\S]*(UI|数据库)/i);

  for (const exactText of ['POST /api/auth/login', 'GET /api/health', 'X-CSRF-Token', 'Idempotency-Key', '/api/events', '.docx', '.txt']) {
    assert.ok(api.includes(exactText), `API must include: ${exactText}`);
  }
  assert.match(api, /知识库[\s\S]*(仅|只)[\s\S]*\.docx[\s\S]*\.txt/);
  assert.match(api, /管理员[\s\S]*(边界|权限)/);
  assert.match(api, /(400|401)[\s\S]*403[\s\S]*411[\s\S]*413[\s\S]*429[\s\S]*(500|503)/);

  assert.match(security, /GitHub Security Advisories/i);
  assert.match(security, /(目标|target)[\s\S]*(不是保证|不保证|not a guarantee)/i);
  assert.match(security, /(不要|不得|do not)[\s\S]*(公开|public)[\s\S]*(漏洞|vulnerabilit)/i);
  assert.match(security, /(不要|不得|do not)[\s\S]*(发布|公开|post)[\s\S]*(凭据|credential)/i);

  assert.match(release, /仓库内可完成/);
  assert.match(release, /外部负责人/);
  assert.match(release, /Gemini[\s\S]*数据库[\s\S]*MinIO[\s\S]*JWT[\s\S]*管理员/);
  assert.match(release, /legacy MySQL 8/i);
  assert.match(release, /Docker Compose[\s\S]*(build|构建)[\s\S]*(health|健康)[\s\S]*e2e/i);
  assert.match(release, /gitleaks[\s\S]*(工作树|working tree)[\s\S]*(候选公开历史|candidate public history)/i);
  assert.match(release, /(干净快照|clean snapshot)[\s\S]*(新仓库|new repository)/i);
  assert.match(release, /(禁止|不得|不要)[\s\S]*(force[- ]push|强制推送|重写历史)/i);
  assert.match(release, /(负责人|owner)[\s\S]*(授权|authorization)[\s\S]*(默认分支|default branch)/i);
});

test('license and package metadata remain valid without enabling npm publication', () => {
  const license = readRoot('LICENSE');
  const packageJson = JSON.parse(readRoot('package.json'));

  assert.match(license, /^MIT License/m);
  assert.match(license, /Copyright \(c\) 2026 JCC Factory contributors/);
  assert.match(license, /Permission is hereby granted, free of charge/);
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.license, 'MIT');
  assert.equal(packageJson.repository?.url, 'https://github.com/AranLiu/jcc-factory.git');
  assert.equal(packageJson.bugs?.url, 'https://github.com/AranLiu/jcc-factory/issues');
  assert.equal(packageJson.homepage, 'https://github.com/AranLiu/jcc-factory#readme');
  assert.doesNotMatch(packageJson.description, /[鍓ф煷鏌鐭墽鏈伐]/);
});
