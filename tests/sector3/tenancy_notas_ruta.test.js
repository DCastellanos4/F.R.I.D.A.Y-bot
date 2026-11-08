// Notas y diario: con carpeta de tenant forzada NADA se lee ni escribe en la carpeta del propietario.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-notas-'));
process.env.DAVIS_DATA_DIR = DIR;
const { savePersonalNote, listRecentNotes } = await import('../../src/services/notesService.js');
const { capturarPagina } = await import('../../src/services/capturaService.js');
const { escribirDiario, leerDiario } = await import('../../src/services/diaryService.js');
const { aislarOpcionesTenant } = await import('../../src/core/tenancy.js');

const op = aislarOpcionesTenant({ tenantId: 'sint-a' }, DIR);

test('aislarOpcionesTenant fuerza carpetaNotas y carpetaDiario dentro de tenants/<id>', () => {
  assert.equal(op.carpetaNotas, path.join(DIR, 'tenants', 'sint-a', 'notes'));
  assert.equal(op.carpetaDiario, path.join(DIR, 'tenants', 'sint-a', 'diario'));
});

test('guardar/listar nota y captura con carpeta de tenant no tocan la del propietario', async () => {
  await savePersonalNote('nota del tenant sobre algo', { category: 'general', carpetaNotas: op.carpetaNotas });
  await capturarPagina({ url: 'https://example.com/x' }, {
    carpetaNotas: op.carpetaNotas,
    extraerArticulo: async () => ({ titulo: 't', contenido: 'contenido largo de la pagina capturada '.repeat(5) })
  });
  assert.equal(fs.existsSync(path.join(DIR, 'notes')), false, 'la carpeta del propietario no se creo');
  const propias = await listRecentNotes(10, { carpetaNotas: op.carpetaNotas });
  assert.equal(propias.length >= 2, true);
  // control: sin carpeta (propietario) escribe en la suya y el tenant no la ve
  await savePersonalNote('nota del propietario secreta', {});
  assert.equal(fs.existsSync(path.join(DIR, 'notes')), true);
  const otra = await listRecentNotes(10, { carpetaNotas: op.carpetaNotas });
  assert.equal(otra.some((n) => /propietario secreta/.test(JSON.stringify(n))), false);
});

test('diario con carpeta de tenant: aparte del propietario', () => {
  escribirDiario({ texto: 'diario del tenant', fecha: '2026-01-02' }, { carpetaDiario: op.carpetaDiario });
  assert.equal(fs.existsSync(path.join(DIR, 'diario')), false);
  const r = leerDiario({ fecha: '2026-01-02' }, { carpetaDiario: op.carpetaDiario });
  assert.match(JSON.stringify(r), /diario del tenant/);
});

test('getNoteByPath: no lee fuera de la carpeta de notas indicada', async () => {
  const { getNoteByPath } = await import('../../src/services/notesService.js');
  const ajeno = path.join(DIR, 'secreto.md'); fs.writeFileSync(ajeno, '# s\nSECRETO');
  await assert.rejects(() => getNoteByPath(ajeno, { carpetaNotas: op.carpetaNotas }), /outside/);
  await assert.rejects(() => getNoteByPath(path.join(op.carpetaNotas, '..', '..', '..', 'secreto.md'), { carpetaNotas: op.carpetaNotas }), /outside/);
});

test('radar de ofertas: radarDeps forzado al tenant, sin cola global; el radarDeps del llamador se descarta', () => {
  const o = aislarOpcionesTenant({ tenantId: 'sint-a', radarDeps: { rutaConfig: path.join(DIR, 'job_radar.json'), enqueue: () => 'global' } }, DIR);
  assert.equal(o.radarDeps.rutaConfig, path.join(DIR, 'tenants', 'sint-a', 'job_radar.json'));
  assert.equal(o.radarDeps.rutaVistos, path.join(DIR, 'tenants', 'sint-a', 'job_radar_seen.json'));
  assert.equal(o.radarDeps.enqueue({}), false);
});

test('programadores y monitores: un tenant con TODAS las herramientas en su lista blanca sigue denegado antes de programar nada', async () => {
  const { puedeEjecutarHerramienta } = await import('../../src/services/rbacService.js');
  const todas = ['crear_recordatorio', 'programar_snooze', 'registrar_aviso_llegada', 'vigilar_producto', 'vigilar_ruta',
    'configurar_repaso_flashcards', 'programar_recordatorios_estudio', 'configurar_radar_ofertas', 'escanear_ofertas_empleo',
    'configurar_digest_semanal', 'ejecutar_skill', 'trigger_encrypted_backup'];
  for (const h of todas) {
    const d = puedeEjecutarHerramienta({ tenantId: 'sint-a', herramienta: h, rolDe: () => 'usuario', permitidasUsuario: todas });
    assert.equal(d.permitido, false, `${h} debe estar denegada a tenants (${d.motivo})`);
    assert.equal(d.motivo, 'solo_propietario', h);
  }
  // control: el propietario no cambia
  assert.equal(puedeEjecutarHerramienta({ tenantId: 'propietario', herramienta: 'crear_recordatorio' }).permitido, true);
});

test('getNoteByPath realpath rechaza archivo symlink fuera del arbol de notas', async () => {
  const { getNoteByPath } = await import('../../src/services/notesService.js');
  const fuera=path.join(DIR,'secreto-enlace.md');fs.writeFileSync(fuera,'# SECRETO-FUERA');
  fs.mkdirSync(op.carpetaNotas,{recursive:true});const link=path.join(op.carpetaNotas,'link.md');fs.symlinkSync(fuera,link);
  await assert.rejects(()=>getNoteByPath(link,{carpetaNotas:op.carpetaNotas}),/outside/);
});
