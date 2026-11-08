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
