'use strict';
// QA vòng 3 + quy tắc tách từ. Mọi giá trị giả dựng lúc chạy, không có tiền tố khoá liền nhau trong nguồn.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const PG = require('../src/plugins');
const LOG = require('../src/logger');

function S(n) { return 'zq' + n + 'secretval'; }
const PFX = {
  sk: ['sk', '-'].join(''),
  ghp: ['gh', 'p_'].join(''),
  pat: ['github', '_pat_'].join(''),
  xoxb: ['xo', 'xb', '-'].join(''),
  xoxp: ['xo', 'xp', '-'].join(''),
  akia: ['AK', 'IA'].join(''),
  hf: ['h', 'f_'].join(''),
  stripe: ['sk', '_', 'li', 've_'].join(''),
};
function pemHeader() {
  return ['-----', 'BEGIN', ' ', 'RSA', ' ', 'PRIVATE', ' KEY', '-----'].join('');
}
function pemEnd() {
  return ['-----', 'END', ' ', 'RSA', ' ', 'PRIVATE', ' KEY', '-----'].join('');
}
function pemBlock() {
  return pemHeader() + '\n' + 'Ab9'.repeat(24) + '\n' + pemEnd();
}
function aws40() {
  const alph = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < 40; i++) s += alph[(i * 7 + 3) % alph.length];
  return s.slice(0, 18) + '/' + s.slice(19);
}
function eyJwt() {
  const alph = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const seg = (n, salt) => { let s = ''; for (let i = 0; i < n; i++) s += alph[(i * 5 + salt) % alph.length]; return s; };
  return 'eyJ' + seg(24, 2) + '.' + seg(28, 4) + '.' + seg(28, 6);
}
const ALPHA = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const HEX = '0123456789abcdef';
function chunk(i, n, alphabet = ALPHA) {
  const step = 2 * i + 1;
  let s = '';
  for (let k = 0; k < n; k++) s += alphabet[(i * 7 + k * step) % alphabet.length];
  return s;
}
function withMark(i, n, index, mark) {
  const chars = chunk(i, n).split('');
  chars[index] = mark;
  return chars.join('');
}
function matrixKeys() {
  return {
    jwt: [chunk(10, 36), chunk(11, 44), chunk(12, 43)].join('.'),
    appid: chunk(16, 32, HEX),
    hex32: chunk(17, 32, HEX),
    splitkey: withMark(18, 16, 8, '_'),
    owmid: chunk(19, 32, HEX),
    tele: chunk(20, 10, '0123456789') + ':' + chunk(21, 34),
    dbpw: withMark(22, 14, 7, '!'),
    hdrapikey: chunk(24, 9),
    nested: chunk(27, 16),
  };
}

const LEGACY = [
  ['flag-space --token X', { command: 'npx', args: ['-y', 'srv@1.0.0', '--token', S('a')] }, [S('a')]],
  ['flag-eq --token=X', { command: 'npx', args: ['-y', 'srv@1.0.0', '--token=' + S('b')] }, [S('b')]],
  ['short -k X', { command: 'npx', args: ['-y', 'srv@1.0.0', '-k', S('c')] }, [S('c')]],
  ['--api-key X', { command: 'npx', args: ['srv@1.0.0', '--api-key', 'mysecretpassword'] }, ['mysecretpassword']],
  ['--password X', { command: 'uvx', args: ['srv==1.0', '--password', 'hunterzqpw'] }, ['hunterzqpw']],
  ['-p X', { command: 'uvx', args: ['mysql-mcp==1.0', '-u', 'root', '-p', 'zqshortpw'] }, ['zqshortpw']],
  ['-pX glued', { command: 'uvx', args: ['mysql-mcp==1.0', '-pzqgluedpw'] }, ['zqgluedpw']],
  ['--header Bearer', { command: 'npx', args: ['mcp-remote@0.1.0', 'https://api.example.com/mcp', '--header', 'Authorization: Bearer zqbearertok'] }, ['zqbearertok']],
  ['--header=Authorization:Bearer', { command: 'npx', args: ['mcp-remote@0.1.0', 'https://api.example.com/mcp', '--header=Authorization:Bearer zqbearer2'] }, ['zqbearer2']],
  ['--header X-API-Key', { command: 'npx', args: ['mcp-remote@0.1.0', 'https://api.example.com/mcp', '--header', 'X-API-Key: zqxapikeyhdr'] }, ['zqxapikeyhdr']],
  ['docker -e', { command: 'docker', args: ['run', '-i', '--rm', '-e', 'GITHUB_TOKEN=zqdockerenvtok', 'ghcr.io/github/github-mcp-server:v1'] }, ['zqdockerenvtok']],
  ['docker --env=', { command: 'docker', args: ['run', '-i', '--env=SLACK_TOKEN=zqdockerenv2', 'img:1'] }, ['zqdockerenv2']],
  ['?key=', { url: 'https://api.example.com/mcp?key=zqquerykey' }, ['zqquerykey']],
  ['?api_key&access_token', { url: 'https://api.example.com/mcp?api_key=zqq1&access_token=zqq2' }, ['zqq1', 'zqq2']],
  ['userinfo', { url: 'https://user:zquserpw@api.example.com/mcp' }, ['zquserpw']],
  ['userinfo+query', { url: 'https://u:zqp9@host.example.com/?key=zqk9' }, ['zqp9', 'zqk9']],
  ['token-as-username', { url: 'https://zqtokenuser@api.example.com/mcp' }, ['zqtokenuser']],
  ['#access_token', { url: 'https://api.example.com/mcp#access_token=zqfragtok' }, ['zqfragtok']],
  ['jwt/session/private_token', { url: 'https://api.example.com/mcp?jwt=zqjwtval&session=zqsessval&private_token=zqgitlab' }, ['zqjwtval', 'zqsessval', 'zqgitlab']],
  ['x-api-key/apiKey', { url: 'https://a.example.com/?x-api-key=zqxak&apiKey=zqak2' }, ['zqxak', 'zqak2']],
  ['slack webhook path', { command: 'npx', args: ['notify-mcp@1.0.0', 'https://hooks.slack.com/services/T000/B000/zqwebhookpath'] }, ['zqwebhookpath']],
  ['url arg query', { command: 'npx', args: ['mcp-remote@0.1.0', 'https://api.example.com/mcp?token=zqargquery'] }, ['zqargquery']],
  ['url arg userinfo', { command: 'npx', args: ['pg-mcp@1.0.0', 'postgresql://admin:zqpgpass@db.local/app'] }, ['zqpgpass']],
  ['pct-encoded userinfo', { url: 'https://u:zq%40enc%2Fpw@h.example.com/' }, ['zq@enc/pw', 'zq%40enc%2Fpw']],
  ['MY_APPID', { command: 'npx', args: ['srv@1.0.0'], env: { MY_APPID: 'shortid99' } }, ['shortid99']],
  ['GH_PAT', { command: 'npx', args: ['srv@1.0.0'], env: { GH_PAT: 'zqpatval' } }, ['zqpatval']],
  ['SENTRY_DSN', { command: 'npx', args: ['srv@1.0.0'], env: { SENTRY_DSN: 'https://zqdsnkey@o1.ingest.sentry.io/1' } }, ['zqdsnkey']],
  ['DATABASE_URL', { command: 'npx', args: ['srv@1.0.0'], env: { DATABASE_URL: 'postgres://u:zqdburlpw@h/db' } }, ['zqdburlpw']],
  ['Password= connstr', { command: 'npx', args: ['srv@1.0.0'], env: { MSSQL_CONNECTION: 'Server=h;User Id=sa;Password=zqconnpw;' } }, ['zqconnpw']],
  ['SESSION_COOKIE', { command: 'npx', args: ['srv@1.0.0'], env: { SESSION_COOKIE: 'zqcookieval' } }, ['zqcookieval']],
  ['api_token lower', { command: 'npx', args: ['srv@1.0.0'], env: { api_token: 'zqlowenv' } }, ['zqlowenv']],
  ['odd names', { command: 'npx', args: ['srv@1.0.0'], env: { 'X-Auth': 'zqoddenv', tOkEn_2: 'zqmixcase' } }, ['zqoddenv', 'zqmixcase']],
  ['BEARER/JWT/TOTP/PIN', { command: 'npx', args: ['srv@1.0.0'], env: { BEARER: 'zqbearenv', JWT: 'zqjwtenv', TOTP_SEED: 'zqtotp', PIN: 'zqpin1' } }, ['zqbearenv', 'zqjwtenv', 'zqtotp', 'zqpin1']],
  ['Basic hdr', { url: 'https://a.example.com/mcp', headers: { Authorization: 'Basic enFiYXNpYzpwdw==' } }, ['enFiYXNpYzpwdw==']],
  ['X-Goog-Api-Key', { url: 'https://a.example.com/mcp', headers: { 'X-Goog-Api-Key': 'zqgoog' } }, ['zqgoog']],
  ['Cookie hdr', { url: 'https://a.example.com/mcp', headers: { Cookie: 'sid=zqcookiehdr' } }, ['zqcookiehdr']],
  ['--token -dash', { command: 'npx', args: ['srv@1.0.0', '--token', '-zqdashtok'] }, ['-zqdashtok']],
  ['--secret-file (not secret)', { command: 'npx', args: ['srv@1.0.0', '--port', '8080', '--secret-file', '/home/u/.s'] }, []],
  ['control', { command: 'npx', args: ['srv@1.0.0', '--port', '8080'], env: { NODE_ENV: 'production' } }, []],
];

function b64Blob() {
  return Buffer.from(JSON.stringify({ apiKey: 'QaB64Inner7xY2pL9' }), 'utf8').toString('base64');
}
function v3Cases() {
  const b64 = b64Blob();
  const aws = aws40();
  const jwt = eyJwt();
  return [
    ['b64 arg', { command: 'qa-bin', args: ['--config-b64', b64] }, [b64, 'QaB64Inner7xY2pL9']],
    ['b64 env', { command: 'qa-bin', args: ['run'], env: { QA_CONFIG: b64 } }, [b64, 'QaB64Inner7xY2pL9']],
    ['bearer-lower', { command: 'qa-bin', args: ['run'], env: { QA_HDR: 'bearer QaLowBearer9xK2mP7' } }, ['QaLowBearer9xK2mP7']],
    ['bearer-upper', { url: 'https://h.example/mcp', headers: { 'X-Forward': 'BEARER QaUpBearer9xK2mP7zz' } }, ['QaUpBearer9xK2mP7zz']],
    ['bearer-mixed', { command: 'qa-bin', args: ['--header', 'authorization: bEaReR QaMixBearer55'] }, ['QaMixBearer55']],
    ['split --api key', { command: 'qa-bin', args: ['--api', 'key', 'QaSplitAcross77'] }, ['QaSplitAcross77']],
    ['split --token halves', { command: 'qa-bin', args: ['--token', 'QaFirstHalf', 'QaSecondHalf'] }, ['QaFirstHalf']],
    ['urlenc names', { url: 'https://a.example/mcp?api%5Fkey=QaEnc1&tok%65n=QaEnc2' }, ['QaEnc1', 'QaEnc2']],
    ['urlenc value', { url: 'https://a.example/mcp?token=Qa%2FEnc%2BVal%3D3' }, ['Qa%2FEnc%2BVal%3D3', 'Qa/Enc+Val=3']],
    ['docker -e', { command: 'docker', args: ['run', '-e', 'GITHUB_TOKEN=QaDockE1x', 'img'] }, ['QaDockE1x']],
    ['docker --env space', { command: 'docker', args: ['run', '--env', 'SLACK_TOKEN=QaDockE2x', 'img'] }, ['QaDockE2x']],
    ['uvx --env space', { command: 'uvx', args: ['pkg==1', '--env', 'OPENAI_API_KEY=QaUvxEnv3x'] }, ['QaUvxEnv3x']],
    ['uvx --env=', { command: 'uvx', args: ['pkg==1', '--env=HF_TOKEN=QaUvxEnv4x'] }, ['QaUvxEnv4x']],
    ['camel env', { command: 'qa-bin', args: ['run'], env: { apiToken: 'qacamelplain1', accessToken: 'qacamelplain2', clientSecret: 'qacamelplain3', privateKey: 'qacamelplain4' } }, ['qacamelplain1', 'qacamelplain2', 'qacamelplain3', 'qacamelplain4']],
    ['camel nested', { command: 'qa-bin', args: ['run'], options: { auth: { accessToken: 'qanestcamel5', refreshToken: 'qanestcamel6' } } }, ['qanestcamel5', 'qanestcamel6']],
    ['aws40 positional', { command: 'qa-bin', args: ['--region', 'eu', aws] }, [aws]],
    ['jwt positional', { command: 'qa-bin', args: ['--session', jwt] }, [jwt]],
    ['discord webhook', { command: 'qa-bin', args: ['https://discord.com/api/webhooks/123/zqdiscordtok'] }, ['zqdiscordtok']],
  ];
}

function fakeSafe() {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (s) => Buffer.from('ENC' + Buffer.from(String(s)).toString('hex')),
    decryptString: (b) => Buffer.from(String(b).slice(3), 'hex').toString(),
  };
}
function cmdlineOf(def, rich) {
  const base = def.url ? String(def.url) : `Chạy: ${def.command || ''} ${(def.args || []).join(' ')}`.trim();
  if (!rich) return base;
  return base + ' ' + JSON.stringify(def.env || {}) + ' ' + JSON.stringify(def.options || {}) + ' ' + JSON.stringify(def.headers || {});
}
function leaksOf(texts, needles) {
  const where = [];
  texts.forEach((text, i) => {
    const s = String(text);
    for (const n of needles) if (n && s.includes(n)) where.push(i + ':' + n);
  });
  return where;
}
function checkDef(def, needles, { rich = false, keep = [] } = {}) {
  const cfg = { mcpServers: { s1: def } };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-qav3-'));
  const store = PG.createSecretStore({ dir, safeStorage: fakeSafe() });
  const bare = PG.extractSecrets(JSON.parse(JSON.stringify(cfg)), null);
  const moved = PG.extractSecrets(JSON.parse(JSON.stringify(cfg)), store);
  assert.equal(bare.count, moved.count, 'peek khác store');
  const line = cmdlineOf(def, rich);
  const store2 = PG.createSecretStore({ dir, safeStorage: fakeSafe() });
  const savedDef = moved.cfg.mcpServers.s1;
  const texts = [
    JSON.stringify(moved.cfg),
    JSON.stringify(store.maskDeep(PG.cardMcpConnect('s1', savedDef, store))),
    JSON.stringify(store.maskDeep(PG.cardMcpConnect('s1', def, store))),
    store.mask(line),
    store2.mask(line),
    LOG.redact(line),
  ];
  const where = leaksOf(texts, needles);
  for (const k of keep) assert.equal(JSON.stringify(moved.cfg).includes(k), true, 'mất ' + k);
  return { count: moved.count, where, texts };
}

test('điều kiện 1: danh sách từ, mọi kiểu tên', () => {
  const words = ['key', 'apikey', 'token', 'secret', 'pass', 'password', 'passwd', 'pwd', 'auth', 'authorization', 'bearer', 'credential', 'credentials', 'cookie', 'session', 'jwt', 'pat', 'dsn', 'private', 'signature', 'sig', 'otp', 'totp', 'pin'];
  for (const w of words) {
    assert.equal(PG.isSecretName(w), true, w);
    assert.equal(PG.isSecretName(w.toUpperCase()), true, w.toUpperCase());
    assert.equal(PG.isSecretName('X_' + w), true, 'X_' + w);
    assert.equal(PG.isSecretName('x-' + w), true, 'x-' + w);
    console.log(`| word ${w} | secret |`);
  }
  assert.equal(PG.isSecretName('appid'), true);
  assert.equal(PG.isSecretName('MY_APPID'), true);
  assert.equal(PG.isSecretName('authentication'), true);
});

test('điều kiện 2: tên dính nhau bị che; AUTHOR, KEYBOARD không; số nhiều và passphrase là bí mật', () => {
  const joined = ['apitoken', 'accesstoken', 'authtoken', 'clientsecret', 'xapikey', 'APIKEY'];
  const value = 'joinedval99';
  for (const name of joined) {
    assert.equal(PG.isSecretName(name), true, name);
    const r = checkDef({ command: 'qa-bin', args: ['run'], env: { [name]: value } }, [value]);
    assert.equal(r.where.length, 0, name + ' ' + r.where.join(','));
    console.log(`| joined ${name} | masked |`);
  }
  for (const name of ['AUTHOR', 'KEYBOARD', 'KEYBOARD_LAYOUT']) {
    assert.equal(PG.isSecretName(name), false, name);
    console.log(`| ${name} | not secret |`);
  }
  assert.equal(PG.isSecretName('MAX_TOKENS'), true);
  assert.equal(PG.isSecretName('tokens'), true);
  assert.equal(PG.isSecretName('keys'), true);
  assert.equal(PG.isSecretName('secrets'), true);
  assert.equal(PG.isSecretName('PASSPHRASE'), true);
  assert.equal(PG.isSecretName('passphrase'), true);
  console.log('| MAX_TOKENS | secret name, int exempt |');
});

test('điều kiện 3: ngoại lệ giá trị, số 8 chữ số vẫn che, đường dẫn chỉ khi giống path', () => {
  const keep = [
    ['empty', { API_KEY: '' }, ''],
    ['true', { API_KEY: 'true' }, 'true'],
    ['false', { API_KEY: 'false' }, 'false'],
    ['none', { AUTH: 'none' }, 'none'],
    ['int7', { TOKEN: '1234567' }, '1234567'],
    ['file abs', { SECRET_FILE: '/home/u/.s' }, '/home/u/.s'],
    ['file dot', { SECRET_FILE: './tok' }, './tok'],
    ['file parent', { TOKEN_PATH: '../tok' }, '../tok'],
    ['file home', { TOKEN_PATH: '~/tok' }, '~/tok'],
    ['file drive', { SECRET_FILE: 'C:\\tok' }, 'C:\\tok'],
    ['file sep', { SECRET_FILE: 'dir/file.txt' }, 'dir/file.txt'],
  ];
  for (const [label, env, needle] of keep) {
    const r = checkDef({ command: 'qa-bin', args: ['run'], env }, needle ? [needle] : []);
    assert.equal(r.count, 0, label + ' bị chuyển');
    if (needle) assert.equal(JSON.parse(r.texts[0]).mcpServers.s1.env[Object.keys(env)[0]], needle, label);
    console.log(`| exception ${label} | kept |`);
  }
  const masked = [
    ['int8', { API_KEY: '12345678' }, '12345678'],
    ['file word', { SECRET_FILE: 'hunter2' }, 'hunter2'],
    ['path word', { TOKEN_PATH: 'not-a-path' }, 'not-a-path'],
  ];
  for (const [label, env, needle] of masked) {
    const r = checkDef({ command: 'qa-bin', args: ['run'], env }, [needle]);
    assert.equal(r.where.length, 0, label + ' ' + r.where.join(','));
    assert.ok(r.count >= 1, label);
    console.log(`| exception ${label} | masked |`);
  }
});

test('điều kiện 4: bộ dò theo giá trị, không phụ thuộc tên', () => {
  const rows = [
    ['NOTE sk', 'NOTE', PFX.sk + 'proj-' + 'aB3'.repeat(8)],
    ['author ghp', 'author', PFX.ghp + 'cD4'.repeat(8)],
    ['TITLE pat', 'TITLE', PFX.pat + 'eF5'.repeat(8)],
    ['NOTE xoxb', 'NOTE', PFX.xoxb + '111' + '-' + '222' + '-' + 'abC9'.repeat(6)],
    ['NOTE xoxp', 'NOTE', PFX.xoxp + '111' + '-' + '222' + '-' + 'abC9'.repeat(6)],
    ['NOTE akia', 'NOTE', PFX.akia + 'A1B2C3D4E5F6G7H8'],
    ['NOTE jwt', 'NOTE', eyJwt()],
    ['NOTE pem', 'NOTE', pemBlock()],
    ['NOTE hf', 'NOTE', PFX.hf + 'aB3'.repeat(8)],
    ['NOTE stripe', 'NOTE', PFX.stripe + 'aB3'.repeat(8)],
  ];
  for (const [label, name, value] of rows) {
    assert.equal(PG.isSecretName(name), false, label);
    const r = checkDef({ command: 'qa-bin', args: ['run'], env: { [name]: value } }, [value], { rich: true });
    assert.equal(r.where.length, 0, label + ' ' + r.where.join(','));
    console.log(`| value ${label} | masked |`);
  }
  assert.equal(PG.likelySecretValue(pemHeader()), false);
  assert.equal(PG.likelySecretValue(pemBlock()), true);
});

test('A: 39 ca QA cũ không lọt', () => {
  let leaks = 0;
  for (const [label, def, needles] of LEGACY) {
    const keep = label.startsWith('--secret-file') ? ['/home/u/.s', '8080'] : label === 'control' ? ['production', '8080'] : [];
    const r = checkDef(def, needles, { keep });
    if (!needles.length) assert.equal(r.count, 0, label);
    if (r.where.length) leaks++;
    console.log(`| A ${label} | ${r.where.length ? 'FAIL ' + r.where.join(',') : 'PASS'} |`);
    assert.equal(r.where.length, 0, label);
  }
  console.log(`| A leaks | ${leaks} |`);
  assert.equal(LEGACY.length, 39);
});

test('B: biến thể v3 không lọt, kể cả nhật ký có env và options', () => {
  let leaks = 0;
  const cases = v3Cases();
  for (const [label, def, needles] of cases) {
    const r = checkDef(def, needles, { rich: true });
    if (r.where.length) leaks++;
    console.log(`| B ${label} | ${r.where.length ? 'FAIL ' + r.where.join(',') : 'PASS'} |`);
    assert.equal(r.where.length, 0, label);
  }
  const top = { settings: { apiKey: 'qatopnested7' }, mcpServers: { a: { command: 'qa-bin', args: ['run'] } } };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-qav3-'));
  const store = PG.createSecretStore({ dir, safeStorage: fakeSafe() });
  const bare = PG.extractSecrets(JSON.parse(JSON.stringify(top)), null);
  const moved = PG.extractSecrets(JSON.parse(JSON.stringify(top)), store);
  assert.equal(bare.count, moved.count);
  assert.equal(bare.count >= 1, true);
  const line = JSON.stringify(top);
  const where = leaksOf([
    JSON.stringify(moved.cfg),
    store.mask(line),
    PG.createSecretStore({ dir, safeStorage: fakeSafe() }).mask(line),
    LOG.redact(line),
  ], ['qatopnested7']);
  if (where.length) leaks++;
  console.log(`| B top-level nested | ${where.length ? 'FAIL' : 'PASS'} |`);
  assert.equal(where.length, 0);
  assert.equal(Object.hasOwn(moved.cfg, 'settings'), true);
  console.log(`| B leaks | ${leaks} |`);
});

test('bảng kiểu tên: một giá trị trên env, options, top-level, header, query, fragment, cờ và redact', () => {
  const styles = ['apiKey', 'api_key', 'API-KEY', 'ApiKey', 'x-api-key', 'accessToken', 'ACCESS_TOKEN', 'client-secret', 'dbPassword', 'DB_PASS', 'authToken', 'AUTH', 'Authorization'];
  const value = 'QaStyleSecret9';
  const surfaces = ['env', 'options', 'top', 'header', 'query', 'fragment', 'flag'];
  for (const style of styles) {
    const q = encodeURIComponent(style);
    const defs = {
      env: { command: 'qa-bin', args: ['run'], env: { [style]: value } },
      options: { command: 'qa-bin', args: ['run'], options: { [style]: value } },
      header: { url: 'https://h.example/mcp', headers: { [style]: value } },
      query: { url: 'https://h.example/mcp?' + q + '=' + value },
      fragment: { url: 'https://h.example/mcp#' + q + '=' + value },
      flag: { command: 'qa-bin', args: ['--' + style, value] },
    };
    for (const surface of surfaces) {
      if (surface === 'top') {
        const cfg = { [style]: value, mcpServers: { s1: { command: 'qa-bin', args: ['run'] } } };
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-qav3-'));
        const store = PG.createSecretStore({ dir, safeStorage: fakeSafe() });
        const moved = PG.extractSecrets(JSON.parse(JSON.stringify(cfg)), store);
        const line = JSON.stringify(cfg);
        const where = leaksOf([JSON.stringify(moved.cfg), store.mask(line), LOG.redact(line)], [value]);
        assert.equal(where.length, 0, style + ' top ' + where.join(','));
        continue;
      }
      const r = checkDef(defs[surface], [value], { rich: true });
      assert.equal(r.where.length, 0, style + ' ' + surface + ' ' + r.where.join(','));
    }
    console.log(`| style ${style} | masked |`);
  }
  console.log(`| styles | ${styles.length} x ${surfaces.length} |`);
});

test('bảng FP: tên không bí mật và ngoại lệ giá trị giữ nguyên', () => {
  const sha = 'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3';
  const model = 'Qwen3VL4BInstructQ4KM2025.gguf';
  const rows = [
    ['AUTHOR', { command: 'qa-bin', env: { AUTHOR: 'Khoi' }, args: ['run'] }, ['Khoi', 'AUTHOR']],
    ['KEYBOARD', { command: 'qa-bin', env: { KEYBOARD: 'us' }, args: ['run'] }, ['us']],
    ['KEYBOARD_LAYOUT', { command: 'qa-bin', env: { KEYBOARD_LAYOUT: 'us' }, args: ['run'] }, ['KEYBOARD_LAYOUT']],
    ['MAX_TOKENS int', { command: 'qa-bin', env: { MAX_TOKENS: '4096' }, args: ['run'] }, ['4096']],
    ['CLIENT_ID', { command: 'qa-bin', env: { CLIENT_ID: 'aivn-desktop' }, args: ['run'] }, ['aivn-desktop']],
    ['NODE_ENV', { command: 'qa-bin', env: { NODE_ENV: 'production' }, args: ['run'] }, ['production']],
    ['--auth none', { command: 'qa-bin', args: ['--auth', 'none'] }, ['none']],
    ['--auth false', { command: 'qa-bin', args: ['--auth', 'false'] }, ['false']],
    ['--max-tokens', { command: 'qa-bin', args: ['--max-tokens', '4096'] }, ['4096']],
    ['--secret-file', { command: 'qa-bin', args: ['--secret-file', '/home/khoi/.qa-token'] }, ['/home/khoi/.qa-token']],
    ['--port', { command: 'qa-bin', args: ['--port', '8080'] }, ['8080']],
    ['MODEL gguf', { command: 'qa-bin', env: { MODEL: model }, args: ['run'] }, [model]],
    ['GIT_SHA', { command: 'qa-bin', env: { GIT_SHA: sha }, args: ['run'] }, [sha]],
  ];
  for (const [label, def, needles] of rows) {
    const r = checkDef(def, [], { rich: true });
    assert.equal(r.count, 0, label);
    const blob = r.texts.join('\n');
    for (const n of needles) assert.equal(blob.includes(n), true, label + ' mất ' + n);
    const red = LOG.redact(JSON.stringify(def));
    for (const n of needles) assert.equal(red.includes(n), true, label + ' redact mất ' + n);
    console.log(`| FP ${label} | kept |`);
  }
  {
    const r = checkDef({ command: 'qa-bin', env: { MAX_TOKENS: 'not-an-integer' }, args: ['run'] }, ['not-an-integer'], { rich: true });
    assert.equal(r.where.length, 0, 'MAX_TOKENS text ' + r.where.join(','));
    assert.ok(r.count >= 1, 'MAX_TOKENS không phải số nhỏ phải bị che');
    console.log('| FP MAX_TOKENS text | masked |');
  }
  const lone = aws40().slice(0, 39);
  const loneCfg = { mcpServers: { lone: { command: 'qa-bin', args: [lone.replace('/', '/')] } } };
  const moved = PG.extractSecrets(loneCfg, null);
  assert.equal(moved.count, 0);
  console.log('| FP lone 39 aws | kept |');
});

test('C và D: redact ma trận và chữ tự do', () => {
  const K = matrixKeys();
  const rows = [
    ['jwt', K.jwt, K.jwt],
    ['owm', K.owmid, K.owmid],
    ['hex32', K.hex32, K.hex32],
    ['split', '--key ' + K.splitkey, K.splitkey],
    ['dburl', 'postgres://admin:' + K.dbpw + '@db.local/app', K.dbpw],
    ['hdr', 'X-API-Key: ' + K.hdrapikey, K.hdrapikey],
    ['nested', JSON.stringify({ options: { apiKey: K.nested } }), K.nested],
  ];
  for (const [label, line, needle] of rows) {
    assert.equal(LOG.redact(line).includes(needle), false, label);
    console.log(`| redact ${label} | masked |`);
  }
  const jwt = eyJwt();
  const aws = aws40();
  const tele = K.tele;
  const free = [
    ['auth bearer', 'Authorization: bearer QaFreeBearer1', 'QaFreeBearer1'],
    ['BEARER', 'x BEARER QaFreeBearer2', 'QaFreeBearer2'],
    ['jwt', 'jwt ' + jwt, jwt],
    ['aws', 'aws ' + aws, aws],
    ['tele', 'https://api.telegram.org/bot' + tele + '/x', tele.split(':')[1]],
  ];
  for (const [label, line, needle] of free) {
    assert.equal(LOG.redact(line).includes(needle), false, label);
    console.log(`| D ${label} | masked |`);
  }
  const trail = LOG.redact('url https://a.vn/?token=QaTokX1 then more text after the url');
  assert.equal(trail.includes('QaTokX1'), false);
  assert.equal(trail.includes('then more text after the url'), true);
  console.log('| D trailing | kept |');
  const sha = 'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3';
  assert.equal(LOG.redact('GIT_SHA=' + sha).includes(sha), true);
  assert.equal(LOG.redact('MODEL=Qwen3VL4BInstructQ4KM2025.gguf').includes('Qwen3VL4BInstructQ4KM2025.gguf'), true);
});
