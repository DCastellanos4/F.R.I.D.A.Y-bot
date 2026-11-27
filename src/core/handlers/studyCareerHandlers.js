/**
 * studyCareerHandlers.js - Manejadores de herramientas de Estudio, Flashcards y Carrera.
 *
 * Politica estricta: cero emojis en codigo, comentarios y respuestas.
 */

import { crearPlanEstudio, listarPlanes, registrarAvance, programarRecordatoriosPlan } from '../../services/studyPlannerService.js';
import { agregarFlashcard, pendientesDeRepaso, registrarRespuesta, resumenFlashcards, configurarRepaso, iniciarMonitorFlashcards } from '../../services/flashcardService.js';
import { registrarCandidatura, listarCandidaturas, actualizarCandidatura, resumenCandidaturas } from '../../services/applicationTrackerService.js';
import { escanearRadar, configurarRadar, leerConfigRadar, iniciarMonitorRadar } from '../../services/jobRadarService.js';
import { iniciarEntrevista } from '../../services/interviewService.js';
import { analizarCvContraOferta } from '../../services/cvAnalyzerService.js';
import { resumirApuntes } from '../../services/notesSummarizerService.js';
import { registrarEntrega, listarEntregas, eliminarEntrega } from '../../services/deadlinesService.js';

export function crearManejadoresEstudioYCarrera() {
  return {
    planificar_estudio: (args, opciones) => {
      const res = crearPlanEstudio({
        asignatura: args.asignatura,
        fechaExamen: args.fechaExamen,
        temas: args.temas,
        horaEstudio: args.horaEstudio
      }, { rutaArchivo: opciones.rutaPlanesEstudio, crearRecordatorio: opciones.crearRecordatorioEstudio });
      if (res.ok) {
        const sesiones = res.plan.entradas.map((e) => `- ${e.fecha} (${e.tipo}): ${e.temas.join(', ')}`).join('\n');
        return `Plan de estudio creado, David: ${res.plan.asignatura}, examen el ${res.plan.fechaExamen}, ${res.plan.entradas.length} sesiones, ${res.recordatorios} recordatorios programados.\n${sesiones}${res.aviso ? `\n${res.aviso}` : ''}`;
      }
      return `No se pudo crear el plan: ${res.error}`;
    },
    listar_planes_estudio: (_args, opciones) => {
      const planes = listarPlanes({ rutaArchivo: opciones.rutaPlanesEstudio });
      return planes.length === 0
        ? 'No hay planes de estudio activos.'
        : 'Planes de estudio:\n' + planes.map((p) => `- ${p.asignatura} (examen ${p.fechaExamen}, ID ${p.id}): ${p.pendientes} sesiones pendientes de ${p.entradas.length}`).join('\n');
    },
    registrar_avance_estudio: (args, opciones) => {
      const res = registrarAvance(args.criterio, { fecha: args.fecha }, { rutaArchivo: opciones.rutaPlanesEstudio });
      if (res.ok) return `Sesion completada, David: ${res.plan.asignatura} (${res.entrada.fecha}, ${res.entrada.tipo}).`;
      if (res.coincidencias) return `${res.error}\n` + res.coincidencias.map((p) => `- ${p.asignatura} (ID: ${p.id})`).join('\n');
      return res.error;
    },
    programar_recordatorios_estudio: (args, opciones) => {
      const res = programarRecordatoriosPlan(args.criterio, args.hora, { rutaArchivo: opciones.rutaPlanesEstudio, crearRecordatorio: opciones.crearRecordatorioEstudio });
      if (res.ok) return `Recordatorios programados, David: ${res.recordatorios} sesiones de ${res.plan.asignatura} a las ${res.plan.horaEstudio}.${res.aviso ? ` ${res.aviso}` : ''}`;
      if (res.coincidencias) return `${res.error}\n` + res.coincidencias.map((p) => `- ${p.asignatura} (ID: ${p.id})`).join('\n');
      return res.error;
    },
    crear_flashcard: (args, opciones) => {
      const depsFlash = { rutaArchivo: opciones.rutaArchivoFlashcards, tenantId: opciones.tenantId, store: opciones.flashcardsStore };
      const res = agregarFlashcard({ asignatura: args.asignatura, pregunta: args.pregunta, respuesta: args.respuesta }, depsFlash);
      if (!res.ok) return `No se pudo crear la tarjeta: ${res.error}`;
      const resumen = resumenFlashcards(depsFlash);
      return `Tarjeta creada, David: [${res.tarjeta.asignatura}] "${res.tarjeta.pregunta}" (ID: ${res.tarjeta.id}). Llevas ${resumen.total} tarjetas, ${resumen.pendientes} pendientes de repaso. Las rondas proactivas estan desactivadas hasta que las actives tu ("activa el repaso de flashcards").`;
    },
    configurar_repaso_flashcards: (args, opciones) => {
      const quiereActivarF = args.activo === true;
      const mensajePideActivarF = /(activa(r|s|do)?|enciend(e|er)|pon\s+en\s+marcha)\s+.{0,30}(repaso|flashcard)/i.test(opciones.mensajeUsuario || '');
      const activoAplicarF = quiereActivarF ? (mensajePideActivarF ? true : null) : (args.activo ?? null);
      const depsFlash = { rutaArchivo: opciones.rutaArchivoFlashcards, rutaConfig: opciones.rutaConfigFlashcards, tenantId: opciones.tenantId, store: opciones.flashcardsStore };
      const res = configurarRepaso({
        activo: activoAplicarF,
        cadenciaHoras: args.cadenciaHoras ?? null,
        silencioDesde: args.silencioDesde ?? null,
        silencioHasta: args.silencioHasta ?? null
      }, depsFlash);
      if (res.ok && quiereActivarF && !mensajePideActivarF) {
        return 'Configuracion guardada, pero NO he activado las rondas de repaso porque tu mensaje no lo pedia explicitamente. Si las quieres, dime "activa el repaso de flashcards".';
      }
      if (!res.ok) return `No se pudo configurar el repaso: ${res.error}`;
      let estadoMonitor = '';
      if (res.config.activo) {
        const monitor = iniciarMonitorFlashcards(depsFlash);
        estadoMonitor = monitor.iniciado ? ' Monitor de repaso activo.' : ` Monitor en espera: ${monitor.motivo}`;
      }
      return `Repaso de flashcards ${res.config.activo ? 'ACTIVO' : 'desactivado'}, David: cadencia ${res.config.cadenciaHoras} h, silencio ${res.config.silencioDesde}:00-${res.config.silencioHasta}:00, maximo 3 tarjetas por ronda.${estadoMonitor}`;
    },
    repasar_flashcards: (args, opciones) => {
      const depsRepaso = { rutaArchivo: opciones.rutaArchivoFlashcards, tenantId: opciones.tenantId, store: opciones.flashcardsStore };
      const pendientes = pendientesDeRepaso({ limite: args.limite || 3 }, depsRepaso);
      if (pendientes.length === 0) {
        const resumen = resumenFlashcards(depsRepaso);
        return resumen.total === 0
          ? 'Aun no hay tarjetas creadas.'
          : `Nada que repasar ahora. Llevas ${resumen.total} tarjetas; vuelve cuando toque revision.`;
      }
      return 'Tocan estas tarjetas (responde mentalmente y luego dame tu nota del 0 al 5 con responder_flashcard):\n' + pendientes.map((t, i) => `${i + 1}. [${t.asignatura}] ${t.pregunta} (ID: ${t.id})`).join('\n');
    },
    responder_flashcard: (args, opciones) => {
      const res = registrarRespuesta(args.id, args.calidad, { rutaArchivo: opciones.rutaArchivoFlashcards, tenantId: opciones.tenantId, store: opciones.flashcardsStore });
      if (!res.ok) return res.error;
      const dias = res.tarjeta.repaso.intervaloDias;
      const cuando = dias < 1 ? 'en 12 horas' : `en ${dias} dia(s)`;
      return res.acierto
        ? `Anotado, David: acierto. "${res.tarjeta.pregunta}" vuelve ${cuando}.`
        : `Anotado, David: fallo. "${res.tarjeta.pregunta}" vuelve ${cuando}; la respuesta era: ${res.tarjeta.respuesta}`;
    },
    registrar_candidatura: (args, opciones) => {
      const res = registrarCandidatura({
        empresa: args.empresa,
        puesto: args.puesto,
        url: args.url,
        estado: args.estado || 'registrada',
        notas: args.notas,
        seguimientoDias: args.seguimientoDias
      }, { rutaArchivo: opciones.rutaArchivoCandidaturas });
      if (res.ok) {
        const seg = res.recordatorio && res.recordatorio.ok !== false ? ' Recordatorio de seguimiento creado.' : '';
        return `Candidatura registrada, David: ${res.candidatura.puesto} en ${res.candidatura.empresa} (estado: ${res.candidatura.estado}, ID: ${res.candidatura.id}).${seg}`;
      }
      return `No se pudo registrar la candidatura: ${res.error}`;
    },
    listar_candidaturas: (args, opciones) => {
      const lista = listarCandidaturas({ estado: args.estado || null }, { rutaArchivo: opciones.rutaArchivoCandidaturas });
      if (lista.length === 0) {
        const resumen = resumenCandidaturas({ rutaArchivo: opciones.rutaArchivoCandidaturas });
        return resumen.total === 0
          ? 'Aun no hay candidaturas registradas.'
          : `No hay candidaturas en ese estado. Resumen actual: ${Object.entries(resumen.porEstado).filter(([, n]) => n > 0).map(([e, n]) => `${e}: ${n}`).join(', ')}.`;
      }
      return 'Candidaturas:\n' + lista.map((c, i) => `${i + 1}. ${c.puesto} en ${c.empresa} [${c.estado}] (ID: ${c.id})${c.url ? ` - ${c.url}` : ''}`).join('\n');
    },
    actualizar_candidatura: (args, opciones) => {
      const res = actualizarCandidatura(args.criterio, { estado: args.estado || null, notas: args.notas || null }, { rutaArchivo: opciones.rutaArchivoCandidaturas });
      if (res.ok) return `Candidatura actualizada, David: ${res.candidatura.puesto} en ${res.candidatura.empresa} pasa a estado [${res.candidatura.estado}].`;
      if (res.coincidencias) return `${res.error}\n` + res.coincidencias.map((c) => `- ${c.puesto} en ${c.empresa} [${c.estado}] (ID: ${c.id})`).join('\n');
      return res.error;
    },
    escanear_ofertas_empleo: async (_args, opciones) => {
      const res = await escanearRadar(opciones.radarDeps || {});
      if (!res.escaneado) return `Radar no escaneado: ${res.motivo}`;
      const estadoFuentes = res.fuentes.map((f) => `${f.fuente}: ${f.estado}${f.detalle ? ` (${f.detalle})` : ''}`).join('; ');
      return res.nuevas.length === 0
        ? `Escaneo completado sin ofertas nuevas. Fuentes: ${estadoFuentes}.`
        : `Radar: ${res.nuevas.length} oferta(s) nueva(s):\n` + res.nuevas.map((o, i) => `${i + 1}. ${o.titulo} - ${o.empresa || 'Sin empresa'}${o.url ? ` (${o.url})` : ''}`).join('\n') + `\nFuentes: ${estadoFuentes}.`;
    },
    configurar_radar_ofertas: (args, opciones) => {
      const quiereActivar = args.activo === true;
      const mensajePideActivar = /(activa(r|s|do)?|enciend(e|er)|pon\s+en\s+marcha|arranca(r)?)\s+(el\s+)?radar|radar\s+(activo|activado|en\s+marcha)/i.test(opciones.mensajeUsuario || '');
      const activoAplicar = quiereActivar ? (mensajePideActivar ? true : null) : (args.activo ?? null);
      const res = configurarRadar({
        palabrasClave: args.palabrasClave || null,
        ubicacion: args.ubicacion || null,
        remoto: args.remoto ?? null,
        activo: activoAplicar
      }, opciones.radarDeps || {});
      if (res.ok && quiereActivar && !mensajePideActivar) {
        const cfgPendiente = leerConfigRadar(opciones.radarDeps || {});
        return `Configuracion guardada, pero NO he activado el radar porque tu mensaje no lo pedia explicitamente (estado actual: ${cfgPendiente.activo ? 'activo' : 'desactivado'}). Si quieres activarlo, dimelo claramente: "activa el radar".`;
      }
      if (!res.ok) return `No se pudo configurar el radar: ${res.error}`;
      const cfg = leerConfigRadar(opciones.radarDeps || {});
      let estadoMonitor = '';
      if (cfg.activo) {
        const monitor = iniciarMonitorRadar(opciones.radarDeps || {});
        estadoMonitor = monitor.iniciado ? ' Monitor de rondas activo.' : ` Monitor en espera: ${monitor.motivo}`;
      }
      return `Radar configurado, David: palabras clave [${cfg.palabrasClave.join(', ')}], ubicacion ${cfg.ubicacion || 'sin definir'}, estado ${cfg.activo ? 'ACTIVO' : 'desactivado'}.${estadoMonitor} La fuente InfoJobs requiere credenciales (INFOJOBS_CLIENT_ID/SECRET) para devolver ofertas reales; las fuentes HTML solo se editan en el fichero de configuracion.`;
    },
    iniciar_simulacro_entrevista: async (args, opciones) => {
      const res = await iniciarEntrevista({ rol: args.rol, nivel: args.nivel }, { rutaArchivo: opciones.rutaArchivoEntrevistas, chatId: opciones.chatId, chatCompletion: opciones.chatCompletion });
      return res.ok ? `Simulacro abierto (${res.total} preguntas; se sale con "terminar entrevista"). Pregunta 1:\n${res.pregunta}` : res.error;
    },
    analizar_cv_oferta: async (args, opciones) => {
      const res = await analizarCvContraOferta({ oferta: args.oferta, cvTexto: args.cvTexto }, { carpetaNotas: opciones.carpetaNotas, chatCompletion: opciones.chatCompletion });
      return res.ok ? `Analisis del CV (fuente: ${res.fuenteCv}):\n${res.analisis}` : res.error;
    },
    resumir_apuntes: async (args, opciones) => {
      const res = await resumirApuntes({ texto: args.texto, criterio: args.criterio }, { carpetaNotas: opciones.carpetaNotas, chatCompletion: opciones.chatCompletion });
      return res.ok ? res.resumen + (res.fuentes && res.fuentes.length ? `\n\nApuntes usados: ${res.fuentes.join(', ')}` : '') : res.error;
    },
    registrar_entrega: (args, opciones) => {
      const res = registrarEntrega({ titulo: args.titulo, fecha: args.fecha, tipo: args.tipo }, { rutaArchivo: opciones.rutaArchivoEntregas });
      return res.ok ? `Apuntado, David: ${res.entrega.tipo} "${res.entrega.titulo}" el ${res.entrega.fecha}. Si quieres un aviso concreto, pideme un recordatorio para cuando te venga bien.` : res.error;
    },
    listar_entregas: (_args, opciones) => {
      const lista = listarEntregas({ rutaArchivo: opciones.rutaArchivoEntregas });
      return lista.length === 0
        ? 'No tienes entregas ni examenes apuntados. Dime por ejemplo: "apunta un examen de estadistica el 2026-12-15".'
        : 'Tus entregas y examenes:\n' + lista.map((e) => `- [${e.tipo}] ${e.titulo}: ${e.fecha} (${e.dias < 0 ? `paso hace ${-e.dias} dias` : e.dias === 0 ? 'HOY' : `quedan ${e.dias} dias`})`).join('\n');
    },
    eliminar_entrega: (args, opciones) => {
      const res = eliminarEntrega(args.criterio, { rutaArchivo: opciones.rutaArchivoEntregas });
      return res.ok ? `Eliminada, David: "${res.borrada.titulo}" del ${res.borrada.fecha}.` : res.error;
    }
  };
}
