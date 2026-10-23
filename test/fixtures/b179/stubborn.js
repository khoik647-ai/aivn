'use strict';
// bỏ qua SIGTERM và EOF stdin
process.on('SIGTERM', () => {});
require('../mcp-echo.js');
process.stdin.on('end', () => {});
setInterval(() => {}, 1000);
