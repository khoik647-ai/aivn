const SV = require(process.argv[2] + '/src/agent/send-verify');
const t = (q) => { const s = Date.now(); const r = SV.recipientOf(q); return `${Date.now() - s}ms len=${q.length} -> ${JSON.stringify(String(r).slice(0, 30))}`; };
for (const n of [1000, 4000, 16000]) {
  console.log('và-chain', t('gửi thư cho Lan ' + 'và Minh '.repeat(n / 8)));
  console.log('letters ', t('gửi thư cho Lan và ' + 'a'.repeat(n)));
  console.log('spaces  ', t('gửi thư cho Lan và Minh' + ' '.repeat(n) + 'x'));
  console.log('words   ', t('gửi thư cho Lan và ' + 'ab '.repeat(n / 3) + '!'));
  console.log('apost   ', t('gửi thư cho Lan và ' + "a'".repeat(n / 2) + '!'));
}
