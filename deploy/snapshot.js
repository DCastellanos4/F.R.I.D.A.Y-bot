// snapshot.js - BORRADOR. Cifrado DBK1 (AES-256-GCM autenticado + scrypt),
// el mismo formato que src/services/opsService.js. Lee el tar por stdin,
// escribe magic|salt|iv|tag|cipher por stdout y se AUTOVERIFICA (roundtrip)
// antes de darlo por bueno. La clave llega por la variable de entorno PASS
// (BACKUP_PASSPHRASE o DAVIS_BACKUP_KEY del servidor); nunca por argumentos
// ni se escribe en disco.
import crypto from 'node:crypto';

const pass = process.env.PASS;
if (!pass || pass.length < 16) {
  console.error('PARADA: PASS ausente o <16 caracteres; snapshot cancelado.');
  process.exit(1);
}
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  const plano = Buffer.concat(chunks);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(pass, salt, 32, { N: 16384, r: 8, p: 1 });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const cifrado = Buffer.concat([cipher.update(plano), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Roundtrip de verificacion antes de emitir nada
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  const vuelta = Buffer.concat([d.update(cifrado), d.final()]);
  if (!vuelta.equals(plano)) {
    console.error('PARADA: el roundtrip de verificacion fallo; snapshot NO emitido.');
    process.exit(1);
  }
  process.stdout.write(Buffer.concat([Buffer.from('DBK1'), salt, iv, tag, cifrado]));
});
