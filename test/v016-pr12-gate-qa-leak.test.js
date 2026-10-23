'use strict';
// Cổng vòng 5 của PR #12, nguồn: harness rò rỉ v3 của QA, 39 ca
// (/workspace/qa-review/pr-tests/pr12-v3/ev/leak.js). Giữ nguyên đầu vào, nơi kiểm và kỳ vọng.
// Giá trị giả có dấu 'zq', không có khoá thật hay tệp fixture.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('../src/plugins');
const LOG = require('../src/logger');
const redact = LOG.redact || (LOG._test && LOG._test.redact);
const fakeSafe = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString: (s) => Buffer.from('ENC' + Buffer.from(s).toString('hex')),
  decryptString: (b) => Buffer.from(String(b).slice(3), 'hex').toString(),
};
const S = (n) => `zq${n}secretval`;
const cases = [
  ['flag-space --token X', { command: 'npx', args: ['-y', 'srv@1.0.0', '--token', S('a')] }, [S('a')]],
  ['flag-eq --token=X', { command: 'npx', args: ['-y', 'srv@1.0.0', '--token=' + S('b')] }, [S('b')]],
  ['short -k X', { command: 'npx', args: ['-y', 'srv@1.0.0', '-k', S('c')] }, [S('c')]],
  ['--api-key X', { command: 'npx', args: ['srv@1.0.0', '--api-key', 'mysecretpassword'] }, ['mysecretpassword']],
  ['--password X', { command: 'uvx', args: ['srv==1.0', '--password', 'hunterzqpw'] }, ['hunterzqpw']],
  ['-p X (short password)', { command: 'uvx', args: ['mysql-mcp==1.0', '-u', 'root', '-p', 'zqshortpw'] }, ['zqshortpw']],
  ['-pX glued (mysql style)', { command: 'uvx', args: ['mysql-mcp==1.0', '-pzqgluedpw'] }, ['zqgluedpw']],
  ['--header "Authorization: Bearer X" (mcp-remote)', { command: 'npx', args: ['mcp-remote@0.1.0', 'https://api.example.com/mcp', '--header', 'Authorization: Bearer zqbearertok'] }, ['zqbearertok']],
  ['--header=Authorization:Bearer X', { command: 'npx', args: ['mcp-remote@0.1.0', 'https://api.example.com/mcp', '--header=Authorization:Bearer zqbearer2'] }, ['zqbearer2']],
  ['--header "X-API-Key: X"', { command: 'npx', args: ['mcp-remote@0.1.0', 'https://api.example.com/mcp', '--header', 'X-API-Key: zqxapikeyhdr'] }, ['zqxapikeyhdr']],
  ['docker -e NAME=X', { command: 'docker', args: ['run', '-i', '--rm', '-e', 'GITHUB_TOKEN=zqdockerenvtok', 'ghcr.io/github/github-mcp-server:v1'] }, ['zqdockerenvtok']],
  ['docker --env=NAME=X', { command: 'docker', args: ['run', '-i', '--env=SLACK_TOKEN=zqdockerenv2', 'img:1'] }, ['zqdockerenv2']],
  ['url query ?key=', { url: 'https://api.example.com/mcp?key=zqquerykey' }, ['zqquerykey']],
  ['url query ?api_key= ?access_token=', { url: 'https://api.example.com/mcp?api_key=zqq1&access_token=zqq2' }, ['zqq1', 'zqq2']],
  ['url userinfo u:p@', { url: 'https://user:zquserpw@api.example.com/mcp' }, ['zquserpw']],
  ['url userinfo + query (lead example)', { url: 'https://u:zqp9@host.example.com/?key=zqk9' }, ['zqp9', 'zqk9']],
  ['url token-as-username (https://TOKEN@host)', { url: 'https://zqtokenuser@api.example.com/mcp' }, ['zqtokenuser']],
  ['url fragment #access_token=', { url: 'https://api.example.com/mcp#access_token=zqfragtok' }, ['zqfragtok']],
  ['url query name not in list ?client_id=&code=&jwt=', { url: 'https://api.example.com/mcp?jwt=zqjwtval&session=zqsessval&private_token=zqgitlab' }, ['zqjwtval', 'zqsessval', 'zqgitlab']],
  ['url query ?x-api-key= / ?apiKey= / ?ApiKey=', { url: 'https://a.example.com/?x-api-key=zqxak&apiKey=zqak2' }, ['zqxak', 'zqak2']],
  ['url path token (Slack/Discord webhook)', { command: 'npx', args: ['notify-mcp@1.0.0', 'https://hooks.slack.com/services/T000/B000/zqwebhookpath'] }, ['zqwebhookpath']],
  ['url in arg with query', { command: 'npx', args: ['mcp-remote@0.1.0', 'https://api.example.com/mcp?token=zqargquery'] }, ['zqargquery']],
  ['url in arg with userinfo', { command: 'npx', args: ['pg-mcp@1.0.0', 'postgresql://admin:zqpgpass@db.local/app'] }, ['zqpgpass']],
  ['percent-encoded pw in userinfo', { url: 'https://u:zq%40enc%2Fpw@h.example.com/' }, ['zq@enc/pw', 'zq%40enc%2Fpw']],
  ['env MY_APPID short', { command: 'npx', args: ['srv@1.0.0'], env: { MY_APPID: 'shortid99' } }, ['shortid99']],
  ['env PAT', { command: 'npx', args: ['srv@1.0.0'], env: { GH_PAT: 'zqpatval' } }, ['zqpatval']],
  ['env DSN (sentry token-as-user)', { command: 'npx', args: ['srv@1.0.0'], env: { SENTRY_DSN: 'https://zqdsnkey@o1.ingest.sentry.io/1' } }, ['zqdsnkey']],
  ['env DATABASE_URL u:p@', { command: 'npx', args: ['srv@1.0.0'], env: { DATABASE_URL: 'postgres://u:zqdburlpw@h/db' } }, ['zqdburlpw']],
  ['env CONNECTION_STRING Password=', { command: 'npx', args: ['srv@1.0.0'], env: { MSSQL_CONNECTION: 'Server=h;User Id=sa;Password=zqconnpw;' } }, ['zqconnpw']],
  ['env COOKIE', { command: 'npx', args: ['srv@1.0.0'], env: { SESSION_COOKIE: 'zqcookieval' } }, ['zqcookieval']],
  ['env lowercase name', { command: 'npx', args: ['srv@1.0.0'], env: { api_token: 'zqlowenv' } }, ['zqlowenv']],
  ['env unicode/odd name', { command: 'npx', args: ['srv@1.0.0'], env: { 'X-Auth': 'zqoddenv', 'tOkEn_2': 'zqmixcase' } }, ['zqoddenv', 'zqmixcase']],
  ['env BEARER / JWT / OTP / PIN', { command: 'npx', args: ['srv@1.0.0'], env: { BEARER: 'zqbearenv', JWT: 'zqjwtenv', TOTP_SEED: 'zqtotp', PIN: 'zqpin1' } }, ['zqbearenv', 'zqjwtenv', 'zqtotp', 'zqpin1']],
  ['header Authorization Basic', { url: 'https://a.example.com/mcp', headers: { Authorization: 'Basic enFiYXNpYzpwdw==' } }, ['enFiYXNpYzpwdw==']],
  ['header custom X-Goog-Api-Key', { url: 'https://a.example.com/mcp', headers: { 'X-Goog-Api-Key': 'zqgoog' } }, ['zqgoog']],
  ['header Cookie', { url: 'https://a.example.com/mcp', headers: { Cookie: 'sid=zqcookiehdr' } }, ['zqcookiehdr']],
  ['--token then flag-looking value', { command: 'npx', args: ['srv@1.0.0', '--token', '-zqdashtok'] }, ['-zqdashtok']],
  ['--secret-file path (not secret)', { command: 'npx', args: ['srv@1.0.0', '--port', '8080', '--secret-file', '/home/u/.s'] }, []],
  ['control: NODE_ENV & --port', { command: 'npx', args: ['srv@1.0.0', '--port', '8080'], env: { NODE_ENV: 'production' } }, []],
];
const tmpDirs = [];
test.after(() => { for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

test('[QA v3 leak] bộ ca có đúng 39 ca', () => { assert.strictEqual(cases.length, 39); });

for (const [label, def, secrets] of cases) {
  test('[QA v3 leak] ' + label, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p12v3-'));
    tmpDirs.push(dir);
    const store = P.createSecretStore({ dir, safeStorage: fakeSafe });
    const cfg = { mcpServers: { s1: JSON.parse(JSON.stringify(def)) } };
    const peek = P.extractSecrets(cfg, null).count;
    const ex = P.extractSecrets(cfg, store);
    const saved = JSON.stringify(ex.cfg);
    P.secretFindings(def); // harness gốc gọi hàm này; giữ để cùng đường chạy
    const savedDef = ex.cfg.mcpServers.s1;
    const card = store.maskDeep(P.cardMcpConnect('s1', savedDef, store));
    const cardRaw = store.maskDeep(P.cardMcpConnect('s1', def, store));
    const cardTxt = JSON.stringify(card), cardRawTxt = JSON.stringify(cardRaw);
    const cmdline = def.url ? def.url : `Chạy: ${def.command} ${(def.args || []).join(' ')}`;
    const logScrub = store.mask(cmdline);
    const logRedact = redact ? redact(cmdline) : '(no redact export)';
    const store2 = P.createSecretStore({ dir, safeStorage: fakeSafe });
    const logScrub2 = store2.mask(cmdline);
    const where = [];
    for (const v of secrets) {
      if (saved.includes(v)) where.push('mcp.json');
      if (cardTxt.includes(v)) where.push('card');
      if (cardRawTxt.includes(v)) where.push('cardRaw');
      if (logScrub.includes(v)) where.push('log(scrub)');
      if (logScrub2.includes(v)) where.push('log(after-restart)');
      if (String(logRedact).includes(v)) where.push('LOG.redact(crash)');
    }
    assert.deepStrictEqual([...new Set(where)], [], 'LEAK expect=' + secrets.length + ' moved=' + ex.count);
    // Harness gốc đánh dấu COUNT-MISMATCH khi đếm thử (không store) khác số đã chuyển.
    assert.strictEqual(peek, ex.count, 'COUNT-MISMATCH peek=' + peek + ' moved=' + ex.count);
  });
}
