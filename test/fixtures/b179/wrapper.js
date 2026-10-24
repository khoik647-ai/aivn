'use strict';
// giống npx: tiến trình cha sinh tiến trình con chạy máy chủ
const path = require('path');
const { spawn } = require('child_process');
spawn(process.execPath, [path.join(__dirname, '../mcp-echo.js'), (process.argv[2] || '') + '-grandchild'], { stdio: 'inherit' });
process.on('SIGTERM', () => process.exit(0));
