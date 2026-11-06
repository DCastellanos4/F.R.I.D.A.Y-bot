/**
 * eval_modelo_real.mjs - Evaluacion de calidad con el MODELO REAL (6 nov 2026)
 *
 * A diferencia de la bateria dorada (LLM guionizado, deterministico), aqui el
 * agente consultaJarvis habla con el proveedor configurado en el entorno
 * (en produccion: Groq, openai/gpt-oss-120b) y es EL MODELO quien decide las
 * llamadas a herramientas. Los casos son los R01-R24 de la bateria dorada:
 * derivados de mensajes reales anonimizados.
 *
 * AISLAMIENTO DE EFECTOS: TODAS las herramientas se interceptan con
 * ejecutores simulados; nunca se envia un WhatsApp, ni se borra memoria, ni
 * se ejecuta bash, ni se toca nada externo. Los datos se redirigen con
 * DAVIS_DATA_DIR.
 *
 * QUE MIDE Y QUE NO:
 *  - Mide: con el modelo real de produccion, si el orquestador enruta bien y
 *    el modelo elige la herramienta esperada (o ninguna) en casos reales
 *    anonimizados.
 *  - NO mide: entrega por WhatsApp, tiempos de produccion ni calidad
 *    literaria (el texto final se muestra truncado para revision manual).
 *
 * Uso:
 *   DAVIS_DATA_DIR=/tmp/eval node scripts/eval_modelo_real.mjs [--solo R01,R09] [--salida /tmp/eval.json]
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import { consultarJarvis } from '../src/core/jarvisAgent.js';
import { casosDorados } from '../tests/sector3/golden_dataset.js';

const MARCA_CLASIFICADOR = 'Clasifica la intencion principal';
const PAUSA_MS_ENTRE_CASOS = Number.parseInt(process.env.DAVIS_EVAL_PAUSA_MS || '3000', 10);

// Techos GLOBALES (no por caso): consultarJarvis puede llamar al modelo
// varias veces por caso (clasificador, rondas de herramientas, reintentos).
// La evaluacion aborta al superar el techo y lo reporta.
const MAX_LLAMADAS_GLOBAL = Number.parseInt(process.env.DAVIS_EVAL_MAX_LLAMADAS || '120', 10);
let llamadasGlobales = 0;

const args = process.argv.slice(2);
const optSolo = args.includes('--solo') ? args[args.indexOf('--solo') + 1].split(',') : null;
const optSalida = args.includes('--salida') ? args[args.indexOf('--salida') + 1] : null;

// Aislamiento obligatorio: sin un DAVIS_DATA_DIR temporal fuera del repo, la
// evaluacion podria leer o ESCRIBIR el data/ de produccion (como ya ocurrio
// via la suite del deploy). Se aborta en lugar de arriesgar efectos reales.
const { DATA_DIR: DATA_DIR_EFECTIVO } = await import('../src/config/paths.js');
const raizRepo = new URL('..', import.meta.url).pathname;
if (!process.env.DAVIS_DATA_DIR || DATA_DIR_EFECTIVO.startsWith(raizRepo)) {
  console.error('ABORTADO: la evaluacion exige DAVIS_DATA_DIR apuntando a un directorio temporal FUERA del repo; de lo contrario podria tocar datos de produccion.');
  process.exit(1);
}

const casos = casosDorados.filter((c) => c.id.startsWith('R') && (!optSolo || optSolo.some((sel) => c.id === sel || c.id.startsWith(sel + '-'))));

function dormir(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ejecutarCaso(caso) {
  const obs = { invocadas: [], llamadasClasificador: 0, llamadasLlm: 0, argsVistos: [] };

  // Intercepta CUALQUIER herramienta: sin efectos reales jamas, salvo las
  // consultas de SOLO LECTURA listadas, que se ejecutan de verdad contra el
  // DAVIS_DATA_DIR aislado para evaluar grounding con resultados reales.
  const LECTURA_REAL = new Set(['buscar_memoria', 'listar_memorias']);
  const ejecutores = new Proxy({}, {
    get(_t, nombre) {
      if (LECTURA_REAL.has(String(nombre))) {
        return undefined; // cae al ejecutor real (solo lectura)
      }
      return async (argumentos) => {
        obs.invocadas.push(String(nombre));
        obs.argsVistos.push({ herramienta: String(nombre), args: argumentos });
        return `OK ${String(nombre)}: resultado simulado para evaluacion (sin efectos reales).`;
      };
    }
  });

  // Envuelve el chatCompletion real para contar llamadas y detectar el
  // clasificador de respaldo, con reintento ante 429 (limite de la cuenta).
  const { chatCompletion } = await import('../src/core/llmService.js');
  const chatRealConTestigos = async (peticion) => {
    if (Array.isArray(peticion.messages) && peticion.messages.some(
      (m) => m.role === 'system' && typeof m.content === 'string' && m.content.startsWith(MARCA_CLASIFICADOR)
    )) {
      obs.llamadasClasificador += 1;
    }
    obs.llamadasLlm += 1;
    llamadasGlobales += 1;
    if (llamadasGlobales > MAX_LLAMADAS_GLOBAL) {
      throw new Error(`TECHO GLOBAL: ${MAX_LLAMADAS_GLOBAL} llamadas al modelo superadas; evaluacion abortada`);
    }
    for (let intento = 0; intento < 4; intento++) {
      try {
        return await chatCompletion(peticion);
      } catch (err) {
        const msg = String(err?.message || err);
        // TPD (limite diario): reintentar es inutil y gasta la ventana; abortar toda la evaluacion.
        if (/tokens per day|TPD/i.test(msg)) {
          console.error('ABORTADO: limite diario de tokens (TPD) alcanzado; no se reintentan llamadas ni se ejecutan mas casos.');
          process.exit(2);
        }
        const es429 = /429|rate.?limit/i.test(msg);
        if (!es429 || intento === 3) throw err;
        const espera = 20000 * (intento + 1);
        console.log(`   [429] limite de cuenta; espero ${espera / 1000}s y reintento...`);
        await dormir(espera);
      }
    }
  };

  const inicio = Date.now();
  const respuesta = await consultarJarvis(caso.entrada, [], {
    chatId: 'eval-modelo-real@local',
    chatCompletion: chatRealConTestigos,
    ejecutores,
    observarInvocacion: (nombre) => { if (!obs.invocadas.includes(String(nombre))) obs.invocadas.push(String(nombre)); }
  });
  const duracionMs = Date.now() - inicio;

  const esperado = caso.esperado || {};
  const fallos = [];
  if (esperado.invoca) {
    for (const h of esperado.invoca) {
      if (!obs.invocadas.includes(h)) fallos.push(`esperaba invocar ${h}; invoco: ${obs.invocadas.join(', ') || 'ninguna'}`);
    }
  }
  if (esperado.sinHerramientas && obs.invocadas.length > 0) {
    fallos.push(`no debia invocar herramientas; invoco: ${obs.invocadas.join(', ')}`);
  }
  if (esperado.noInvoca) {
    for (const h of esperado.noInvoca) {
      if (obs.invocadas.includes(h)) fallos.push(`NO debia ejecutarse ${h}; invoco: ${obs.invocadas.join(', ')}`);
    }
  }
  if (esperado.textoNoContiene) {
    const lower = String(respuesta || '').toLowerCase();
    for (const frag of esperado.textoNoContiene) {
      if (lower.includes(String(frag).toLowerCase())) fallos.push(`la respuesta no debia contener "${frag}"`);
    }
  }
  if (esperado.clasificador === true && obs.llamadasClasificador === 0) fallos.push('debio usar el clasificador de respaldo');
  if (esperado.clasificador === false && obs.llamadasClasificador > 0) fallos.push('no debia necesitar el clasificador');
  if (typeof respuesta !== 'string' || respuesta.trim().length === 0) fallos.push('respuesta vacia');

  return {
    id: caso.id,
    entrada: caso.entrada,
    ok: fallos.length === 0,
    fallos,
    invocadas: obs.invocadas,
    llamadasClasificador: obs.llamadasClasificador,
    llamadasLlm: obs.llamadasLlm,
    duracionMs,
    respuesta: String(respuesta || '').slice(0, 220)
  };
}

console.log(`Evaluacion con MODELO REAL (${casos.length} casos reales anonimizados, efectos aislados)`);
console.log('NOTA: mide enrutado y eleccion de herramienta del modelo de produccion; no es entrega WhatsApp.\n');

const resultados = [];
for (const caso of casos) {
  process.stdout.write(`${caso.id} ... `);
  try {
    const r = await ejecutarCaso(caso);
    resultados.push(r);
    console.log(`${r.ok ? 'OK ' : 'FALLO'} (${(r.duracionMs / 1000).toFixed(1)}s, llm:${r.llamadasLlm}, tools: ${r.invocadas.join(',') || 'ninguna'})`);
    if (!r.ok) for (const f of r.fallos) console.log(`   - ${f}`);
  } catch (err) {
    resultados.push({ id: caso.id, entrada: caso.entrada, ok: false, fallos: [`error de ejecucion: ${err.message}`], invocadas: [], llamadasClasificador: 0, llamadasLlm: 0, duracionMs: 0, respuesta: '' });
    console.log(`ERROR: ${err.message}`);
  }
  await dormir(PAUSA_MS_ENTRE_CASOS);
}

const okCount = resultados.filter((r) => r.ok).length;
console.log(`\n===== EVAL MODELO REAL =====`);
console.log(`Casos: ${resultados.length} | OK: ${okCount} | Fallos: ${resultados.length - okCount} | llamadas al modelo: ${llamadasGlobales} (techo ${MAX_LLAMADAS_GLOBAL})`);
for (const r of resultados.filter((r) => !r.ok)) console.log(`  FALLO ${r.id}: ${r.fallos.join(' | ')}`);
console.log('============================\n');

if (optSalida) {
  fs.writeFileSync(optSalida, JSON.stringify({ generado: new Date().toISOString(), resultados }, null, 2));
  console.log(`Detalle JSON en ${optSalida}`);
}

process.exit(resultados.length - okCount === 0 ? 0 : 1);
