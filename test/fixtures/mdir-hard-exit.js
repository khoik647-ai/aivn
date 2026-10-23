'use strict';
// Chạy bằng Electron thật (không ELECTRON_RUN_AS_NODE): armHardExit phải giết đúng pid này.
const { app } = require('electron');
const fs = require('fs');
const MD = require('../../src/models-dir');
try { app.disableHardwareAcceleration(); } catch {}
app.whenReady().then(() => {
  try { fs.writeSync(1, 'READY\n'); } catch {}
  try { fs.writeSync(2, 'READY\n'); } catch {}
  MD.armHardExit(400);
});
