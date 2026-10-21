// tiến trình "chính" giả: tạo engine-host thật, bảo nó mở llama-server (giả), in pid rồi chờ bị giết
const A = require('path').join(__dirname, '..', '..', '..', 'src') + '/';
const { createEngineProxy } = require(A + 'engine-proxy');
const ORPH = require(A + 'orphans'); const pidFile = ORPH.createPidFile(process.argv[2]);
const eng = createEngineProxy({ nodePath: process.execPath, hostScript: A + 'engine-host.js', pidFile, log: () => {} });
eng.groundLoad('g', '/tmp/none.gguf', null, { gpu: false }).then(() => { console.log('READY ' + JSON.stringify(pidFile.list())); setInterval(() => {}, 1000); }, (e) => { console.log('ERR ' + e.message); process.exit(1); });
