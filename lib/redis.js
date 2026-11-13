// Conexão com o Upstash Redis. Aceita as variáveis criadas pela integração
// Upstash da Vercel (KV_REST_API_URL / KV_REST_API_TOKEN) ou as padrão do Upstash.
let client;
function getRedis() {
  if (client) return client;
  if (global.__MOCK_REDIS__) return (client = global.__MOCK_REDIS__);
  const { Redis } = require('@upstash/redis');
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('defina UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN (ou conecte o Upstash pela Vercel)');
  client = new Redis({ url, token, automaticDeserialization: false });
  return client;
}
module.exports = { getRedis };
