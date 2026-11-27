/**
 * financeHandlers.js - Manejadores de herramientas del dominio Finanzas.
 *
 * Politica estricta: cero emojis en codigo, comentarios y respuestas.
 */

import { registrarGasto, listarGastos, resumenMensual, registrarSuscripcion, listarSuscripciones, configurarPresupuesto, estadoPresupuestos, configurarAvisosSuscripciones } from '../../services/financeService.js';

export function depsFinanzasDe(opciones = {}) {
  const store = opciones.storeFinanzas || opciones.financeStore || opciones.store;
  return {
    tenantId: opciones.tenantId,
    ...(store ? { store } : {}),
    ...(!store && opciones.rutaArchivoFinanzas ? { rutaArchivo: opciones.rutaArchivoFinanzas } : {})
  };
}

export function crearManejadoresFinanzas() {
  return {
    registrar_gasto: (args, opciones) => {
      const res = registrarGasto({ importe: args.importe, comercio: args.comercio, categoria: args.categoria, fecha: args.fecha, notas: args.notas }, depsFinanzasDe(opciones));
      return res.ok
        ? `Anotado, David: ${res.gasto.importe.toFixed(2)} EUR en ${res.gasto.comercio} (${res.gasto.categoria}, ${res.gasto.fecha}).${res.aviso ? ` ${res.aviso}` : ''}`
        : `No lo he podido anotar: ${res.error}`;
    },
    listar_gastos: (args, opciones) => {
      const gastos = listarGastos({ mes: args.mes, categoria: args.categoria }, depsFinanzasDe(opciones));
      return gastos.length === 0
        ? 'No hay gastos registrados con ese filtro.'
        : 'Gastos:\n' + gastos.map((g) => `- ${g.fecha}: ${g.importe.toFixed(2)} EUR en ${g.comercio} (${g.categoria})`).join('\n');
    },
    resumen_gastos_mes: (args, opciones) => {
      const r = resumenMensual({ mes: args.mes }, depsFinanzasDe(opciones));
      const lineas = r.comparativa.map((c) => `- ${c.categoria}: ${c.actual.toFixed(2)} EUR${c.variacion === null ? ' (sin datos del mes anterior)' : ` (${c.variacion >= 0 ? '+' : ''}${c.variacion}% vs ${r.mesAnterior})`}`);
      return `Resumen de ${r.mes}, David: total ${r.totalActual.toFixed(2)} EUR (mes anterior: ${r.totalAnterior.toFixed(2)} EUR).${lineas.length ? '\n' + lineas.join('\n') : '\nSin gastos este mes.'}`;
    },
    registrar_suscripcion: (args, opciones) => {
      const res = registrarSuscripcion({ nombre: args.nombre, importe: args.importe, diaRenovacion: args.diaRenovacion, categoria: args.categoria }, depsFinanzasDe(opciones));
      return res.ok
        ? `Suscripcion registrada, David: ${res.suscripcion.nombre}, ${res.suscripcion.importe.toFixed(2)} EUR, renueva el dia ${res.suscripcion.diaRenovacion} de cada mes. Te avisare 3 dias antes de cada renovacion.`
        : `No la he podido registrar: ${res.error}`;
    },
    listar_suscripciones: (_args, opciones) => {
      const subs = listarSuscripciones(depsFinanzasDe(opciones));
      return subs.length === 0
        ? 'No tienes suscripciones registradas.'
        : 'Suscripciones:\n' + subs.map((x) => `- ${x.nombre}: ${x.importe.toFixed(2)} EUR, renueva el dia ${x.diaRenovacion}`).join('\n');
    },
    configurar_presupuesto: (args, opciones) => {
      const res = configurarPresupuesto({ categoria: args.categoria, limite: args.limite }, depsFinanzasDe(opciones));
      return res.ok
        ? `Presupuesto fijado, David: ${res.categoria}, ${res.limite.toFixed(2)} EUR al mes. Te avisare al superar el 80%.`
        : `No lo he podido fijar: ${res.error}`;
    },
    estado_presupuestos: (args, opciones) => {
      const filas = estadoPresupuestos({ mes: args.mes }, depsFinanzasDe(opciones));
      return filas.length === 0
        ? 'No hay presupuestos configurados. Fija uno con "configurar_presupuesto".'
        : 'Presupuestos del mes:\n' + filas.map((f) => `- ${f.categoria}: ${f.gastado.toFixed(2)} de ${f.limite.toFixed(2)} EUR (${f.porcentaje}%)${f.alerta ? ' - OJO: por encima del 80%' : ''}`).join('\n');
    },
    configurar_avisos_suscripciones: (args, opciones) => {
      const pideActivarSus = /(activa(r|s|do)?|enciend(e|er)|pon\s+en\s+marcha)\s+.{0,30}(aviso|suscripci)/i.test(opciones.mensajeUsuario || '');
      if (args.activo === true && !pideActivarSus) {
        return 'Para activar los avisos de suscripciones necesito que me lo pidas tu directamente (por ejemplo: "activa los avisos de suscripciones").';
      }
      const res = configurarAvisosSuscripciones({ activo: args.activo === true }, depsFinanzasDe(opciones));
      return res.ok
        ? (res.activo ? 'Avisos de suscripciones activados, David: te avisare 3 dias antes de cada renovacion.' : 'Avisos de suscripciones desactivados, David.')
        : `No he podido cambiar los avisos: ${res.error}`;
    }
  };
}
