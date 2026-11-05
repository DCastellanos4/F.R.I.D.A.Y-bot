#!/usr/bin/env node
/**
 * Migra las credenciales de la categoria "clave" del Second Brain de texto
 * plano a cifrado en reposo (AES-256-GCM, clave scrypt de MEMORY_ENCRYPTION_KEY).
 *
 * Garantias:
 * - La copia de seguridad previa tambien va cifrada: no se genera ninguna
 *   copia nueva en texto plano.
 * - El archivo original nunca se sobrescribe hasta que la migracion completa
 *   esta lista (escritura atomica via archivo temporal + rename).
 * - El nombre del backup nunca sobrescribe uno existente.
 * - Backup y archivo de memoria quedan con permisos 600 (solo el propietario).
 *
 * Uso:
 *   node scripts/encrypt-memory-credentials.mjs [ruta-al-json]
 *   node scripts/encrypt-memory-credentials.mjs --decrypt <backup-cifrado> [salida.json]
 *
 * Requiere MEMORY_ENCRYPTION_KEY en el entorno.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { cifrarDato, esCifrada } from '../src/services/memoryService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FORMATO = 'aes-256-gcm';

function claveDesdeEntorno(salt) {
  const pass = process.env.MEMORY_ENCRYPTION_KEY || '';
  if (!pass) return null;
  return crypto.scryptSync(pass, salt, 32, { N: 16384, r: 8, p: 1 });
}

function cifrarBuffer(plain) {
  const salt = crypto.randomBytes(16);
  const key = claveDesdeEntorno(salt);
  if (!key) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(FORMATO, key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  // Contenedor: MAGIC(8) | salt(16) | iv(12) | tag(16) | datos
  return Buffer.concat([Buffer.from('DVMEMBK1', 'ascii'), salt, iv, cipher.getAuthTag(), enc]);
}

function descifrarBuffer(contenedor) {
  const magic = contenedor.subarray(0, 8).toString('ascii');
  if (magic !== 'DVMEMBK1') throw new Error('No es un backup cifrado de memoria (DVMEMBK1)');
  const salt = contenedor.subarray(8, 24);
  const iv = contenedor.subarray(24, 36);
  const tag = contenedor.subarray(36, 52);
  const datos = contenedor.subarray(52);
  const key = claveDesdeEntorno(salt);
  if (!key) throw new Error('Falta MEMORY_ENCRYPTION_KEY en el entorno');
  const decipher = crypto.createDecipheriv(FORMATO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(datos), decipher.final()]);
}

function rutaBackupLibre(base) {
  let candidata = `${base}.dvmembak`;
  let n = 1;
  while (fs.existsSync(candidata)) {
    candidata = `${base}-${n}.dvmembak`;
    n++;
  }
  return candidata;
}

// Modo recuperacion: descifrar un backup
if (process.argv[2] === '--decrypt') {
  const entrada = process.argv[3];
  const salida = process.argv[4];
  if (!entrada || !fs.existsSync(entrada)) {
    console.error('Uso: node scripts/encrypt-memory-credentials.mjs --decrypt <backup-cifrado> [salida.json]');
    process.exit(1);
  }
  try {
    const plano = descifrarBuffer(fs.readFileSync(entrada));
    if (salida) {
      fs.writeFileSync(salida, plano, { mode: 0o600 });
      console.log(`Backup descifrado en: ${salida} (permisos 600)`);
    } else {
      process.stdout.write(plano.toString('utf-8') + '\n');
    }
  } catch (err) {
    console.error(`No se pudo descifrar el backup: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

const ruta = process.argv[2] || path.join(__dirname, '..', 'data', 'brain_memory.json');

if (!fs.existsSync(ruta)) {
  console.log('No existe el archivo de memoria; no hay nada que migrar.');
  process.exit(0);
}

const lista = JSON.parse(fs.readFileSync(ruta, 'utf-8'));
const pendientes = lista.filter(m => (m.categoria || '').toLowerCase() === 'clave' && !esCifrada(m));

if (pendientes.length === 0) {
  console.log('No hay credenciales en texto plano que migrar.');
  process.exit(0);
}

// Cifrar todo en memoria primero: si algo falla, el original queda intacto
const migradas = [];
for (const m of pendientes) {
  const cifrada = cifrarDato(m.dato);
  if (!cifrada) {
    console.error('Error: define MEMORY_ENCRYPTION_KEY en el entorno antes de migrar. No se ha modificado nada.');
    process.exit(1);
  }
  migradas.push({ memoria: m, cifrada });
}

// Backup cifrado del estado anterior, con nombre que nunca sobrescribe
const backup = rutaBackupLibre(ruta.replace(/\.json$/, '') + `.backup-${Date.now()}`);
const contenedor = cifrarBuffer(Buffer.from(JSON.stringify(lista, null, 2), 'utf-8'));
if (!contenedor) {
  console.error('Error: no se pudo cifrar el backup (falta MEMORY_ENCRYPTION_KEY). No se ha modificado nada.');
  process.exit(1);
}
fs.writeFileSync(backup, contenedor, { mode: 0o600 });

for (const { memoria, cifrada } of migradas) {
  Object.assign(memoria, cifrada);
}

// Escritura atomica del archivo migrado
const tmp = `${ruta}.tmp-${process.pid}`;
fs.writeFileSync(tmp, JSON.stringify(lista, null, 2), 'utf-8');
fs.renameSync(tmp, ruta);
fs.chmodSync(ruta, 0o600);

console.log(`Migracion completada: ${migradas.length} credencial(es) cifrada(s).`);
console.log(`Backup cifrado del estado anterior en: ${backup} (permisos 600)`);
console.log('Recuperacion: node scripts/encrypt-memory-credentials.mjs --decrypt <backup> [salida.json]');
