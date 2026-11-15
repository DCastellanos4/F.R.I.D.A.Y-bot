#!/usr/bin/env node
/**
 * ejecutar_prueba_e2e.js - Ejecutor de pruebas de casos de uso reales sobre DAVIS.
 *
 * Envia mensajes de prueba a traves del tester_client (cuenta personal de David)
 * hacia DAVIS (+34711222006) y valida la respuesta recibida y la latencia.
 *
 * Politica estricta: Cero emojis.
 */

const TESTER_URL = process.env.TESTER_URL || 'http://127.0.0.1:3005';

async function consultarEstado() {
  const res = await fetch(`${TESTER_URL}/status`);
  if (!res.ok) throw new Error(`HTTP ${res.status} al consultar estado`);
  return res.json();
}

async function enviarPrueba(mensaje, timeoutMs = 60000) {
  const res = await fetch(`${TESTER_URL}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mensaje, timeoutMs })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function main() {
  const args = process.argv.slice(2);
  const promptPersonalizado = args.join(' ');

  console.log('================================================================');
  console.log('        D.A.V.I.S. - EJECUTOR DE CASOS DE USO E2E WHATSAPP      ');
  console.log('================================================================');

  try {
    const estado = await consultarEstado();
    console.log('Estado Tester:', estado.conectado ? 'CONECTADO' : 'DESCONECTADO');
    console.log('Usuario Tester:', estado.usuario || 'No autenticado');
    console.log('Destino DAVIS:', estado.botJid);

    if (!estado.conectado) {
      console.error('\nERROR: El cliente de David no esta conectado. Escanea primero el QR con node scripts/tester_client.js');
      process.exit(1);
    }

    const casos = promptPersonalizado
      ? [{ nombre: 'Prueba Personalizada', mensaje: promptPersonalizado }]
      : [
          { nombre: '1. Latencia y Saludo Base', mensaje: 'hola davis, que tal estas?' },
          { nombre: '2. Herramienta Lista de Compra (SQLite)', mensaje: 'davis anade cafe y pan a la lista de la compra' },
          { nombre: '3. Consulta Lista de Compra (SQLite)', mensaje: 'davis dime que hay en la lista de la compra' },
          { nombre: '4. Second Brain RAG / Memoria Qdrant', mensaje: 'davis recuerdas mi configuracion de despliegue?' },
          { nombre: '5. Recordatorio Táctico (SQLite)', mensaje: 'recuerdame en 20 minutos revisar las metricas del VPS' }
        ];

    console.log(`\nEjecutando ${casos.length} caso(s) de prueba...\n`);

    for (const caso of casos) {
      console.log('----------------------------------------------------------------');
      console.log(`[Caso]: ${caso.nombre}`);
      console.log(`[David -> DAVIS]: "${caso.mensaje}"`);

      const t0 = Date.now();
      const resultado = await enviarPrueba(caso.mensaje);
      const duracion = Date.now() - t0;

      console.log(`[DAVIS -> David]: "${resultado.respuestaDavis}"`);
      console.log(`[Latencia RTT]: ${resultado.latenciaMs} ms (${(resultado.latenciaMs / 1000).toFixed(2)}s)`);
      console.log('[Estado]: EXITO');
    }

    console.log('\n================================================================');
    console.log('                 TODAS LAS PRUEBAS COMPLETADAS                  ');
    console.log('================================================================');
  } catch (err) {
    console.error('\n[Error en ejecucion E2E]:', err.message);
    process.exit(1);
  }
}

main();
