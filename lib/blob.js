// Fotos no Vercel Blob.
// Blob PRIVADO (padrão novo da Vercel): autenticação automática (OIDC), sem BLOB_READ_WRITE_TOKEN.
//   As fotos são servidas pelo próprio app em /api/foto, que confere o login antes de mostrar.
// Blob PÚBLICO: também funciona; nesse caso grava o link público direto.
let sdk;
const blobSdk = async () => (sdk = sdk || (await import('@vercel/blob')));

async function storeImage(dataUrl, contentType, b64, path) {
  const { put } = await blobSdk();
  const buf = Buffer.from(b64, 'base64');
  try {
    const b = await put(path, buf, { access: 'private', contentType, addRandomSuffix: false });
    return '/api/foto?p=' + encodeURIComponent(b.pathname || path);
  } catch (e) {
    // store público não aceita upload privado -> tenta como público
    if (/public|access/i.test(String(e && e.message))) {
      const b = await put(path, buf, { access: 'public', contentType, addRandomSuffix: false });
      return b.url;
    }
    throw e;
  }
}

async function readImage(pathname, ifNoneMatch) {
  const { get } = await blobSdk();
  return get(pathname, { access: 'private', ifNoneMatch });
}
module.exports = { storeImage, readImage };
