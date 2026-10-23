'use strict';
// mcp echo + công cụ "sleep" chậm (lệnh gọi đang chạy khi tắt công tắc chính)
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const z = require('zod');
const s = new McpServer({ name: 'slow', version: '1.0.0' });
s.tool('sleep', 'Ngủ ms rồi trả lời', { ms: z.number() }, async ({ ms }) => {
  await new Promise(r => setTimeout(r, ms));
  return { content: [{ type: 'text', text: 'woke ' + ms }] };
});
s.connect(new StdioServerTransport());
