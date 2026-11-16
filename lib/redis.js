// Conexão com o Upstash Redis. Aceita as variáveis criadas pela integração
// Upstash da Vercel (KV_REST_API_URL / KV_REST_API_TOKEN) ou as padrão do Upstash.
// Com automaticDeserialization:false o Upstash devolve HGETALL como lista
// [campo, valor, campo, valor...] e HMGET como lista; aqui tudo é normalizado.
let client;
function pairsToObj(res) {
  if (res == null) return null;
  if (Array.isArray(res)) {
    if (!res.length) return null;
    const o = {}; for (let i = 0; i < res.length; i += 2) o[res[i]] = res[i + 1]; return o;
  }
  return Object.keys(res).length ? res : null;
}
function wrap(raw) {
  return {
    get: (k) => raw.get(k),
    set: (k, v) => raw.set(k, v),
    hget: (k, f) => raw.hget(k, f),
    hset: (k, o) => raw.hset(k, o),
    hdel: (k, ...f) => raw.hdel(k, ...f),
    hlen: (k) => raw.hlen(k),
    sadd: (k, ...v) => raw.sadd(k, ...v),
    smembers: async (k) => (await raw.smembers(k)) || [],
    del: (...k) => raw.del(...k),
    hgetall: async (k) => pairsToObj(await raw.hgetall(k)),
    hmget: async (k, ...f) => {
      const res = await raw.hmget(k, ...f);
      if (Array.isArray(res)) return res;
      if (res && typeof res === 'object') return f.map((x) => (x in res ? res[x] : null));
      return f.map(() => null);
    }
  };
}
function getRedis() {
  if (client) return client;
  if (global.__MOCK_REDIS__) return (client = global.__MOCK_REDIS__);
  const { Redis } = require('@upstash/redis');
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('defina UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN (ou conecte o Upstash pela Vercel)');
  client = wrap(new Redis({ url, token, automaticDeserialization: false }));
  return client;
}
module.exports = { getRedis, wrap, pairsToObj };
