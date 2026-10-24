// node-llama-cpp giả. Điều khiển bằng globalThis.__NLC (xem test/b190-adv-run.js).
const S = globalThis.__NLC || (globalThis.__NLC = {});
S.log = S.log || [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mkModel(opts) {
  const m = {
    gpuLayers: opts.gpuLayers,
    disposed: false,
    tokenize: (t) => Array.from({ length: Math.max(1, Math.ceil(String(t).length / 4)) }),
    async createContext(o) {
      S.log.push('ctx ' + opts.gpuLayers);
      const c = {
        contextSize: o.contextSize,
        flashAttention: o.flashAttention,
        disposed: false,
        getSequence() {
          const s = {
            disposed: false,
            contextTokens: [],
            dispose() { s.disposed = true; S.log.push('seq-dispose'); },
            async clearHistory() {},
            _c: c,
            _m: m,
          };
          return s;
        },
        async dispose() { c.disposed = true; S.log.push('ctx-dispose ' + opts.gpuLayers); },
      };
      return c;
    },
    async dispose() { m.disposed = true; S.log.push('model-dispose ' + opts.gpuLayers); },
  };
  return m;
}

export async function getLlama(o = {}) {
  return {
    gpu: o.gpu === false ? false : 'vulkan',
    cpuMathCores: 4,
    async getVramState() {
      S.vramCalls = (S.vramCalls || 0) + 1;
      const freeGiB = S.vramCalls > 1 && S.freeAfter != null ? S.freeAfter : (S.free ?? 3.5);
      return { total: 4 * 2 ** 30, free: freeGiB * 2 ** 30, unifiedSize: 0 };
    },
    async getGpuDeviceNames() { return ['NVIDIA GeForce RTX 3050 Ti Laptop GPU']; },
    async loadModel(opts) {
      S.log.push('load ' + opts.gpuLayers);
      if (S.loadFail) throw new Error(S.loadFail);
      return mkModel(opts);
    },
    async createGrammarForJsonSchema() { return {}; },
  };
}

export class LlamaChatSession {
  constructor({ contextSequence }) { this.seq = contextSequence; }
  setChatHistory() {}
  dispose() {}
  async promptWithMeta(prompt, o) {
    const tag = prompt === 'Hi' ? 'probe' : 'user';
    S.log.push('gen-start ' + tag + ' ' + (this.seq && this.seq._m ? this.seq._m.gpuLayers : '?'));
    const n = tag === 'probe' ? (S.probeTokens ?? 8) : (S.userTokens ?? 8);
    const per = tag === 'probe'
      ? (typeof S.msFor === 'function' ? S.msFor(this.seq._m.gpuLayers) : (S.probeMsPerTok ?? 5))
      : (S.userMsPerTok ?? 1);
    let out = '';
    for (let i = 0; i < n; i++) {
      await sleep(per);
      if (this.seq.disposed || this.seq._c.disposed || this.seq._m.disposed) {
        S.log.push('USE-AFTER-DISPOSE ' + tag);
        throw new Error('Object is disposed');
      }
      out += 'abcd';
      if (o.onResponseChunk) o.onResponseChunk({ text: 'abcd' });
    }
    S.log.push('gen-end ' + tag + ' ' + (this.seq && this.seq._m ? this.seq._m.gpuLayers : '?'));
    return { responseText: out, stopReason: 'eogToken' };
  }
}

export class InputLookupTokenPredictor {}
export const LlamaLogLevel = {};
export async function readGgufFileInfo() {
  return {
    metadata: {
      general: { architecture: 'llama', name: 'mock' },
      llama: {
        block_count: 28,
        context_length: 32768,
        embedding_length: 3072,
        attention: { head_count: 24, head_count_kv: 8, key_length: 128 },
      },
      tokenizer: { chat_template: '' },
    },
  };
}
