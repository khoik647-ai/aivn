// Máy chủ MCP nhỏ cho kiểm thử: công cụ echo và add
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const z = require('zod');
const s = new McpServer({ name: 'echo', version: '1.0.0' });
s.tool('echo', 'Trả lại đúng chuỗi nhận được', { text: z.string() }, async ({ text }) => ({ content: [{ type: 'text', text: 'echo: ' + text }] }));
s.tool('add', 'Cộng hai số', { a: z.number(), b: z.number() }, async ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] }));
console.error('máy chủ echo sẵn sàng');
s.connect(new StdioServerTransport());
