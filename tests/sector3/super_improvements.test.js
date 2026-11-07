/**
 * super_improvements.test.js - Pruebas para las 4 super mejoras de D.A.V.I.S.:
 * 1. Agente Programador GitHub (ramas, commits, PRs)
 * 2. Vision Multimodal (analisis de errores, terminales y PDFs)
 * 3. Briefing Matutino 06:55 (Meteorologia, agenda, transporte nominal, servidor)
 * 4. Guardarrailes de Navegacion Web Playwright
 * 5. Sincronizacion de Calendario y Citas
 *
 * Strict Policy: Zero Emojis.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  crearRamaTrabajo,
  crearCommit,
  abrirPullRequest,
  getGitHubToken
} from '../../src/services/githubAgentService.js';
import {
  analizarImagen,
  procesarDocumentoPDF,
  imagenABase64DataUri
} from '../../src/services/visionService.js';
import {
  generarBriefingCompleto,
  CRON_HORA_MATUTINA,
  eliminarEmojis
} from '../../src/services/dailyBriefing.js';
import {
  validarGuardarrailesNavegacion,
  PATRONES_PROHIBIDOS
} from '../../src/services/browserService.js';
import {
  consultarEventos,
  crearEvento,
  eliminarEvento
} from '../../src/services/calendarService.js';

test('1. Agente Programador GitHub: validacion de parametros y creacion de PR', async () => {
  // Sin nombre de rama
  const rVacia = await crearRamaTrabajo({});
  assert.strictEqual(rVacia.ok, false);

  // Commit sin mensaje
  const rCommitVacio = await crearCommit({});
  assert.strictEqual(rCommitVacio.ok, false);

  // Crear PR sin token devuelve error descriptivo honesto
  const rPrSinToken = await abrirPullRequest({ titulo: 'Test PR', rama: 'feat/test' }, { token: null });
  assert.strictEqual(rPrSinToken.ok, false);
  assert.match(rPrSinToken.error, /DAVIS_GITHUB_TOKEN/);

  // Crear PR con mock fetch y token simulado
  const mockFetch = async () => ({
    ok: true,
    status: 201,
    json: async () => ({ number: 42, html_url: 'https://github.com/DCastellanos4/F.R.I.D.A.Y-bot/pull/42', title: 'feat: test', state: 'open' })
  });

  const rPrExitosa = await abrirPullRequest(
    { titulo: 'feat: test', rama: 'feat/test', base: 'main' },
    { token: 'ghp_fake_token', fetchFn: mockFetch }
  );
  assert.strictEqual(rPrExitosa.ok, true);
  assert.strictEqual(rPrExitosa.numero, 42);
  assert.strictEqual(rPrExitosa.url, 'https://github.com/DCastellanos4/F.R.I.D.A.Y-bot/pull/42');
});

test('2. Guardarrailes de Navegacion Web: bloquea logins, pasarelas de pago y carritos', () => {
  const urlsProhibidas = [
    'https://tienda.com/checkout/step1',
    'https://banco.es/login',
    'https://ejemplo.com/cart',
    'https://sitio.com/auth/oauth/authorize',
    'https://comercio.es/carrito/pagar',
    'https://servidor.com/admin/dashboard'
  ];

  for (const url of urlsProhibidas) {
    const res = validarGuardarrailesNavegacion(url);
    assert.strictEqual(res.permitido, false, `Deberia bloquear: ${url}`);
    assert.match(res.motivo, /guardarrail/i);
  }

  const urlsPermitidas = [
    'https://es.wikipedia.org/wiki/Inteligencia_artificial',
    'https://elpais.com/ciencia/noticia-cientifica.html',
    'https://nodejs.org/api/fs.html'
  ];

  for (const url of urlsPermitidas) {
    const res = validarGuardarrailesNavegacion(url);
    assert.strictEqual(res.permitido, true, `Deberia permitir lectura publica: ${url}`);
  }
});

test('3. Briefing Matutino: programado a las 06:55 y genera informe estructurado sin emojis', async () => {
  assert.strictEqual(CRON_HORA_MATUTINA, '55 6 * * *');

  const briefing = await generarBriefingCompleto('Madrid');
  assert.ok(typeof briefing === 'string');
  assert.match(briefing, /INFORME TACTICO MATUTINO D\.A\.V\.I\.S\. \(06:55\)/);
  assert.match(briefing, /METEOROLOGIA/);
  assert.match(briefing, /AGENDA Y CITAS DEL DIA/);
  assert.match(briefing, /TRANSPORTE Y LOGISTICA/);
  assert.match(briefing, /ESTADO DEL SISTEMA/);

  // Validacion de cero emojis en el texto
  const sinEmojis = eliminarEmojis(briefing);
  assert.strictEqual(briefing, sinEmojis);
});

test('4. Vision Multimodal: procesa buffers y gestiona falta de clave con aviso honesto', async () => {
  const bufDummy = Buffer.from('fake image binary content');
  const dataUri = imagenABase64DataUri(bufDummy, 'image/jpeg');
  assert.ok(dataUri.startsWith('data:image/jpeg;base64,'));

  // Sin API key informa del estado sin inventar
  const rSinKey = await analizarImagen({ bufferOPath: bufDummy }, { apiKey: null });
  assert.strictEqual(rSinKey.ok, false);
  assert.match(rSinKey.error, /OPENAI_API_KEY|GROQ_API_KEY/);

  // Con Mock Fetch devuelve respuesta estructurada
  const mockVisionFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: 'Sintoma: Error de sintaxis en linea 42. Solucion: cerrar parentesis faltante.' } }]
    })
  });

  const rExitosa = await analizarImagen(
    { bufferOPath: bufDummy, prompt: 'analiza este error' },
    { apiKey: 'gsk_fake', fetchFn: mockVisionFetch }
  );
  assert.strictEqual(rExitosa.ok, true);
  assert.match(rExitosa.analisis, /Error de sintaxis/);
});

test('5. Sincronizacion de Calendario: crear, consultar y eliminar citas locales', async () => {
  const tmpRuta = 'data/test_calendar_isolated.json';
  const deps = { rutaArchivo: tmpRuta, apiKey: null };

  const rCrear = await crearEvento({
    titulo: 'Reunion de Arquitectura',
    inicio: '2026-11-10 10:00',
    fin: '2026-11-10 11:30'
  }, deps);

  assert.strictEqual(rCrear.ok, true);
  assert.ok(rCrear.evento.id.startsWith('cal-'));

  const rListar = await consultarEventos({ desde: '2026-11-01', hasta: '2026-11-20' }, deps);
  assert.strictEqual(rListar.ok, true);
  assert.strictEqual(rListar.eventos.length, 1);
  assert.strictEqual(rListar.eventos[0].titulo, 'Reunion de Arquitectura');

  const rBorrar = await eliminarEvento({ id: rCrear.evento.id }, deps);
  assert.strictEqual(rBorrar.ok, true);
  assert.strictEqual(rBorrar.eliminados, 1);

  // Limpieza
  try { import('node:fs').then(fs => fs.unlinkSync(tmpRuta)); } catch {}
});
