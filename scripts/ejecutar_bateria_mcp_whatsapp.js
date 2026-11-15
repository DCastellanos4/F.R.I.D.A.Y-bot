#!/usr/bin/env node
/**
 * ejecutar_bateria_mcp_whatsapp.js
 *
 * Bateria integral de validacion de casos de uso E2E sobre WhatsApp para
 * el asistente autonomo D.A.V.I.S., cubriendo servidores MCP de dominio
 * (DevOps, Booking, Finance, Lifestyle) y Segundo Cerebro / Recordatorios.
 *
 * Politica estricta: Cero emojis en codigo, logs y reportes.
 */

const TESTER_URL = process.env.TESTER_URL || 'http://127.0.0.1:3005';
const PAUSA_ENTRE_CASOS_MS = 3500;

async function drenarTester() {
  try {
    await fetch(`${TESTER_URL}/drain`, { method: 'POST' });
  } catch {}
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function consultarEstado() {
  const res = await fetch(`${TESTER_URL}/status`);
  if (!res.ok) throw new Error(`HTTP ${res.status} al consultar estado del tester`);
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

const BATERIA_CASOS = [
  {
    id: 'MCP_DEVOPS_STORAGE',
    dominio: 'DevOps',
    herramienta: 'verificar_almacenamiento',
    mensaje: 'DAVIS, comprueba el espacio y almacenamiento del disco principal del servidor',
    criterioValidacion: (resp) => /disco|almacenamiento|gb|ocupad|espacio/i.test(resp)
  },
  {
    id: 'MCP_BOOKING_DISPO',
    dominio: 'Booking',
    herramienta: 'consultar_disponibilidad',
    mensaje: 'DAVIS, consulta la disponibilidad de citas para mañana',
    criterioValidacion: (resp) => /disponib|hueco|hora|cita|mañana|fecha/i.test(resp)
  },
  {
    id: 'MCP_BOOKING_RESERVA',
    dominio: 'Booking',
    herramienta: 'reservar_cita',
    mensaje: 'DAVIS, reservame una cita para mañana a las 11:30 para revision de arquitectura',
    criterioValidacion: (resp) => /reserva|cita|confirmad|registrad|11:30/i.test(resp)
  },
  {
    id: 'MCP_BOOKING_LISTAR',
    dominio: 'Booking',
    herramienta: 'listar_citas',
    mensaje: 'DAVIS, que citas tengo agendadas en el sistema?',
    criterioValidacion: (resp) => /cita|agenda|revision|11:30|programad/i.test(resp)
  },
  {
    id: 'MCP_FINANCE_GASTO',
    dominio: 'Finance',
    herramienta: 'registrar_gasto',
    mensaje: 'DAVIS, registra un gasto de 24.50 euros en material de oficina categoria suministros',
    criterioValidacion: (resp) => /gasto|24\.50|registrad|suministros|oficina|guardad/i.test(resp)
  },
  {
    id: 'MCP_FINANCE_RESUMEN',
    dominio: 'Finance',
    herramienta: 'exportar_resumen_trimestral',
    mensaje: 'DAVIS, cual es el resumen de gastos y finanzas del trimestre actual?',
    criterioValidacion: (resp) => /resumen|trimestre|gasto|total|iva|eur|cuenta/i.test(resp)
  },
  {
    id: 'MCP_LIFESTYLE_HABITO',
    dominio: 'Lifestyle',
    herramienta: 'gestionar_habitos',
    mensaje: 'DAVIS, anade el habito de caminar 30 minutos todos los dias',
    criterioValidacion: (resp) => /habito|caminar|anadid|registrad|guardad/i.test(resp)
  },
  {
    id: 'MCP_LIFESTYLE_COMPRA',
    dominio: 'Lifestyle',
    herramienta: 'gestionar_lista_compra / anadir_compra',
    mensaje: 'DAVIS, anade fruta fresca a la lista de la compra',
    criterioValidacion: (resp) => /anadid|fruta fresca|lista|compra/i.test(resp)
  },
  {
    id: 'SECOND_BRAIN_WRITE',
    dominio: 'Memoria / RAG',
    herramienta: 'guardar_memoria',
    mensaje: 'DAVIS, recuerda en tu segundo cerebro que el servidor proxy inverso corre sobre Nginx 1.24',
    criterioValidacion: (resp) => /recuerd|memoria|guardad|nginx|1\.24/i.test(resp)
  },
  {
    id: 'SECOND_BRAIN_READ',
    dominio: 'Memoria / RAG',
    herramienta: 'buscar_memoria',
    mensaje: 'DAVIS, segun tu segundo cerebro sobre que version y software corre el proxy inverso?',
    criterioValidacion: (resp) => /nginx|1\.24|proxy/i.test(resp)
  },
  {
    id: 'RECORDATORIO_WRITE',
    dominio: 'Agenda / Tareas',
    herramienta: 'crear_recordatorio',
    mensaje: 'DAVIS, recuerdame hoy a las 21:00 apagar la estacion de trabajo',
    criterioValidacion: (resp) => /recordatorio|21:00|apagar|programad/i.test(resp)
  }
];

async function main() {
  console.log('================================================================');
  console.log('    D.A.V.I.S. - BATERIA DE VALIDACION E2E MULTI-DOMINIO MCP    ');
  console.log('================================================================');

  const estado = await consultarEstado();
  if (!estado.conectado) {
    console.error('ERROR: Tester desconectado. Inicie primero tester_client.js.');
    process.exit(1);
  }

  console.log(`Cliente Tester: ${estado.usuario}`);
  console.log(`Destino Bot DAVIS: ${estado.botJid}`);
  console.log(`Total casos planificados: ${BATERIA_CASOS.length}`);
  console.log('Modo: Control secuencial con validacion de criterios y latencia.\n');

  const resultados = [];

  for (let i = 0; i < BATERIA_CASOS.length; i++) {
    const caso = BATERIA_CASOS[i];
    console.log('----------------------------------------------------------------');
    console.log(`[Caso ${i + 1}/${BATERIA_CASOS.length}] [${caso.dominio}] ${caso.id}`);
    console.log(`Herramienta objetivo: ${caso.herramienta}`);
    await drenarTester();
    console.log(`David -> DAVIS: "${caso.mensaje}"`);

    const t0 = Date.now();
    try {
      const res = await enviarPrueba(caso.mensaje, 45000);
      const latencia = res.latenciaMs || (Date.now() - t0);
      const respTexto = res.respuestaDavis || '';
      const cumple = caso.criterioValidacion(respTexto);

      console.log(`DAVIS -> David: "${respTexto}"`);
      console.log(`Latencia: ${latencia} ms (${(latencia / 1000).toFixed(2)}s) | Criterio semantico: ${cumple ? 'CUMPLE' : 'NO_CUMPLE'}`);

      resultados.push({
        id: caso.id,
        dominio: caso.dominio,
        herramienta: caso.herramienta,
        latenciaMs: latencia,
        exito: cumple,
        respuesta: respTexto
      });
    } catch (err) {
      console.error(`ERROR en caso ${caso.id}: ${err.message}`);
      resultados.push({
        id: caso.id,
        dominio: caso.dominio,
        herramienta: caso.herramienta,
        latenciaMs: Date.now() - t0,
        exito: false,
        error: err.message
      });
    }

    if (i < BATERIA_CASOS.length - 1) {
      console.log(`[Pausa de control: ${PAUSA_ENTRE_CASOS_MS}ms]`);
      await sleep(PAUSA_ENTRE_CASOS_MS);
    }
  }

  console.log('\n================================================================');
  console.log('                     RESUMEN DE RESULTADOS                     ');
  console.log('================================================================');

  let superados = 0;
  for (const r of resultados) {
    const estadoStr = r.exito ? 'PASADO' : 'FALLADO';
    if (r.exito) superados++;
    console.log(`[${estadoStr}] [${r.dominio}] ${r.id}: ${(r.latenciaMs / 1000).toFixed(2)}s`);
  }

  console.log('----------------------------------------------------------------');
  console.log(`Total: ${resultados.length} | Superados: ${superados} | Fallados: ${resultados.length - superados}`);
  console.log(`Tasa de exito: ${((superados / resultados.length) * 100).toFixed(1)}%`);
  console.log('================================================================\n');

  if (superados < resultados.length) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Error fatal en bateria:', err);
  process.exit(1);
});
