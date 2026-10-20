// Chuyển JSON Schema (kiểu OpenAI tools / response_format) sang tập con mà bộ ràng buộc ngữ pháp
// của node-llama-cpp hiểu được. Trường không bắt buộc được cho phép nhận null; mọi khoá đều được sinh ra.
const PRIM = ['string', 'number', 'integer', 'boolean', 'null'];
const ANY = { type: ['string', 'number', 'boolean', 'null'] };

function withDesc(o, s) { if (s && typeof s.description === 'string' && s.description) o.description = s.description.slice(0, 500); return o; }

function toGbnfSchema(s, depth = 0) {
  if (!s || typeof s !== 'object' || depth > 10) return { ...ANY };
  if (Array.isArray(s.enum) && s.enum.length) {
    const vals = s.enum.filter(v => v === null || ['string', 'number', 'boolean'].includes(typeof v));
    if (vals.length) return withDesc({ enum: vals }, s);
  }
  if ('const' in s && (s.const === null || ['string', 'number', 'boolean'].includes(typeof s.const))) return withDesc({ const: s.const }, s);
  const alts = Array.isArray(s.oneOf) ? s.oneOf : Array.isArray(s.anyOf) ? s.anyOf : null;
  if (alts && alts.length) return withDesc({ oneOf: alts.slice(0, 12).map(x => toGbnfSchema(x, depth + 1)) }, s);
  if (Array.isArray(s.allOf) && s.allOf.length === 1) return toGbnfSchema({ ...s.allOf[0], description: s.description }, depth + 1);
  let type = s.type;
  if (!type) type = s.properties ? 'object' : s.items ? 'array' : null;
  if (Array.isArray(type)) {
    const prim = type.filter(t => PRIM.includes(t));
    const complex = type.filter(t => t === 'object' || t === 'array');
    if (!complex.length && prim.length) return withDesc({ type: prim.length === 1 ? prim[0] : prim }, s);
    return withDesc({ oneOf: [...complex.map(t => toGbnfSchema({ ...s, type: t }, depth + 1)), ...(prim.length ? [{ type: prim.length === 1 ? prim[0] : prim }] : [])] }, s);
  }
  switch (type) {
    case 'object': {
      const props = s.properties && typeof s.properties === 'object' ? s.properties : {};
      const keys = Object.keys(props).slice(0, 64);
      const req = new Set(Array.isArray(s.required) ? s.required : keys);
      const out = { type: 'object', properties: {} };
      for (const k of keys) {
        let p = toGbnfSchema(props[k], depth + 1);
        if (!req.has(k)) p = withDesc({ oneOf: [p, { type: 'null' }] }, props[k]);
        out.properties[k] = p;
      }
      if (!keys.length) out.additionalProperties = s.additionalProperties && typeof s.additionalProperties === 'object' ? toGbnfSchema(s.additionalProperties, depth + 1) : true;
      return withDesc(out, s);
    }
    case 'array': {
      const o = { type: 'array', items: s.items && !Array.isArray(s.items) ? toGbnfSchema(s.items, depth + 1) : { ...ANY } };
      if (Number.isInteger(s.minItems)) o.minItems = s.minItems;
      if (Number.isInteger(s.maxItems)) o.maxItems = s.maxItems;
      return withDesc(o, s);
    }
    case 'string': {
      const o = { type: 'string' };
      if (['date', 'time', 'date-time'].includes(s.format)) o.format = s.format;
      if (Number.isInteger(s.minLength)) o.minLength = s.minLength;
      if (Number.isInteger(s.maxLength)) o.maxLength = s.maxLength;
      return withDesc(o, s);
    }
    case 'number': case 'integer': case 'boolean': case 'null': return withDesc({ type }, s);
    default: return withDesc({ ...ANY }, s);
  }
}

// Bỏ các trường không bắt buộc mà mô hình điền null (để trả về cho ứng dụng gọi API giống OpenAI)
function dropNullOptionals(value, schema) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !schema || !schema.properties) return value;
  const req = new Set(Array.isArray(schema.required) ? schema.required : Object.keys(schema.properties));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === null && !req.has(k)) continue;
    out[k] = schema.properties[k] && v && typeof v === 'object' ? dropNullOptionals(v, schema.properties[k]) : v;
  }
  return out;
}

// Kiểm tra định nghĩa tools của yêu cầu API, trả về [{name, description, parameters}]
function normalizeTools(tools) {
  if (tools == null) return [];
  if (!Array.isArray(tools)) throw new Error('"tools" phải là một mảng');
  if (tools.length > 64) throw new Error('Tối đa 64 công cụ mỗi yêu cầu');
  const seen = new Set();
  return tools.map((t, i) => {
    const f = t && t.type === 'function' ? t.function : t && t.function ? t.function : t;
    if (!f || typeof f.name !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(f.name)) throw new Error(`tools[${i}]: thiếu hoặc sai "function.name" (chỉ gồm chữ, số, _ . -)`);
    if (seen.has(f.name)) throw new Error(`tools[${i}]: trùng tên công cụ "${f.name}"`);
    seen.add(f.name);
    const parameters = f.parameters && typeof f.parameters === 'object' ? f.parameters : { type: 'object', properties: {} };
    return { name: f.name, description: typeof f.description === 'string' ? f.description.slice(0, 2000) : '', parameters };
  });
}

module.exports = { toGbnfSchema, dropNullOptionals, normalizeTools };
