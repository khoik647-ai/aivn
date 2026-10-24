// Chặn import('node-llama-cpp') trong bài kiểm thử B190 và trả về bộ giả.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'node-llama-cpp') {
    return { url: new URL('./b190-mock-nlc.mjs', import.meta.url).href, shortCircuit: true, format: 'module' };
  }
  return nextResolve(specifier, context);
}
