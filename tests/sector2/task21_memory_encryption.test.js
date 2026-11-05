import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import os from 'node:os';
import { spawnSync } from 'node:child_process';

import { guardarMemoria, buscarMemorias, listarMemorias, olvidarMemoria } from '../../src/services/memoryService.js';
import { assertNoEmojis } from './helpers/s2Validators.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ARCHIVO_MEMORIA = path.resolve(__dirname, '..', '..', 'data', 'brain_memory.json');

const KEY_ENV_VARS = ['MEMORY_ENCRYPTION_KEY', 'BACKUP_PASSPHRASE', 'DAVIS_BACKUP_KEY'];

function clearKeyEnv() {
  for (const k of KEY_ENV_VARS) delete process.env[k];
}

describe('MemoryService - Cifrado en reposo de credenciales (categoria clave)', () => {
  let backupRaw = null;

  beforeEach(() => {
    clearKeyEnv();
    backupRaw = fs.existsSync(ARCHIVO_MEMORIA) ? fs.readFileSync(ARCHIVO_MEMORIA, 'utf-8') : null;
  });

  afterEach(() => {
    clearKeyEnv();
    if (backupRaw !== null) {
      fs.writeFileSync(ARCHIVO_MEMORIA, backupRaw, 'utf-8');
    } else if (fs.existsSync(ARCHIVO_MEMORIA)) {
      fs.unlinkSync(ARCHIVO_MEMORIA);
    }
  });

  it('rechaza guardar una credencial si no hay clave de cifrado configurada (fail closed)', () => {
    const res = guardarMemoria({ sujeto: 'Test Credencial FailClosed', dato: 'valor_secreto_test_123', categoria: 'clave' });
    assert.strictEqual(res.ok, false);
    assert.ok(res.error.includes('MEMORY_ENCRYPTION_KEY'));
    assertNoEmojis(res);

    const raw = fs.existsSync(ARCHIVO_MEMORIA) ? fs.readFileSync(ARCHIVO_MEMORIA, 'utf-8') : '';
    assert.ok(!raw.includes('valor_secreto_test_123'));
  });

  it('cifra el dato en disco y lo devuelve en claro al leerlo', () => {
    process.env.MEMORY_ENCRYPTION_KEY = 'test_memory_key_fixture';

    const res = guardarMemoria({ sujeto: 'Test Credencial Cifrada', dato: 'valor_secreto_test_123', categoria: 'clave' });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.memoria.dato, 'valor_secreto_test_123');
    assertNoEmojis(res);

    // En disco nunca aparece el valor en texto plano
    const raw = fs.readFileSync(ARCHIVO_MEMORIA, 'utf-8');
    assert.ok(!raw.includes('valor_secreto_test_123'));
    const almacenada = JSON.parse(raw).find(m => m.sujeto === 'Test Credencial Cifrada');
    assert.ok(almacenada);
    assert.strictEqual(almacenada.cifrado, 'aes-256-gcm');
    assert.ok(almacenada.salt && almacenada.iv && almacenada.tag);

    // Las lecturas lo devuelven descifrado
    const encontradas = buscarMemorias('Test Credencial Cifrada');
    assert.strictEqual(encontradas[0].dato, 'valor_secreto_test_123');
    const listado = listarMemorias('clave');
    assert.strictEqual(listado.find(m => m.sujeto === 'Test Credencial Cifrada').dato, 'valor_secreto_test_123');

    const del = olvidarMemoria('Test Credencial Cifrada');
    assert.strictEqual(del.ok, true);
  });

  it('sigue leyendo memorias antiguas en texto plano (compatibilidad)', () => {
    process.env.MEMORY_ENCRYPTION_KEY = 'test_memory_key_fixture';

    const lista = fs.existsSync(ARCHIVO_MEMORIA) ? JSON.parse(fs.readFileSync(ARCHIVO_MEMORIA, 'utf-8')) : [];
    lista.push({
      id: 'mem_legacy_test',
      sujeto: 'Test Legacy Plana',
      dato: 'valor_legacy_en_plano',
      categoria: 'clave',
      tags: ['clave'],
      fechaRegistro: new Date().toISOString(),
      fechaLocal: 'hoy'
    });
    fs.writeFileSync(ARCHIVO_MEMORIA, JSON.stringify(lista, null, 2), 'utf-8');

    const listado = listarMemorias('clave');
    const legacy = listado.find(m => m.sujeto === 'Test Legacy Plana');
    assert.ok(legacy);
    assert.strictEqual(legacy.dato, 'valor_legacy_en_plano');

    olvidarMemoria('Test Legacy Plana');
  });

  it('el script de migracion cifra credenciales legacy sin perder datos ni memorias', () => {
    const scriptPath = path.resolve(__dirname, '..', '..', 'scripts', 'encrypt-memory-credentials.mjs');
    const tmp = path.join(os.tmpdir(), `brain_migration_test_${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify([
      { id: '1', sujeto: 'Legacy Secret', dato: 'secreto_legacy_migracion', categoria: 'clave', tags: [], fechaRegistro: '', fechaLocal: '' },
      { id: '2', sujeto: 'Dato General', dato: 'cafe solo', categoria: 'general', tags: [], fechaRegistro: '', fechaLocal: '' }
    ]));
    const backupsCreados = [];

    try {
      // Sin clave configurada: rechaza y el original queda intacto
      const resSinClave = spawnSync(process.execPath, [scriptPath, tmp], { encoding: 'utf-8', env: { ...process.env } });
      assert.strictEqual(resSinClave.status, 1);
      assert.ok(fs.readFileSync(tmp, 'utf-8').includes('secreto_legacy_migracion'));

      // Con clave: cifra solo la categoria clave
      const resOk = spawnSync(process.execPath, [scriptPath, tmp], {
        encoding: 'utf-8',
        env: { ...process.env, MEMORY_ENCRYPTION_KEY: 'test_memory_key_fixture' }
      });
      assert.strictEqual(resOk.status, 0, resOk.stderr);

      const migrada = JSON.parse(fs.readFileSync(tmp, 'utf-8'));
      assert.ok(!JSON.stringify(migrada).includes('secreto_legacy_migracion'));
      const clave = migrada.find(m => m.id === '1');
      assert.strictEqual(clave.cifrado, 'aes-256-gcm');
      const general = migrada.find(m => m.id === '2');
      assert.strictEqual(general.dato, 'cafe solo');
      assert.strictEqual(general.cifrado, undefined);

      // El backup del estado anterior tambien va cifrado (nunca una copia en plano)
      const backupMatch = resOk.stdout.match(/Backup cifrado del estado anterior en: (\S+)/);
      assert.ok(backupMatch);
      const backupPath = backupMatch[1].trim();
      backupsCreados.push(backupPath);
      assert.ok(fs.existsSync(backupPath));
      const backupCrudo = fs.readFileSync(backupPath);
      assert.ok(!backupCrudo.toString('utf-8').includes('secreto_legacy_migracion'));
      assert.strictEqual(backupCrudo.subarray(0, 8).toString('ascii'), 'DVMEMBK1');
      assert.strictEqual((fs.statSync(backupPath).mode & 0o777), 0o600);
      assert.strictEqual((fs.statSync(tmp).mode & 0o777), 0o600);

      // Recuperacion: el backup se descifra con la clave y conserva el estado anterior
      const resDec = spawnSync(process.execPath, [scriptPath, '--decrypt', backupPath], {
        encoding: 'utf-8',
        env: { ...process.env, MEMORY_ENCRYPTION_KEY: 'test_memory_key_fixture' }
      });
      assert.strictEqual(resDec.status, 0, resDec.stderr);
      assert.ok(resDec.stdout.includes('secreto_legacy_migracion'));

      // Recuperacion sin clave: falla sin generar nada
      const resDecNoKey = spawnSync(process.execPath, [scriptPath, '--decrypt', backupPath], {
        encoding: 'utf-8',
        env: { ...process.env }
      });
      assert.strictEqual(resDecNoKey.status, 1);

      // Segunda ejecucion: nada que migrar
      const resIdem = spawnSync(process.execPath, [scriptPath, tmp], {
        encoding: 'utf-8',
        env: { ...process.env, MEMORY_ENCRYPTION_KEY: 'test_memory_key_fixture' }
      });
      assert.strictEqual(resIdem.status, 0);
      assert.ok(resIdem.stdout.includes('No hay credenciales en texto plano'));
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      for (const b of backupsCreados) {
        if (fs.existsSync(b)) fs.unlinkSync(b);
      }
    }
  });

  it('las memorias que no son de categoria clave se guardan sin cifrar', () => {
    process.env.MEMORY_ENCRYPTION_KEY = 'test_memory_key_fixture';

    const res = guardarMemoria({ sujeto: 'Test Dato General', dato: 'le gusta el cafe solo', categoria: 'general' });
    assert.strictEqual(res.ok, true);

    const raw = fs.readFileSync(ARCHIVO_MEMORIA, 'utf-8');
    assert.ok(raw.includes('le gusta el cafe solo'));

    olvidarMemoria('Test Dato General');
  });
});
