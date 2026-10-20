const { contextBridge, ipcRenderer, webUtils } = require('electron');
const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
const on = (ch) => (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); };
const themeArg = (process.argv || []).find(a => a.startsWith('--aivn-theme='));
contextBridge.exposeInMainWorld('aivn', {
  overlayOn: on('overlay:state'), overlayMouse: (inside) => ipcRenderer.send('overlay:mouse', !!inside), overlayStop: () => ipcRenderer.send('overlay:stop'), overlayAnswer: (r) => ipcRenderer.send('overlay:answer', r),
  initialTheme: themeArg && themeArg.endsWith('=dark') ? 'dark' : 'light',
  info: inv('app:info'), getSettings: inv('settings:get'), setSettings: inv('settings:set'),
  catalog: inv('catalog:list'), hfSearch: inv('hf:search'), hfRepo: inv('hf:repo'), hwInfo: inv('hw:info'), sysStats: inv('sys:stats'),
  dlStart: inv('dl:start'), dlPause: inv('dl:pause'), dlResume: inv('dl:resume'), dlRemove: inv('dl:remove'), dlList: inv('dl:list'),
  models: inv('models:list'), importModel: inv('models:import'), loadModel: inv('models:load'), modelMeta: inv('models:meta'), modelEstimate: inv('models:estimate'), saveModelLoad: inv('models:saveLoad'), unloadModel: inv('models:unload'),
  deleteModel: inv('models:delete'), reveal: inv('models:reveal'), modelStatus: inv('model:status'),
  generate: inv('chat:generate'), stop: inv('chat:stop'),
  convos: inv('convos:list'), saveConvo: inv('convos:save'), deleteConvo: inv('convos:delete'),
  startServer: inv('server:start'), stopServer: inv('server:stop'), serverStatus: inv('server:status'), openExternal: inv('open:external'),
  pickFiles: inv('files:pick'), readImage: inv('image:read'), copyText: inv('clipboard:write'), ocrImage: inv('image:ocr'), onEngineCrash: on('engine:crash'), extractFiles: inv('files:extract'), pathForFile: (f) => { try { return webUtils.getPathForFile(f); } catch { return ''; } },
  checkUpdate: inv('update:check'), downloadUpdate: inv('update:download'), installUpdate: inv('update:install'), openReleases: inv('update:open'), updateState: inv('update:state'),
  onUpdate: on('update:status'), onDocInfo: on('chat:docinfo'), onRagProgress: on('chat:ragprogress'),
  ragInfo: inv('rag:info'), ragDownload: inv('rag:download'), ragDelete: inv('rag:delete'), ragConvo: inv('rag:convo'),
  openVcredist: inv('vision:vcredist'), onVcredist: on('vision:vcredist'),
  onToken: on('chat:token'), onModelStatus: on('model:status'), onServerLog: on('server:log'),
  onDl: on('dl:update'), onDlDone: on('dl:done'), onDlRemoved: on('dl:removed'),
  agentInfo: inv('agent:info'), agentRun: inv('agent:run'), agentConfirmReply: inv('agent:confirm-reply'), agentAddFolder: inv('agent:add-folder'), agentRemoveFolder: inv('agent:remove-folder'), agentOpenFolder: inv('agent:open-folder'),
  onAgentStep: on('agent:step'), onAgentStatus: on('agent:status'), onAgentConfirm: on('agent:confirm'), onAgentApprove: on('agent:approve'), onAgentApproveCancel: on('agent:approve-cancel'), agentApproveReply: inv('agent:approve-reply'), agentAlwaysRevoke: inv('agent:always-revoke'), onAgentConfirmCancel: on('agent:confirm-cancel'),
  memList: inv('memory:list'), memAdd: inv('memory:add'), memUpdate: inv('memory:update'), memDelete: inv('memory:delete'), memClear: inv('memory:clear'),
  schedList: inv('sched:list'), schedCreate: inv('sched:create'), schedUpdate: inv('sched:update'), schedDelete: inv('sched:delete'), schedRun: inv('sched:run'), notifyTest: inv('notify:test'),
  onSchedChanged: on('sched:changed'), onConvosChanged: on('convos:changed'), onConvosOpen: on('convos:open'),
  gateState: inv('gate:state'), gateActivate: inv('gate:activate'), gateRetry: inv('gate:retry'), gateUnlock: inv('gate:unlock'), gateReset: inv('gate:reset'), gateCopy: inv('gate:copy'), gateQuit: inv('gate:quit'), gateEnter: inv('gate:enter'), onGateChanged: on('gate:changed'),
  lockInfo: inv('lock:info'), lockSet: inv('lock:set'), lockDisable: inv('lock:disable'), lockOptions: inv('lock:options'), lockNow: inv('lock:now'),
  licenseInfo: inv('license:info'), licenseCheck: inv('license:check'),
  computerStop: inv('computer:stop'), openLogs: inv('logs:open'), copyLogs: inv('logs:copy'), scanTest: inv('apps:scan-test'), benchRun: inv('bench:run'), crm: (fn, ...args) => ipcRenderer.invoke('crm:call', { fn, args }), crmExport: inv('crm:export'), crmImport: inv('crm:import'), qaCrm: !!process.env.AIVN_QAUI && !process.env.AIVN_QAUI_151, qaMode: !!(process.env.AIVN_QACU || process.env.AIVN_QAUI || process.env.AIVN_QA144 || process.env.AIVN_QA143 || process.env.AIVN_SHOTS141 || process.env.AIVN_AGENTBENCH || process.env.AIVN_TEST || process.env.AIVN_NO_ONBOARD), perfInfo: inv('perf:info'), perfSpeed: inv('perf:speed'), perfRuns: inv('perf:runs'), onPerfChanged: on('perf:changed'), onNotice: on('app:notice'), mcpStatus: inv('mcp:status'), mcpSave: inv('mcp:save'), mcpToggle: inv('mcp:toggle'), mcpRestart: inv('mcp:restart'), mcpPreset: inv('mcp:preset'), mcpMaster: inv('mcp:master'), onMcpChanged: on('mcp:changed'), benchStop: inv('bench:stop'), benchScores: inv('bench:scores'), onBenchProgress: on('bench:progress'), onChatRecover: on('chat:recover'), computerPermOpen: inv('computer:perm-open'), computerPermTest: inv('computer:perm-test'), agentScreenReply: inv('agent:screen-reply'),
  onAgentScreen: on('agent:screen'), onAgentScreenCancel: on('agent:screen-cancel'), onComputerStopped: on('computer:stopped'),
  adminState: inv('admin:state'), adminImport: inv('admin:import'), adminUnlock: inv('admin:unlock'), adminLock: inv('admin:lock'), adminIssue: inv('admin:issue'), adminRevoke: inv('admin:revoke'), adminPublish: inv('admin:publish'), adminSetToken: inv('admin:token'), adminForget: inv('admin:forget'), adminSelf: inv('admin:self-activate'),
});
