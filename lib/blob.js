// Armazena fotos no Vercel Blob (Storage → Blob na Vercel cria BLOB_READ_WRITE_TOKEN)
async function storeImage(dataUrl, contentType, b64, path) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Vercel Blob não configurado (BLOB_READ_WRITE_TOKEN)');
  const { put } = require('@vercel/blob');
  const blob = await put(path, Buffer.from(b64, 'base64'), { access: 'public', contentType, addRandomSuffix: false });
  return blob.url;
}
module.exports = { storeImage };
