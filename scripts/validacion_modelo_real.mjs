// Validacion con modelo real (Groq) en entorno aislado - NO forma parte de
// la suite: script de verificacion manual previo a despliegue.
//
// Aislamiento:
// - DAVIS_DATA_DIR apunta a un directorio tmp creado por el llamador
//   (estado de produccion intacto: contactos, programados, trazas).
// - Las herramientas mutadoras van sustituidas por dobles que SOLO graban
//   argumentos: sin escritura, sin red, sin envio real.
// - Las guardas (destinatarioVerificado, resolucion nombre->numero) son las
//   reales: se ejecutan antes que el ejecutor y no se sustituyen.
// - Numeros ficticios 612345678 / 698765432; nunca numeros reales.
//
// Uso: DAVIS_DATA_DIR=$(mktemp -d) node scripts/validacion_modelo_real.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DAVIS_DATA_DIR = process.env.DAVIS_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'davis-validacion-'));
const rutaTmp = process.env.DAVIS_DATA_DIR;

const llamadas = { programar: [], registrar: [], otrasMutadoras: [] };
const ejecutores = {
  programar_mensaje_whatsapp: async (args) => {
    llamadas.programar.push({ ...args, mensaje: '[redactado]' });
    return `Mensaje programado con éxito para ${args.numero}.`;
  },
  registrar_contacto: async (args) => {
    llamadas.registrar.push(args);
    return `Contacto ${args.nombre} registrado correctamente.`;
  }
};

const { consultarJarvis } = await import('../src/core/jarvisAgent.js');

const opciones = {
  ejecutores,
  retornarTraza: true,
  rutaArchivoContactos: path.join(rutaTmp, 'contactos.json'),
  rutaArchivoProgramados: path.join(rutaTmp, 'scheduled_messages.json'),
  rutaArchivoIdempotencia: path.join(rutaTmp, 'idempotency_cache.json')
};
fs.writeFileSync(opciones.rutaArchivoContactos, JSON.stringify({ contactos: [] }));

async function caso(nombre, mensaje, historial) {
  llamadas.programar = []; llamadas.registrar = []; llamadas.otrasMutadoras = [];
  const t0 = Date.now();
  try {
    const { respuesta, traza } = await consultarJarvis(mensaje, historial, opciones);
    console.log(JSON.stringify({
      caso: nombre,
      ok: true,
      ms: Date.now() - t0,
      respuesta: String(respuesta || '').slice(0, 500),
      tools: (traza?.llamadas || []).map(l => ({ n: l.nombre, r: l.resultado })),
      ejecutado_programar: llamadas.programar,
      ejecutado_registrar: llamadas.registrar
    }));
  } catch (e) {
    console.log(JSON.stringify({ caso: nombre, ok: false, error: String((e && e.message) || e).slice(0, 300), ms: Date.now() - t0 }));
  }
}

// A. Frase original de la falla, con numero afirmado explicitamente en el chat.
await caso('A_frase_original_numero_afirmado',
  'enviale la probabilidad de lluvia a paula',
  [{ role: 'user', content: 'este es el numero de paula: +34 612 34 56 78' }]);

// B. Continuacion «si crealo» tras oferta del bot (falla: aborto por presupuesto).
await caso('B_continuacion_si_crealo',
  'si crealo',
  [
    { role: 'user', content: 'este es el numero de paula: +34 612 34 56 78' },
    { role: 'assistant', content: 'No tengo a Paula registrada como contacto verificado, senor. Quiere que la registre con el numero que me acaba de dar?' }
  ]);

// C. Contraejemplo: negacion reciente invalida la asociacion (debe bloquear).
await caso('C_negacion_reciente_bloquea',
  'enviale la probabilidad de lluvia a paula',
  [
    { role: 'user', content: 'el numero de paula es 612345678' },
    { role: 'user', content: 'paula dice que ese no es su numero' }
  ]);

console.log('VALIDACION_FIN');
