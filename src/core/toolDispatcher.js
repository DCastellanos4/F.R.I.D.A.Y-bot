/**
 * toolDispatcher.js - Registro modular por dominio para la ejecucion de herramientas.
 *
 * Extrae el despacho de herramientas de jarvisAgent.js manteniendo intactas
 * todas las firmas, contratos de respuesta y compatibilidad con mocks/deps.
 *
 * Politica estricta: cero emojis en codigo, comentarios y respuestas.
 */

import { consultarEventos, crearEvento, modificarEvento, cancelarEvento } from '../services/calendarService.js';
import { crearRamaTrabajo, crearCommit, abrirPullRequest, empujarRama, ejecutarTareaProgramacion } from '../services/githubAgentService.js';
import { config } from '../config/config.js';
import { explicarUltimoRecorrido } from '../services/traceService.js';
import { obtenerNoticiasEstructuradas } from '../services/newsService.js';
import { crearRecordatorio, listarRecordatorios, cancelarRecordatorio } from '../services/reminderService.js';
import { programarMensaje, listarMensajesProgramados, cancelarMensajeProgramado } from '../services/scheduledMessageService.js';
import { generarResumenInteligente } from '../services/summarizerService.js';
import { navegarYExtraerArticulo } from '../services/browserService.js';
import { consultarSaludServidor, comprobarPuertoTCP } from '../monitors/proactiveAlerts.js';
import { guardarMemoria, buscarMemorias, listarMemorias, olvidarMemoria } from '../services/memoryService.js';
import { registrarBorradoMasivoPendiente } from '../services/destructiveActionService.js';
import { proponerSkill, listarSkills, ejecutarSkill } from '../services/skillsService.js';
import { vigilarProducto, listarProductosVigilados, cancelarVigilancia } from '../monitors/sniperService.js';
import { consultarClima } from '../services/weatherService.js';
import { registrarCandidatura, listarCandidaturas, actualizarCandidatura, resumenCandidaturas } from '../services/applicationTrackerService.js';
import { crearPlanEstudio, listarPlanes, registrarAvance, programarRecordatoriosPlan } from '../services/studyPlannerService.js';
import { agregarFlashcard, pendientesDeRepaso, registrarRespuesta, listarFlashcards, resumenFlashcards, configurarRepaso, iniciarMonitorFlashcards } from '../services/flashcardService.js';
import { registrarGasto, listarGastos, resumenMensual, registrarSuscripcion, listarSuscripciones, configurarPresupuesto, estadoPresupuestos, configurarAvisosSuscripciones } from '../services/financeService.js';
import { registrarProceso, dejarDeVigilar, listarProcesos, configurarVigilancia } from '../services/processWatchdogService.js';
import { activarTraductor, desactivarTraductor } from '../services/translatorModeService.js';
import { buscarEnHistorial } from '../services/historySearchService.js';
import { registrarFechaSenalada, listarFechasSenaladas, eliminarFechaSenalada, proximasFechas, configurarAvisosFechas } from '../services/specialDatesService.js';
import { programarSnooze, listarSnoozes, cancelarSnooze } from '../services/snoozeService.js';
import { estadisticasChat } from '../services/groupStatsService.js';
import { registrarAvisoLlegada, listarAvisosLlegada, cancelarAvisoLlegada } from '../services/arrivalWatchService.js';
import { registrarParadaFavorita, listarParadasFavoritas, eliminarParadaFavorita, proximasLlegadas, extraerDestinoHacia, extraerOrigenDesde } from '../services/transportService.js';
import { registrarContacto, buscarContacto, listarContactos } from '../services/contactsService.js';
import { buscarSemantico } from '../services/brainSearchService.js';
import { generarDigest, configurarDigestSemanal } from '../services/brainDigestService.js';
import { generarWiki } from '../services/wikiService.js';
import { capturarPagina } from '../services/capturaService.js';
import { preguntarDocumentos } from '../services/preguntasDocumentosService.js';
import { escribirDiario, leerDiario } from '../services/diaryService.js';
import { registrarHabito, marcarHabito, listarHabitos } from '../services/habitsService.js';
import { ponerMenu, verMenu, sugerirMenu } from '../services/menuService.js';
import { anadirCompra, listarCompra, tacharCompra, vaciarCompra } from '../services/shoppingService.js';
import { recomendarSeriePelicula } from '../services/recommenderService.js';
import { crearQuedada, listarQuedadas, redactarInvitacion } from '../services/quedadasService.js';
import { resumenDeportivo } from '../services/sportsService.js';
import { configurarModoNocturno } from '../services/quietHoursService.js';
import { iniciarEntrevista } from '../services/interviewService.js';
import { analizarCvContraOferta } from '../services/cvAnalyzerService.js';
import { resumirApuntes } from '../services/notesSummarizerService.js';
import { anotarIdea, listarIdeas, priorizarIdeas, generarEntradaChangelog, guiarDepuracion, revisarPullRequest } from '../services/devToolsService.js';
import { auditarDependencias, configurarVigilanciaDependencias, informeMetricas, configurarInformeMetricas, actividadRepos, configurarAlertasRepos, crearBackupSesion, verificarBackupSesion } from '../services/opsService.js';
import { encenderPc, listarDispositivosRed, configurarVigilanciaRed, controlarDomotica, estadoDescargas, configurarAvisoDescargas, estimarFacturaOracle } from '../services/hogarService.js';
import { consultarCuotaTexto, procesarUpgradePlan } from '../services/tenantSelfService.js';
import { vigilarRuta, listarRutasVigiladas, cancelarVigilanciaRuta, registrarPrecioRuta } from '../services/viajesService.js';
import { registrarEntrega, listarEntregas, eliminarEntrega } from '../services/deadlinesService.js';
import { buscarProducto, verificarOferta } from '../services/productSearchService.js';
import { escanearRadar, configurarRadar, leerConfigRadar, iniciarMonitorRadar } from '../services/jobRadarService.js';
import { setVipMode, isVipModeActive, addVipContact, getVipContacts } from '../services/vipFilterService.js';
import { generateGroupSummary } from '../services/groupSummarizerService.js';
import { downloadMedia } from '../services/mediaDownloaderService.js';
import { savePersonalNote, listRecentNotes } from '../services/notesService.js';
import { requestExecution } from '../system/bashConsoleService.js';
import { generatePassword, generatePin, generateToken, generateCryptoKey, saveCredentialToMemory } from '../services/cryptoGeneratorService.js';
import { inspectContainers } from '../monitors/dockerMonitorService.js';
import { checkDiskUsage } from '../system/diskStorageService.js';
import { readNetworkBytes } from '../monitors/networkMonitorService.js';
import { checkCertificateExpiry } from '../monitors/sslMonitorService.js';
import { getTunnelStatus, startTunnel, stopTunnel } from '../system/tunnelManagerService.js';
import { createEncryptedBackup } from '../system/backupService.js';
import { guardarReglaProcedural, listarReglasProcedurales, eliminarReglaProcedural } from '../services/proceduralMemoryService.js';
import { formatearRutinasAprendidas } from '../services/habitPatternPredictorService.js';

export function depsFinanzasDe(opciones = {}) {
  const store = opciones.storeFinanzas || opciones.financeStore || opciones.store;
  return {
    tenantId: opciones.tenantId,
    ...(store ? { store } : {}),
    ...(!store && opciones.rutaArchivoFinanzas ? { rutaArchivo: opciones.rutaArchivoFinanzas } : {})
  };
}

export function depsHabitosDe(opciones = {}) {
  const store = opciones.storeHabitos || opciones.habitsStore || opciones.store;
  return {
    tenantId: opciones.tenantId,
    ...(store ? { store } : {}),
    ...(!store && opciones.rutaArchivoHabitos ? { rutaArchivo: opciones.rutaArchivoHabitos } : {})
  };
}

export function depsCompraDe(opciones = {}) {
  const store = opciones.storeCompra || opciones.shoppingStore || opciones.store;
  return {
    tenantId: opciones.tenantId,
    ...(store ? { store } : {}),
    ...(!store && opciones.rutaArchivoCompra ? { rutaArchivo: opciones.rutaArchivoCompra } : {})
  };
}

export function depsTransporteDe(opciones = {}) {
  return {
    rutaArchivo: opciones.rutaArchivoTransporte,
    fetchFn: opciones.fetchFnTransporte,
    fetchFnEmt: opciones.fetchFnEmt,
    fetchFnCercanias: opciones.fetchFnCercanias,
    clientIdEmt: opciones.clientIdEmt,
    passKeyEmt: opciones.passKeyEmt,
    rutaCache: opciones.rutaCacheEstacionesRenfe,
    rutaCacheHorarios: opciones.rutaCacheHorariosRenfe,
    ahora: opciones.ahoraTransporte
  };
}

export function repoMemoriaDe(opciones = {}) {
  const repo = opciones && opciones.memoryRepository;
  return {
    guardar: repo && typeof repo.guardar === 'function' ? repo.guardar : guardarMemoria,
    buscar: repo && typeof repo.buscar === 'function' ? repo.buscar : buscarMemorias,
    listar: repo && typeof repo.listar === 'function' ? repo.listar : listarMemorias,
    olvidar: repo && typeof repo.olvidar === 'function' ? repo.olvidar : olvidarMemoria
  };
}

export function textoResultadoTransporte(res) {
  if (!res.ok) return res.error;
  if (res.contrastados && res.contrastados.length > 0) {
    const lineasContr = res.contrastados.map((c) => `- ${c.hora}${c.destino ? ' a ' + c.destino : ''} (${c.viaje || 'Tren'}): ${c.estado}`);
    return `Horarios contrastados para ${res.parada} (Horario oficial vs Feed API en tiempo real):\n${lineasContr.join('\n')}${res.nota ? '\n' + res.nota : ''}`;
  }
  if (res.llegadas.length === 0) {
    if (res.programadas && res.programadas.length > 0) {
      const lineasProg = res.programadas.map((p) => `- ${p.hora}${p.destino ? ' a ' + p.destino : ''} (programado)`);
      return `No hay trenes con informacion en vivo para ${res.parada} ahora mismo. Proximas salidas programadas de hoy:\n${lineasProg.join('\n')}${res.nota ? '\n' + res.nota : ''}`;
    }
    return `No hay llegadas con informacion en vivo para ${res.parada} ahora mismo.${res.nota ? ' ' + res.nota : ''}`;
  }
  const lineas = res.llegadas.map((l) => {
    const min = Math.max(0, Math.round(l.segundos / 60));
    if (res.tipo === 'emt') return `- Linea ${l.linea}${l.destino ? ' a ' + l.destino : ''}: ${l.segundos < 60 ? 'llegando' : Math.round(l.segundos / 60) + ' min'}`;
    return `- Tren ${l.viaje}: ${min === 0 ? 'llegando' : min + ' min'}${l.retrasoSegundos ? ` (retraso ${Math.round(l.retrasoSegundos / 60)} min)` : ''}${l.cancelado ? ' CANCELADO' : ''}`;
  });
  return `Proximas llegadas a ${res.parada}:\n${lineas.join('\n')}${res.nota ? '\n' + res.nota : ''}`;
}

function depsCalendarioDe(opciones = {}) {
  return {
    rutaArchivo: opciones.rutaArchivoCalendario,
    apiKey: opciones.googleCalendarApiKey,
    accessToken: opciones.googleCalendarToken,
    calendarId: opciones.googleCalendarId,
    fetchFn: opciones.fetchFnCalendar
  };
}

function crearManejadoresCalendario() {
  return {
    consultar_eventos: async (args, opciones) => {
      const res = await consultarEventos({ desde: args.desde, hasta: args.hasta }, depsCalendarioDe(opciones));
      if (!res.ok) return res.error || 'No se pudieron consultar los eventos del calendario.';
      if (!Array.isArray(res.eventos) || res.eventos.length === 0) {
        return 'No hay eventos programados en ese rango de fechas.';
      }
      const lineas = res.eventos.map((e) => `- ${e.inicio}${e.fin ? ' -> ' + e.fin : ''}: ${e.titulo}${e.descripcion ? ` (${e.descripcion})` : ''}`);
      return `Eventos encontrados (${res.eventos.length}):\n${lineas.join('\n')}`;
    },
    crear_evento: async (args, opciones) => {
      const res = await crearEvento({
        titulo: args.titulo,
        inicio: args.inicio,
        fin: args.fin,
        descripcion: args.descripcion
      }, depsCalendarioDe(opciones));
      return !res.ok ? res.error : `Evento registrado: "${res.evento.titulo}" el ${res.evento.inicio}${res.evento.fin ? ' hasta ' + res.evento.fin : ''}.`;
    },
    modificar_evento: async (args, opciones) => {
      const res = await modificarEvento({
        id: args.id,
        criterio: args.criterio,
        titulo: args.titulo,
        inicio: args.inicio,
        fin: args.fin,
        descripcion: args.descripcion
      }, depsCalendarioDe(opciones));
      return !res.ok ? res.error : `Evento modificado: "${res.evento.titulo}" (inicio: ${res.evento.inicio}).`;
    },
    cancelar_evento: async (args, opciones) => {
      const res = await cancelarEvento({
        id: args.id,
        criterio: args.criterio,
        titulo: args.titulo
      }, depsCalendarioDe(opciones));
      return !res.ok ? res.error : `Evento cancelado (${res.cancelados} evento(s) eliminado(s)).`;
    }
  };
}

function crearManejadoresFinanzas() {
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

function crearManejadoresMemoriaYCerebro() {
  return {
    guardar_memoria: (args, opciones) => {
      const res = repoMemoriaDe(opciones).guardar({
        sujeto: args.sujeto,
        dato: args.dato,
        categoria: args.categoria,
        rutaArchivo: opciones.rutaArchivoMemorias
      }, { rutaArchivo: opciones.rutaArchivoMemorias });
      return res.ok
        ? `Dato guardado con éxito en el Second Brain. Sujeto: "${res.memoria.sujeto}". Detalle: "${res.memoria.dato}". Fecha: ${res.memoria.fechaLocal}.`
        : `Error al guardar en la memoria: ${res.error}`;
    },
    buscar_memoria: (args, opciones) => {
      const memorias = repoMemoriaDe(opciones).buscar(args.consulta, { rutaArchivo: opciones.rutaArchivoMemorias });
      return memorias.length === 0
        ? `No encontré ningún recuerdo previo sobre "${args.consulta}" en el Second Brain, señor.`
        : 'Recuerdos recuperados del Second Brain:\n' + memorias.map((m) => `- [${m.sujeto.toUpperCase()}]: ${m.dato} (Registrado: ${m.fechaLocal})`).join('\n');
    },
    listar_memorias: (args, opciones) => {
      const memorias = repoMemoriaDe(opciones).listar(args.categoria, { rutaArchivo: opciones.rutaArchivoMemorias });
      return memorias.length === 0
        ? 'Actualmente no hay ningún dato guardado en el Second Brain, señor.'
        : `Recuerdos almacenados en el Second Brain (${memorias.length}):\n` + memorias.map((m, i) => `${i + 1}. [${m.sujeto.toUpperCase()}]: ${m.dato}`).join('\n');
    },
    olvidar_memoria: (args, opciones) => {
      const res = repoMemoriaDe(opciones).olvidar(args.criterio, { confirmado: false, rutaArchivo: opciones.rutaArchivoMemorias });
      if (res.requiereConfirmacion) {
        const idConfirmacion = (!opciones.tenantId || opciones.tenantId === 'propietario') && opciones.chatId
          ? registrarBorradoMasivoPendiente(opciones.chatId, String(args.criterio), res.total)
          : null;
        return idConfirmacion
          ? `ATENCION: borrado masivo pendiente de confirmacion humana. ${res.mensaje} Indica a David que, si esta seguro, responda exactamente "confirmar borrado ${idConfirmacion}" (validez: 5 minutos). Tu no puedes confirmarlo ni volver a intentarlo con otro argumento.`
          : `ATENCION: borrado masivo solicitado sin canal de confirmacion directa (${res.total} registros). Solo puede confirmarse desde el chat de WhatsApp de David. Tu no puedes confirmarlo.`;
      }
      return res.mensaje || res.error || 'Operación completada, señor.';
    },
    guardar_regla_procedural: (args, opciones) => {
      const res = guardarReglaProcedural({
        regla: args.regla,
        dominio: args.dominio,
        origen: 'herramienta'
      }, {
        rutaArchivo: opciones.rutaArchivoProcedural,
        tenantId: opciones.tenantId,
        store: opciones.proceduralStore
      });
      return res.ok
        ? (res.duplicada ? `Esa regla ya estaba registrada: "${res.regla.regla}".` : `Regla operativa guardada (${res.regla.dominio}): "${res.regla.regla}" (ID: ${res.regla.id}).`)
        : res.error;
    },
    listar_reglas_procedurales: (args, opciones) => {
      const lista = listarReglasProcedurales({
        rutaArchivo: opciones.rutaArchivoProcedural,
        tenantId: opciones.tenantId,
        store: opciones.proceduralStore,
        dominio: args.dominio
      });
      return lista.length === 0
        ? 'No tienes reglas operativas ni preferencias guardadas todavia.'
        : 'Reglas operativas activas:\n' + lista.map((r) => `- [${r.dominio}] ${r.regla} (ID: ${r.id})`).join('\n');
    },
    eliminar_regla_procedural: (args, opciones) => {
      const res = eliminarReglaProcedural(args.criterio, {
        rutaArchivo: opciones.rutaArchivoProcedural,
        tenantId: opciones.tenantId,
        store: opciones.proceduralStore
      });
      return res.ok ? `Regla operativa eliminada (${res.eliminadas} actualizada(s)).` : res.error;
    },
    consultar_rutinas_aprendidas: (args, opciones) => formatearRutinasAprendidas({
      rutaArchivo: opciones.rutaArchivoRutinas,
      tenantId: opciones.tenantId,
      store: opciones.routineStore,
      umbralMinimo: args?.umbralMinimo
    }),
    buscar_recuerdo_semantico: async (args, opciones) => {
      const res = await buscarSemantico(args.consulta, { carpetaNotas: opciones.carpetaNotas, rutaArchivoMemorias: opciones.rutaArchivoMemorias, chatCompletion: opciones.chatCompletion, qdrantSecondBrain: opciones.qdrantSecondBrain, buscadorHibrido: opciones.buscadorHibrido, tenantId: opciones.tenantId });
      return !res.ok ? res.error
        : res.resultados.length === 0 ? 'No encuentro nada relacionado en tus memorias ni en tus notas.'
        : `He encontrado esto${res.semantica ? '' : ' (busqueda por palabras; sin el modelo no puedo hacerla semantica)'}:\n` + res.resultados.map((r) => `- [${r.tipo}] ${r.texto.slice(0, 200)}`).join('\n');
    },
    generar_digest_cerebro: async (args, opciones) => {
      const res = await generarDigest({ dias: args.dias }, { carpetaNotas: opciones.carpetaNotas, chatCompletion: opciones.chatCompletion });
      return res.ok ? res.texto : res.error;
    },
    configurar_digest_semanal: (args, opciones) => {
      const pideActivarDigest = /(activa(r|s|do)?|enciend(e|er)|pon\s+en\s+marcha)\s+.{0,30}(digest|resumen\s+semanal)/i.test(opciones.mensajeUsuario || '');
      if (args.activo === true && !pideActivarDigest) {
        return 'Para activar el digest semanal necesito que me lo pidas tu directamente (por ejemplo: "activa el digest semanal").';
      }
      const res = configurarDigestSemanal({ activo: args.activo === true }, { rutaArchivo: opciones.rutaArchivoDigest, carpetaNotas: opciones.carpetaNotas });
      return res.ok
        ? (res.activo ? 'Digest semanal activado, David: te lo mando los lunes por la manana si hay novedades.' : 'Digest semanal desactivado, David.')
        : `No he podido cambiar el digest: ${res.error}`;
    },
    generar_wiki: (_args, opciones) => {
      const res = generarWiki({ carpetaNotas: opciones.carpetaNotas });
      return res.ok ? `Wiki regenerada, David: ${res.total} notas en ${res.categorias} categorias. Indice en ${res.rutaIndice}.` : res.error;
    },
    capturar_pagina: async (args, opciones) => {
      const res = await capturarPagina({ url: args.url, titulo: args.titulo }, { extraerArticulo: opciones.extraerArticulo, carpetaNotas: opciones.carpetaNotas });
      return res.ok ? `Capturada y archivada en tus notas, David: "${res.titulo}".` : res.error;
    },
    preguntar_documentos: async (args, opciones) => {
      const res = await preguntarDocumentos({ pregunta: args.pregunta }, { carpetaNotas: opciones.carpetaNotas, chatCompletion: opciones.chatCompletion });
      return res.ok ? res.respuesta : res.error;
    },
    guardar_nota_personal: async (args, opciones) => {
      const res = await savePersonalNote(args.texto, { category: args.categoria, tags: args.etiquetas, carpetaNotas: opciones.carpetaNotas });
      if (res.ok && opciones.qdrantSecondBrain && typeof opciones.qdrantSecondBrain.indexarTodasLasNotas === 'function') {
        opciones.qdrantSecondBrain.indexarTodasLasNotas({ tenantId: opciones.tenantId, carpetaNotas: opciones.carpetaNotas }).catch(() => {});
      }
      return res.ok ? `Nota personal guardada en el Second Brain (${res.category}): ${res.filename}.` : `Error al guardar nota: ${res.error}`;
    },
    listar_notas_recientes: async (args, opciones) => {
      const notas = await listRecentNotes(args.limite || 10, { category: args.categoria, carpetaNotas: opciones.carpetaNotas });
      return notas.length === 0 ? 'No hay notas registradas en esta categoría, señor.' : 'Notas registradas en el Second Brain:\n' + notas.map((n) => `- [${n.category}] ${n.filename}: ${n.preview}`).join('\n');
    },
    registrar_contacto: (args, opciones) => {
      const res = registrarContacto({ nombre: args.nombre, telefono: args.telefono, relacion: args.relacion, email: args.email, notas: args.notas }, {
        rutaArchivo: opciones.rutaArchivoContactos,
        tenantId: opciones.tenantId,
        store: opciones.contactsStore
      });
      return res.ok ? `Ficha guardada, David: ${res.contacto.nombre}${res.contacto.telefono ? ` (${res.contacto.telefono})` : ''}.` : res.error;
    },
    buscar_contacto: (args, opciones) => {
      const res = buscarContacto(args.criterio, {
        rutaArchivo: opciones.rutaArchivoContactos,
        tenantId: opciones.tenantId,
        store: opciones.contactsStore,
        knowledgeGraphStore: opciones.knowledgeGraphStore,
        memoryStore: opciones.memoryRepository || opciones.memoryStore
      });
      return !res.ok ? res.error
        : res.contactos.length === 0 ? `No encuentro contactos que encajen con "${args.criterio}".`
        : res.contactos.map((c) => `- ${c.nombre}${c.telefono ? `: ${c.telefono}` : ''}${c.relacion ? ` (${c.relacion})` : ''}${c.notas ? ` - ${c.notas}` : ''}`).join('\n');
    },
    listar_contactos: (_args, opciones) => {
      const lista = listarContactos({ rutaArchivo: opciones.rutaArchivoContactos, tenantId: opciones.tenantId, store: opciones.contactsStore });
      return lista.length === 0
        ? 'No tienes contactos guardados. Dime por ejemplo: "apunta el contacto de Ana, 600123123, amiga de la uni".'
        : 'Tus contactos:\n' + lista.map((c) => `- ${c.nombre}${c.telefono ? `: ${c.telefono}` : ''}${c.relacion ? ` (${c.relacion})` : ''}`).join('\n');
    }
  };
}

function crearManejadoresEstudioYCarrera() {
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

function crearManejadoresOpsYSeguridad() {
  return {
    consultar_estado_servidor: async () => {
      const salud = consultarSaludServidor();
      const mcOnline = await comprobarPuertoTCP(config.minecraft.host, config.minecraft.port, 2000);
      return `Salud del sistema:\n- Memoria RAM: ${salud.libreRamGB} GB libres de ${salud.totalRamGB} GB (${salud.porcentajeUso}% en uso)\n- Procesador: ${salud.cpus} núcleos (Carga media: ${salud.loadAvg})\n- Servidor de Minecraft (${config.minecraft.host}:${config.minecraft.port}): ${mcOnline ? 'ONLINE' : 'CAIDO / APAGADO'}`;
    },
    execute_bash_command: async (args, opciones) => {
      const cmd = args.comando || '';
      const res = await requestExecution(cmd, { otpDelivery: opciones.otpDelivery });
      if (res.status === 'EXECUTED') {
        let out = `Comando ejecutado con exito (Codigo: ${res.exitCode}):\n${res.stdout || res.stderr || 'Comando completado sin salida'}`;
        if (res.verificacion) {
          out += `\nVerificacion posterior (${res.verificacion.comando}): ${res.verificacion.exito ? 'efecto confirmado en el sistema' : 'NO se pudo confirmar el efecto'}.\n${res.verificacion.salida}`;
        }
        return out;
      }
      if (res.status === 'OTP_REQUIRED') {
        return res.otpDelivered
          ? `El comando "${cmd}" es critico (${res.reason}). He enviado un codigo OTP de 6 digitos al canal privado de David (validez: ${res.ttlSeconds} segundos, ID: ${res.commandId}). Indicale que lo confirme respondiendo "confirmar otp CODIGO". Tu no tienes acceso al codigo ni puedes confirmarlo.`
          : `El comando "${cmd}" es critico (${res.reason}) y requiere confirmacion 2FA, pero no hay un canal directo configurado para entregar el codigo OTP (disponible desde WhatsApp o la terminal interactiva). Comando en espera con ID: ${res.commandId}.`;
      }
      if (res.status === 'FORBIDDEN') return `Comando denegado por politica de seguridad: ${res.reason}`;
      return `Fallo en la ejecucion del comando: ${res.error || res.status}`;
    },
    generate_crypto_credential: async (args) => {
      const tipo = (args.tipo || 'password').toLowerCase();
      let valorSecreto = '';
      let info = '';
      if (tipo === 'password') {
        const resPwd = generatePassword(args.longitud || 16, { detailed: true });
        valorSecreto = resPwd.password;
        info = `Password generado (Longitud: ${resPwd.length}, Entropia: ${resPwd.entropy} bits): ${valorSecreto}`;
      } else if (tipo === 'pin') {
        valorSecreto = generatePin(args.longitud || 6);
        info = `PIN numerico generado (${args.longitud || 6} digitos): ${valorSecreto}`;
      } else if (tipo === 'token') {
        valorSecreto = generateToken(args.longitud || 32);
        info = `Token criptografico generado (${args.longitud || 32} bytes): ${valorSecreto}`;
      } else if (tipo === 'key') {
        const algo = args.algoritmo || 'aes-256';
        const resKey = generateCryptoKey(algo, { detailed: true });
        valorSecreto = resKey.key;
        info = `Clave criptografica ${algo.toUpperCase()} (${resKey.bitLength} bits): ${valorSecreto}`;
      } else {
        valorSecreto = generatePassword(16);
        info = `Credencial generada: ${valorSecreto}`;
      }
      if (args.guardar_en_memoria) {
        const nombreClave = args.nombre_clave || `Credencial ${tipo.toUpperCase()}`;
        const resMem = await saveCredentialToMemory(nombreClave, valorSecreto, args.notas || '');
        info += resMem.ok
          ? `\nCredencial archivada de forma segura en el Second Brain bajo la clave "${nombreClave}".`
          : `\nAviso: No se pudo archivar en el Second Brain: ${resMem.error}`;
      }
      return info;
    },
    get_infrastructure_status: async (args) => {
      const lineas = ['[ESTADO DE INFRAESTRUCTURA]'];
      if (args.incluir_docker !== false) {
        try {
          const containers = await inspectContainers();
          lineas.push(`Contenedores Docker (${containers.length}):`);
          for (const c of containers) {
            lineas.push(`- ${c.name} (${c.id.slice(0, 12)}): ${c.status} (Uptime: ${c.uptime || 'N/A'})`);
          }
        } catch (errDock) {
          lineas.push(`Docker: Error al consultar estado (${errDock.message})`);
        }
      }
      if (args.incluir_disco !== false) {
        try {
          const disco = checkDiskUsage('/');
          const libreGB = (disco.freeBytes / (1024 ** 3)).toFixed(2);
          const totalGB = (disco.totalBytes / (1024 ** 3)).toFixed(2);
          lineas.push(`Almacenamiento en disco: ${disco.percentUsed}% en uso (${libreGB} GB libres de ${totalGB} GB)`);
        } catch (errDisk) {
          lineas.push(`Disco: Error al inspeccionar almacenamiento (${errDisk.message})`);
        }
      }
      if (args.incluir_red !== false) {
        try {
          const net = await readNetworkBytes();
          const rxMB = (net.rxBytes / (1024 ** 2)).toFixed(2);
          const txMB = (net.txBytes / (1024 ** 2)).toFixed(2);
          lineas.push(`Trafico de red acumulado (${net.iface}): RX ${rxMB} MB | TX ${txMB} MB`);
        } catch (errNet) {
          lineas.push(`Red: No disponible (${errNet.message})`);
        }
      }
      if (args.dominio_ssl) {
        try {
          const ssl = await checkCertificateExpiry(args.dominio_ssl, 443);
          lineas.push(`Certificado SSL (${ssl.host}): ${ssl.daysRemaining} dias restantes (Caduca: ${ssl.validTo})`);
        } catch (errSsl) {
          lineas.push(`SSL (${args.dominio_ssl}): Error al inspeccionar certificado (${errSsl.message})`);
        }
      }
      return lineas.join('\n');
    },
    manage_tunnel: async (args) => {
      const tipo = args.tipo_tunel;
      const accion = args.accion;
      const nombre = args.nombre_tunel;
      if (!tipo) return 'Debes indicar el tipo de tunel (cloudflare o tailscale).';
      if (accion === 'status') {
        const res = await getTunnelStatus(tipo, { tunnelName: nombre });
        return `Estado del tunel ${tipo?.toUpperCase() || 'DESCONOCIDO'}: ${res.running ? 'ACTIVO Y EN LINEA' : 'DETENIDO'} (Instalado: ${res.installed ? 'SI' : 'NO'})`;
      }
      if (accion === 'start') {
        const res = await startTunnel(tipo, { tunnelName: nombre });
        return res.success ? `Tunel ${tipo} iniciado con exito: ${res.message}` : `Fallo al iniciar tunel ${tipo}: ${res.message}`;
      }
      if (accion === 'stop') {
        const res = await stopTunnel(tipo, { tunnelName: nombre });
        return res.success ? `Tunel ${tipo} detenido con exito: ${res.message}` : `Fallo al detener tunel ${tipo}: ${res.message}`;
      }
      return `Accion de tunel desconocida: ${accion}`;
    },
    trigger_encrypted_backup: async () => {
      const pass = process.env.BACKUP_PASSPHRASE || process.env.DAVIS_BACKUP_KEY || '';
      if (!pass) {
        return 'No se puede generar la copia de seguridad: falta BACKUP_PASSPHRASE en el entorno. Sin passphrase configurada no se cifra nada con valores por defecto.';
      }
      try {
        const res = await createEncryptedBackup({ passphrase: pass });
        const tamanoKB = (res.sizeBytes / 1024).toFixed(2);
        return `Copia de seguridad cifrada completada con exito (AES-256-GCM DAVBAK01).\nArchivo: ${res.backupPath}\nTamano: ${tamanoKB} KB (${res.fileCount} ficheros incluidos)\nSHA256: ${res.sha256}`;
      } catch (errBak) {
        return `Error al generar la copia de seguridad cifrada: ${errBak.message}`;
      }
    },
    vigilar_proceso: (args, opciones) => {
      const res = registrarProceso({ nombre: args.nombre, patron: args.patron, cpuLimite: args.cpuLimite, memLimite: args.memLimite }, { rutaArchivo: opciones.rutaArchivoProcesos });
      return res.ok
        ? `Proceso vigilado, David: ${res.proceso.nombre} (patron "${res.proceso.patron}"${res.proceso.cpuLimite ? `, CPU max ${res.proceso.cpuLimite}%` : ''}${res.proceso.memLimite ? `, memoria max ${res.proceso.memLimite}%` : ''}). Recuerda que la vigilancia proactiva se activa aparte, si tu quieres: "activa la vigilancia de procesos".`
        : `No lo he podido registrar: ${res.error}`;
    },
    listar_procesos_vigilados: (_args, opciones) => {
      const lista = listarProcesos({ rutaArchivo: opciones.rutaArchivoProcesos });
      return lista.length === 0
        ? 'No hay procesos vigilados. Registra uno con "vigila el proceso X".'
        : 'Procesos vigilados:\n' + lista.map((x) => `- ${x.nombre} (patron "${x.patron}", estado ${x.estadoActual}${x.cpuLimite ? `, CPU max ${x.cpuLimite}%` : ''}${x.memLimite ? `, mem max ${x.memLimite}%` : ''})`).join('\n');
    },
    dejar_vigilar_proceso: (args, opciones) => {
      const res = dejarDeVigilar(args.criterio, { rutaArchivo: opciones.rutaArchivoProcesos });
      return res.ok ? `Dejo de vigilar "${res.proceso.nombre}", David.` : res.error;
    },
    configurar_vigilante_procesos: (args, opciones) => {
      const pideActivarProc = /(activa(r|s|do)?|enciend(e|er)|pon\s+en\s+marcha)\s+.{0,30}(vigilancia|proceso)/i.test(opciones.mensajeUsuario || '');
      if (args.activo === true && !pideActivarProc) {
        return 'Para activar la vigilancia de procesos necesito que me lo pidas tu directamente (por ejemplo: "activa la vigilancia de procesos").';
      }
      const res = configurarVigilancia({ activo: args.activo === true }, { rutaArchivo: opciones.rutaArchivoProcesos });
      return res.ok
        ? (res.activo ? 'Vigilancia de procesos activada, David: avisare si alguno cae o se pasa de los limites.' : 'Vigilancia de procesos desactivada, David.')
        : `No he podido cambiar la vigilancia: ${res.error}`;
    },
    auditar_dependencias: async () => {
      const res = await auditarDependencias({});
      return !res.ok ? res.error
        : `npm audit: ${res.totales.critica} critica(s), ${res.totales.alta} alta(s), ${res.totales.moderada} moderada(s), ${res.totales.baja} baja(s).\n` +
          (res.vulnerabilidades.length ? 'Principales:\n' + res.vulnerabilidades.map((v) => `- [${v.severidad}] ${v.nombre}${v.viaDirecta ? ' (directa)' : ''}: ${v.correccion}`).join('\n') + '\n' : 'Sin vulnerabilidades listadas.\n') +
          res.nota;
    },
    configurar_vigilancia_dependencias: (args, opciones) => {
      const quiere = args.activo === true;
      const pideTexto = /(activa(r|s|do)?|enciend(e|er)|pon\s+en\s+marcha)\s+.{0,40}(vigilancia|dependencias|audit)/i.test(opciones.mensajeUsuario || '');
      if (quiere && !pideTexto) {
        return 'No he activado la vigilancia de dependencias porque tu mensaje no lo pedia explicitamente. Si la quieres, dime "activa la vigilancia de dependencias".';
      }
      const res = configurarVigilanciaDependencias({ activo: args.activo }, { rutaConfig: opciones.rutaConfigOps });
      return res.activo ? 'Vigilancia de dependencias ACTIVADA: avisare si npm audit encuentra vulnerabilidades graves (criticas o altas).' : 'Vigilancia de dependencias desactivada.';
    },
    informe_metricas: (args, opciones) => {
      const res = informeMetricas({ dias: args.dias ?? 7 }, { rutaArchivo: opciones.rutaArchivoMetricas });
      return `Metricas del bot (ultimos ${res.periodoDias} dias): ${res.totalComandos} comandos, ${res.totalErrores} errores.\n` +
        (res.comandosMasUsados.length ? 'Mas usados:\n' + res.comandosMasUsados.map((c) => `- ${c.nombre}: ${c.usos} uso(s)${c.mediaMs != null ? `, media ${c.mediaMs} ms, p95 ${c.p95Ms} ms` : ''}`).join('\n') : 'Sin actividad registrada todavia.') +
        (res.erroresRecientes.length ? '\nErrores recientes:\n' + res.erroresRecientes.map((e) => `- ${e}`).join('\n') : '');
    },
    configurar_informe_metricas: (args, opciones) => {
      const quiere = args.activo === true;
      const pideTexto = /(activa(r|s|do)?|enciend(e|er)|pon\s+en\s+marcha|quiero)\s+.{0,40}(informe|metricas)/i.test(opciones.mensajeUsuario || '');
      if (quiere && !pideTexto) {
        return 'No he activado el informe semanal de metricas porque tu mensaje no lo pedia explicitamente. Si lo quieres, dime "activa el informe de metricas".';
      }
      const res = configurarInformeMetricas({ activo: args.activo }, { rutaConfig: opciones.rutaConfigOps });
      return res.activo ? 'Informe semanal de metricas ACTIVADO (te llegara por la cola de avisos).' : 'Informe semanal de metricas desactivado.';
    },
    actividad_repos: async (args, opciones) => {
      const res = await actividadRepos({ repos: args.repos }, { fetchFn: opciones.fetchFnGitHub, rutaConfig: opciones.rutaConfigOps });
      return !res.ok ? res.error
        : 'Actividad de tus repos:\n' + res.repos.map((r) => r.error ? `- ${r.repo}: error (${r.error})` : `- ${r.repo}: ${r.estrellas} estrellas, ${r.forks} forks, ${r.issuesAbiertas} issues abiertas`).join('\n') + `\n${res.nota}`;
    },
    configurar_alertas_repos: (args, opciones) => {
      const quiere = args.activo === true;
      const pideTexto = /(activa(r|s|do)?|enciend(e|er)|pon\s+en\s+marcha|quiero)\s+.{0,40}(alertas?|avisos?)\s+.{0,30}(repos|repositorios|github)/i.test(opciones.mensajeUsuario || '');
      if (quiere && !pideTexto) {
        return 'No he activado las alertas de repos porque tu mensaje no lo pedia explicitamente. Si las quieres, dime "activa las alertas de mis repos".';
      }
      const res = configurarAlertasRepos({ activo: args.activo, repos: args.repos }, { rutaConfig: opciones.rutaConfigOps });
      return res.activo ? `Alertas de repos ACTIVADAS para: ${res.repos.join(', ')} (avisos de cambios en estrellas, forks e issues).` : 'Alertas de repos desactivadas.';
    },
    crear_backup_sesion: async () => {
      const res = await crearBackupSesion({});
      return !res.ok ? res.error : `Backup cifrado creado: ${res.archivo} (${Math.round(res.bytes / 1024)} KB).\n${res.nota}`;
    },
    verificar_backup_sesion: async (args) => {
      const res = await verificarBackupSesion({ archivo: args.archivo }, {});
      return !res.ok ? res.error : `Backup verificado: ${Math.round(res.bytes / 1024)} KB recuperables.\n${res.nota}`;
    },
    explicar_recorrido: (_args, opciones) => explicarUltimoRecorrido(opciones.chatId, opciones)
  };
}

function crearManejadoresVidaPersonal() {
  return {
    crear_recordatorio: (args, opciones) => {
      const res = crearRecordatorio({
        mensaje: args.mensaje,
        minutosEnElFuturo: args.minutosEnElFuturo,
        hora: args.hora
      }, { rutaArchivo: opciones.rutaArchivoRecordatorios });
      return `Recordatorio guardado en el sistema, señor. ID: ${res.recordatorio.id}. Programado para: ${res.recordatorio.fechaHoraLocal}. Tarea: "${res.recordatorio.mensaje}".`;
    },
    listar_recordatorios: (_args, opciones) => {
      const lista = listarRecordatorios(true, { rutaArchivo: opciones.rutaArchivoRecordatorios });
      return lista.length === 0
        ? 'No hay ningún recordatorio pendiente en el sistema, señor.'
        : 'Recordatorios pendientes:\n' + lista.map((r, i) => `${i + 1}. [${r.fechaHoraLocal}] "${r.mensaje}" (ID: ${r.id})`).join('\n');
    },
    cancelar_recordatorio: (args, opciones) => {
      const res = cancelarRecordatorio(args.criterio, { rutaArchivo: opciones.rutaArchivoRecordatorios });
      if (res.ok) return res.mensaje || (res.recordatorio ? `Recordatorio cancelado con éxito: "${res.recordatorio.mensaje}".` : 'Recordatorio cancelado con éxito, señor.');
      return res.mensaje || 'Error al cancelar el recordatorio.';
    },
    programar_mensaje_whatsapp: (args, opciones) => {
      const res = programarMensaje({
        numero: args.numero,
        mensaje: args.mensaje,
        minutosEnElFuturo: args.minutosEnElFuturo,
        hora: args.hora,
        fecha: args.fecha,
        inmediato: args.inmediato,
        tenantId: opciones.tenantId
      }, {
        rutaArchivo: opciones.rutaArchivoProgramados,
        tenantId: opciones.tenantId,
        store: opciones.scheduledMessageStore,
        contactsStore: opciones.contactsStore,
        knowledgeGraphStore: opciones.knowledgeGraphStore,
        memoryStore: opciones.memoryRepository || opciones.memoryStore
      });
      if (!res.ok) return `No ha sido posible programar el mensaje, señor. Detalle: ${res.error}`;
      return res.inmediato
        ? `Mensaje tramitado para entrega inmediata a +${res.programado.numero}, señor. Contenido: "${res.programado.mensaje}". (ID: ${res.programado.id})`
        : `Mensaje programado con éxito, señor. Destinatario: +${res.programado.numero}. Programado para: ${res.programado.fechaHoraLocal}. Mensaje: "${res.programado.mensaje}". (ID: ${res.programado.id})`;
    },
    listar_mensajes_programados: (_args, opciones) => {
      const lista = listarMensajesProgramados(true, { rutaArchivo: opciones.rutaArchivoProgramados, tenantId: opciones.tenantId, store: opciones.scheduledMessageStore });
      return lista.length === 0
        ? 'No hay ningún mensaje de WhatsApp programado pendiente de envío, señor.'
        : 'Mensajes de WhatsApp programados pendientes:\n' + lista.map((m, i) => `${i + 1}. [${m.fechaHoraLocal}] Para +${m.numero}: "${m.mensaje}" (ID: ${m.id})`).join('\n');
    },
    cancelar_mensaje_programado: (args, opciones) => {
      const res = cancelarMensajeProgramado(args.criterio, { rutaArchivo: opciones.rutaArchivoProgramados, tenantId: opciones.tenantId, store: opciones.scheduledMessageStore });
      return res.ok
        ? (res.mensaje || 'Mensaje programado cancelado con éxito, señor.')
        : (res.mensaje || res.error || 'No se encontró ningún mensaje programado que coincida con ese criterio, señor.');
    },
    registrar_fecha_senalada: (args, opciones) => {
      const res = registrarFechaSenalada({ nombre: args.nombre, dia: args.dia, mes: args.mes, anio: args.anio, descripcion: args.descripcion }, { rutaArchivo: opciones.rutaArchivoFechas });
      return res.ok
        ? `Apuntado, David: ${res.fecha.nombre}, ${res.fecha.dia}/${res.fecha.mes}${res.fecha.anio ? '/' + res.fecha.anio : ''}. Si quieres que te avise, dimelo: "activa los avisos de fechas".`
        : `No lo he podido apuntar: ${res.error}`;
    },
    listar_fechas_senaladas: (_args, opciones) => {
      const proximas = proximasFechas({ dias: 366 }, { rutaArchivo: opciones.rutaArchivoFechas });
      return proximas.length === 0
        ? 'No tienes fechas senaladas apuntadas. Dime por ejemplo: "apunta el cumple de Ana, 15 de marzo".'
        : 'Fechas senaladas (por proximidad):\n' + proximas.map((f) => `- ${f.nombre}: ${String(f.dia).padStart(2, '0')}/${String(f.mes).padStart(2, '0')}${f.anio ? '/' + f.anio : ''} (en ${f.diasQueFaltan} dia(s))`).join('\n');
    },
    eliminar_fecha_senalada: (args, opciones) => {
      const res = eliminarFechaSenalada(args.criterio, { rutaArchivo: opciones.rutaArchivoFechas });
      return res.ok ? `Borrada, David: ${res.fecha.nombre} (${res.fecha.dia}/${res.fecha.mes}).` : res.error;
    },
    configurar_avisos_fechas: (args, opciones) => {
      const pideActivarFechas = /(activa(r|s|do)?|enciend(e|er)|pon\s+en\s+marcha)\s+.{0,30}(aviso|fecha|cumplea)/i.test(opciones.mensajeUsuario || '');
      if (args.activo === true && !pideActivarFechas) {
        return 'Para activar los avisos de fechas senaladas necesito que me lo pidas tu directamente (por ejemplo: "activa los avisos de fechas").';
      }
      const res = configurarAvisosFechas({ activo: args.activo === true }, { rutaArchivo: opciones.rutaArchivoFechas });
      return res.ok
        ? (res.activo ? 'Avisos de fechas activados, David: te avisare el dia anterior y el mismo dia.' : 'Avisos de fechas desactivados, David.')
        : `No he podido cambiar los avisos: ${res.error}`;
    },
    programar_snooze: (args, opciones) => {
      const res = programarSnooze({ chatId: opciones.chatId, minutos: args.minutos, hora: args.hora, nota: args.nota }, { rutaArchivo: opciones.rutaArchivoSnoozes });
      return res.ok ? `Anotado, David: te recordare volver a este chat el ${new Date(res.snooze.activarEn).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}.` : res.error;
    },
    listar_snoozes: (_args, opciones) => {
      const pendientes = listarSnoozes({ rutaArchivo: opciones.rutaArchivoSnoozes });
      return pendientes.length === 0
        ? 'No tienes recordatorios de chats pendientes.'
        : 'Recordatorios de chats pendientes:\n' + pendientes.map((s) => `- ${new Date(s.activarEn).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}${s.nota ? ': ' + s.nota : ''}`).join('\n');
    },
    cancelar_snooze: (args, opciones) => {
      const res = cancelarSnooze({ chatId: opciones.chatId, id: args.id }, { rutaArchivo: opciones.rutaArchivoSnoozes });
      return res.ok ? 'Cancelado, David: ya no te recordare ese chat.' : res.error;
    },
    registrar_aviso_llegada: (args, opciones) => {
      const res = registrarAvisoLlegada({ chatId: opciones.chatId, nombre: args.nombre, latitud: args.latitud, longitud: args.longitud, radioMetros: args.radioMetros }, { rutaArchivo: opciones.rutaArchivoLlegada });
      return res.ok ? `Aviso de llegada activo, David: cuando la ubicacion de este chat entre a ${res.aviso.radioMetros} m de ${res.aviso.nombre}, te aviso una vez. Caduca en 12 horas.` : res.error;
    },
    listar_avisos_llegada: (_args, opciones) => {
      const activos = listarAvisosLlegada({ rutaArchivo: opciones.rutaArchivoLlegada });
      return activos.length === 0
        ? 'No hay avisos de llegada activos.'
        : 'Avisos de llegada activos:\n' + activos.map((a) => `- ${a.nombre} (radio ${a.radioMetros} m, caduca ${new Date(a.caducaEn).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })})`).join('\n');
    },
    cancelar_aviso_llegada: (args, opciones) => {
      const res = cancelarAvisoLlegada(args.criterio, { rutaArchivo: opciones.rutaArchivoLlegada });
      return res.ok ? `Cancelado el aviso de llegada a ${res.aviso.nombre}, David.` : res.error;
    },
    registrar_parada_favorita: async (args, opciones) => {
      const res = await registrarParadaFavorita({ nombre: args.nombre, tipo: args.tipo, codigo: args.codigo }, { rutaArchivo: opciones.rutaArchivoTransporte });
      return res.ok ? `Parada guardada, David: "${res.parada.nombre}" (${res.parada.tipo} ${res.parada.codigo}${res.estacion ? `, ${res.estacion}` : ''}). Preguntame cuando quieras: "cuando llega el proximo bus de casa".` : res.error;
    },
    listar_paradas_favoritas: (_args, opciones) => {
      const paradas = listarParadasFavoritas({ rutaArchivo: opciones.rutaArchivoTransporte });
      return paradas.length === 0
        ? 'No tienes paradas favoritas. Dime por ejemplo: "mi parada de casa es la EMT 1234".'
        : 'Tus paradas favoritas:\n' + paradas.map((p) => `- ${p.nombre}: ${p.tipo} ${p.codigo}`).join('\n');
    },
    eliminar_parada_favorita: (args, opciones) => {
      const res = eliminarParadaFavorita(args.criterio, { rutaArchivo: opciones.rutaArchivoTransporte });
      return res.ok ? `Borrada la parada "${res.parada.nombre}", David.` : res.error;
    },
    proximas_llegadas_transporte: async (args, opciones) => {
      const destinoNatural = extraerDestinoHacia(opciones.mensajeUsuario);
      const origenNatural = extraerOrigenDesde(opciones.mensajeUsuario);
      const res = await proximasLlegadas({
        parada: origenNatural || args.parada,
        tipo: args.tipo,
        codigo: args.codigo,
        destino: destinoNatural || args.destino
      }, depsTransporteDe(opciones));
      return textoResultadoTransporte(res);
    },
    escribir_diario: (args, opciones) => {
      const res = escribirDiario({ texto: args.texto, fecha: args.fecha }, { carpetaDiario: opciones.carpetaDiario });
      return res.ok ? `Apuntado en el diario del ${res.fecha}, David.` : res.error;
    },
    leer_diario: (args, opciones) => {
      const res = leerDiario({ fecha: args.fecha }, { carpetaDiario: opciones.carpetaDiario });
      return res.ok ? res.contenido : res.error;
    },
    registrar_habito: (args, opciones) => {
      const res = registrarHabito({ nombre: args.nombre }, depsHabitosDe(opciones));
      return res.ok ? `Habito registrado, David: "${res.habito.nombre}". Me lo marcas cuando lo hagas ("hecho ${res.habito.nombre}") y te llevo la racha.` : res.error;
    },
    marcar_habito: (args, opciones) => {
      const res = marcarHabito({ criterio: args.criterio, fecha: args.fecha }, depsHabitosDe(opciones));
      return res.ok ? `Marcado, David: "${res.habito.nombre}". Racha actual: ${res.racha} dia${res.racha === 1 ? '' : 's'}.` : res.error;
    },
    listar_habitos: (_args, opciones) => {
      const lista = listarHabitos(depsHabitosDe(opciones));
      return lista.length === 0
        ? 'No sigues ningun habito todavia. Dime por ejemplo: "quiero seguir el habito de leer 20 minutos".'
        : 'Tus habitos:\n' + lista.map((h) => `- ${h.nombre}: ${h.hechoHoy ? 'hecho hoy' : 'pendiente hoy'}, racha de ${h.racha} dia${h.racha === 1 ? '' : 's'} (${h.totalDias} en total)`).join('\n');
    },
    poner_menu: (args, opciones) => {
      const res = ponerMenu({ dia: args.dia, comida: args.comida, cena: args.cena }, { rutaArchivo: opciones.rutaArchivoMenus });
      return res.ok ? `Menu apuntado, David: ${res.dia} de la semana del ${res.semana}.` : res.error;
    },
    ver_menu: (_args, opciones) => {
      const res = verMenu({}, { rutaArchivo: opciones.rutaArchivoMenus });
      return !res.ok ? res.error
        : res.vacio ? `No tienes menu apuntado para la semana del ${res.semana}. Puedo proponerte uno si quieres.`
        : `Menu de la semana del ${res.semana} (comida / cena):\n` + res.lineas.join('\n');
    },
    sugerir_menu: async (args, opciones) => {
      const res = await sugerirMenu({ preferencias: args.preferencias }, { rutaArchivo: opciones.rutaArchivoMenus, chatCompletion: opciones.chatCompletion });
      return res.ok ? `Propuesta de menu (no la he guardado; dime que dias confirmas y los apunto):\n${res.propuesta}` : res.error;
    },
    anadir_compra: (args, opciones) => {
      const res = anadirCompra({ items: args.items }, depsCompraDe(opciones));
      return !res.ok ? res.error
        : res.anadidos.length === 0 ? 'Ya estaba todo en la lista, David.'
        : `Anadido a la compra: ${res.anadidos.join(', ')}. Llevas ${res.total} articulo${res.total === 1 ? '' : 's'}.`;
    },
    listar_compra: (_args, opciones) => {
      const items = listarCompra(depsCompraDe(opciones));
      return items.length === 0
        ? 'La lista de la compra esta vacia, David.'
        : `Lista de la compra (${items.length}):\n` + items.map((i) => '- ' + i).join('\n');
    },
    tachar_compra: (args, opciones) => {
      const res = tacharCompra(args.criterio, depsCompraDe(opciones));
      return res.ok ? `Tachado de la compra: ${res.tachado}. Quedan ${res.total} articulo${res.total === 1 ? '' : 's'}.` : res.error;
    },
    vaciar_compra: (_args, opciones) => {
      const pideVaciar = /(vaci[ao]|borra|limpia|elimina).{0,20}(lista\s+de\s+la\s+)?compra/i.test(opciones.mensajeUsuario || '');
      if (!pideVaciar) {
        return 'Para vaciar la lista de la compra necesito que me lo pidas tu directamente (por ejemplo: "vacia la lista de la compra").';
      }
      vaciarCompra(depsCompraDe(opciones));
      return 'Lista de la compra vaciada, David.';
    },
    recomendar_serie_pelicula: async (args, opciones) => {
      const res = await recomendarSeriePelicula({ genero: args.genero, tipo: args.tipo }, { rutaArchivo: opciones.rutaArchivoRecomendador, chatCompletion: opciones.chatCompletion, obtenerMemorias: opciones.obtenerMemorias });
      return res.ok ? res.recomendacion : res.error;
    },
    crear_quedada: (args, opciones) => {
      const res = crearQuedada({ titulo: args.titulo, fecha: args.fecha, hora: args.hora, lugar: args.lugar, participantes: args.participantes }, {
        rutaArchivo: opciones.rutaArchivoQuedadas,
        tenantId: opciones.tenantId,
        store: opciones.quedadasStore
      });
      return res.ok
        ? `Quedada registrada, David: "${res.quedada.titulo}"${res.quedada.fecha ? ` el ${res.quedada.fecha}` : ''}${res.quedada.hora ? ` a las ${res.quedada.hora}` : ''}${res.quedada.lugar ? ` en ${res.quedada.lugar}` : ''}. Si quieres, te redacto la invitacion para que la revises y la mandes tu.`
        : res.error;
    },
    listar_quedadas: (_args, opciones) => {
      const lista = listarQuedadas({
        rutaArchivo: opciones.rutaArchivoQuedadas,
        tenantId: opciones.tenantId,
        store: opciones.quedadasStore
      });
      return lista.length === 0
        ? 'No tienes quedadas registradas. Dime por ejemplo: "apunta una quedada: cena con la uni el viernes a las 21:00".'
        : 'Tus quedadas:\n' + lista.map((q) => `- ${q.titulo}${q.fecha ? `, ${q.fecha}` : ''}${q.hora ? ` ${q.hora}` : ''}${q.lugar ? `, en ${q.lugar}` : ''}${q.participantes.length ? ` (con ${q.participantes.join(', ')})` : ''}`).join('\n');
    },
    redactar_invitacion: async (args, opciones) => {
      const res = await redactarInvitacion({ criterio: args.criterio }, { rutaArchivo: opciones.rutaArchivoQuedadas, chatCompletion: opciones.chatCompletion });
      return res.ok ? `BORRADOR de invitacion (${res.nota}):\n\n${res.borrador}` : res.error;
    },
    resumen_deportivo: async (args, opciones) => {
      const res = await resumenDeportivo({ limite: args.limite }, { obtenerNoticias: opciones.obtenerNoticiasDeportes, chatCompletion: opciones.chatCompletion });
      return res.ok ? res.resumen : res.error;
    },
    configurar_modo_nocturno: (args, opciones) => {
      const res = configurarModoNocturno({ activo: args.activo === true, desde: args.desde, hasta: args.hasta }, { rutaArchivo: opciones.rutaArchivoNocturno });
      return res.ok
        ? (res.config.activo
          ? `Modo desconexion nocturno activado, David: de ${res.config.desde} a ${res.config.hasta} silencio los avisos proactivos no urgentes (esperan a que acabe la franja). Tus recordatorios puntuales suenan igual.`
          : 'Modo desconexion nocturno desactivado, David.')
        : res.error;
    },
    encender_pc: async () => {
      const res = await encenderPc({});
      return !res.ok ? res.error : res.nota;
    },
    listar_dispositivos_red: async (_args, opciones) => {
      const res = await listarDispositivosRed({ rutaConfig: opciones.rutaConfigHogar });
      return !res.ok ? res.error
        : res.dispositivos.length === 0
          ? `No veo dispositivos vecinos ahora mismo.\n${res.alcance}`
          : `Dispositivos vecinos (${res.dispositivos.length}):\n` + res.dispositivos.map((d) => `- ${d.ip} (${d.mac}) ${d.estado}${res.desconocidos.some((x) => x.mac === d.mac) ? ' - DESCONOCIDO' : ''}`).join('\n') + `\n${res.alcance}`;
    },
    configurar_vigilancia_red: (args, opciones) => {
      const quiere = args.activo === true;
      const pideTexto = /(activa(r|s|do)?|enciend(e|er)|pon\s+en\s+marcha|quiero|vigila(r)?)\s+.{0,40}(red|dispositivos)/i.test(opciones.mensajeUsuario || '');
      if (quiere && !pideTexto) {
        return 'No he activado la vigilancia de red porque tu mensaje no lo pedia explicitamente. Si la quieres, dime "activa la vigilancia de mi red".';
      }
      const res = configurarVigilanciaRed({ activo: args.activo, conocidos: args.conocidos }, { rutaConfig: opciones.rutaConfigHogar });
      return res.activo ? `Vigilancia de red ACTIVADA (${res.conocidos} MACs conocidas; aviso si aparece un desconocido).` : 'Vigilancia de red desactivada.';
    },
    controlar_domotica: async (args) => {
      const mapaAccion = { encender: 'on', apagar: 'off', conmutar: 'toggle' };
      const res = await controlarDomotica({ entidad: args.entidad, accion: mapaAccion[args.accion] || args.accion }, {});
      return !res.ok ? res.error : res.nota;
    },
    estado_descargas: async () => {
      const res = await estadoDescargas({});
      if (!res.ok) return res.error;
      const partes = [res.disco ? `Disco: ${res.disco.usado} de ${res.disco.total} usados (${res.disco.porcentaje}); libres ${res.disco.libre}.` : 'No he podido leer el disco.'];
      if (res.qbit) {
        partes.push(res.qbit.length === 0 ? 'qBittorrent: sin torrents activos.' : 'qBittorrent:\n' + res.qbit.map((t) => `- ${t.nombre}: ${t.progreso}% (${t.estado})`).join('\n'));
      }
      partes.push(res.nota);
      return partes.join('\n');
    },
    configurar_aviso_descargas: (args, opciones) => {
      const quiere = args.activo === true;
      const pideTexto = /(activa(r|s|do)?|enciend(e|er)|quiero|avisa(me)?)\s+.{0,40}(descarga|torrent)/i.test(opciones.mensajeUsuario || '');
      if (quiere && !pideTexto) {
        return 'No he activado el aviso de descargas porque tu mensaje no lo pedia explicitamente. Si lo quieres, dime "avisame cuando termine la descarga".';
      }
      const res = configurarAvisoDescargas({ activo: args.activo }, { rutaConfig: opciones.rutaConfigHogar });
      return res.activo ? 'Aviso de descargas ACTIVADO: te escribo cuando termine alguna.' : 'Aviso de descargas desactivado.';
    },
    estimar_factura_oracle: async () => {
      const res = await estimarFacturaOracle({});
      return !res.ok ? res.error : res.nota;
    },
    vigilar_ruta: (args, opciones) => {
      const res = vigilarRuta({ tipo: args.tipo, origen: args.origen, destino: args.destino, fecha: args.fecha, precioObjetivo: args.precioObjetivo }, { rutaArchivo: opciones.rutaArchivoViajes });
      return !res.ok ? res.error
        : `Vigilando tu ${res.ruta.tipo} ${res.ruta.origen} -> ${res.ruta.destino} del ${res.ruta.fecha}${res.ruta.precioObjetivo ? ` (objetivo: ${res.ruta.precioObjetivo} EUR)` : ''}.\n${res.nota}`;
    },
    listar_rutas_vigiladas: (_args, opciones) => {
      const rutas = listarRutasVigiladas({ rutaArchivo: opciones.rutaArchivoViajes });
      return rutas.length === 0
        ? 'No vigilo ninguna ruta. Dime por ejemplo "vigila el vuelo Madrid-Lisboa del 2026-12-12".'
        : 'Rutas vigiladas:\n' + rutas.map((r) => {
            const ultimo = r.historial.length ? r.historial[r.historial.length - 1].precio.toFixed(2) + ' EUR' : 'sin precios aun';
            return `- ${r.tipo} ${r.origen} -> ${r.destino} (${r.fecha}): objetivo ${r.precioObjetivo != null ? r.precioObjetivo + ' EUR' : 'sin objetivo'}, ultimo ${ultimo}`;
          }).join('\n');
    },
    cancelar_vigilancia_ruta: (args, opciones) => {
      const res = cancelarVigilanciaRuta({ criterio: args.criterio }, { rutaArchivo: opciones.rutaArchivoViajes });
      return !res.ok ? res.error : `Vigilancia cancelada (${res.canceladas} ruta(s)).`;
    },
    registrar_precio_ruta: (args, opciones) => {
      const res = registrarPrecioRuta({ criterio: args.criterio, precio: args.precio }, { rutaArchivo: opciones.rutaArchivoViajes });
      return !res.ok ? res.error
        : `Anotado: ${res.precio.toFixed(2)} EUR para tu ${res.ruta.tipo} ${res.ruta.origen} -> ${res.ruta.destino}.${res.baja ? ' Es el minimo hasta ahora.' : ''}${res.bajoObjetivo ? ' POR DEBAJO de tu objetivo: buen momento para mirarlo.' : ''}`;
    },
    vigilar_producto: async (args, opciones) => {
      const res = await vigilarProducto({ url: args.url, nombre: args.nombre, precioObjetivo: args.precioObjetivo }, { tenantId: opciones.tenantId });
      return res.ok
        ? (res.mensaje || `Producto añadido al Sniper con éxito. Nombre: "${res.item.nombre}". Precio actual: ${res.item.precioActual}€. Alerta si baja a: ${res.item.precioObjetivo}€.`)
        : `Error al añadir al Sniper: ${res.error}`;
    },
    listar_productos_vigilados: (_args, opciones) => {
      const items = listarProductosVigilados({ tenantId: opciones.tenantId });
      return items.length === 0
        ? 'No hay ningún producto bajo vigilancia en este momento, señor.'
        : 'Productos vigilados en el Sniper:\n' + items.map((item, i) => `${i + 1}. [${item.id}] ${item.nombre}: ${item.precioActual}€ -> Meta: ${item.precioObjetivo}€\n   ${item.url}`).join('\n');
    },
    cancelar_vigilancia: (args, opciones) => {
      const res = cancelarVigilancia(args.criterio, { tenantId: opciones.tenantId });
      return res.ok
        ? (res.mensaje || (res.item ? `Vigilancia cancelada para: "${res.item.nombre}".` : 'Vigilancia cancelada con éxito, señor.'))
        : (res.error || 'Error al cancelar la vigilancia.');
    },
    buscar_producto: async (args, opciones) => {
      const res = await buscarProducto({ consulta: args.consulta }, { buscarEnFuente: opciones.buscarEnFuenteCompras, fetchFn: opciones.fetchFnCompras });
      if (!res.ok) return res.error;
      if (res.candidatos.length === 0) {
        return `No he encontrado ofertas de "${args.consulta}" (${res.fuente === 'priceradars' ? 'comparador PriceRadars' : res.fuente}). Prueba con el modelo exacto o pasame el enlace de la ficha y lo verifico al momento.`;
      }
      const lineas = res.candidatos.slice(0, 8).map((c) => {
        const precioTxt = Number.isFinite(c.precio) ? `${c.precio} ${c.moneda || 'EUR'}` : 'precio no publicado';
        const stockTxt = c.enStock === true ? 'en stock (segun comparador, sin reconfirmar)' : c.enStock === false ? 'AGOTADO segun comparador' : 'stock sin publicar';
        const extras = [c.comercio, c.ofertas > 1 ? `${c.ofertas} ofertas` : null, c.variante === 'distinta' ? 'OJO: otra variante del modelo' : null].filter(Boolean).join(' - ');
        return `- ${c.nombre}: ${precioTxt}, ${stockTxt}${extras ? ` (${extras})` : ''}${c.enlace ? `\n  ${c.enlace}` : ''}`;
      });
      const filtrados = [res.accesoriosOmitidos ? `${res.accesoriosOmitidos} accesorio(s) apartado(s) (funda/soporte/cable... para el producto, no el producto)` : null, res.descartadosSinVinculo ? `${res.descartadosSinVinculo} resultado(s) descartado(s) por no coincidir con lo buscado` : null].filter(Boolean).join('; ');
      return `Ofertas de "${args.consulta}" (${res.fuente === 'priceradars' ? 'comparador PriceRadars' : res.fuente}, ${res.totalResultados} resultados${filtrados ? `; ${filtrados}` : ''}):\n` + lineas.join('\n') + (res.aviso ? `\nAviso: ${res.aviso}` : '');
    },
    verificar_oferta: async (args, opciones) => {
      const res = await verificarOferta({ url: args.url, producto: args.producto }, { fetchFn: opciones.fetchFnCompras });
      if (!res.ok) return res.error;
      const lineas = [`Verificado AHORA (${res.comprobadoEn}):`, `- Producto en la ficha: ${res.nombre || 'sin nombre en la ficha'}`];
      if (res.precioConfirmado) {
        lineas.push(`- Precio: ${res.precio} ${res.moneda || '(moneda no declarada)'}`);
        lineas.push(`- Disponibilidad: ${res.disponibilidad || 'no publicada'}`);
      } else {
        lineas.push('- Precio: NO confirmado para el producto pedido (la pagina parece de otra cosa).');
      }
      if (res.vinculacion && res.vinculacion.estado && res.vinculacion.estado !== 'sin-referencia') {
        lineas.push(`- Vinculacion con lo pedido: ${res.vinculacion.estado}`);
      }
      for (const a of res.advertencias || []) lineas.push(`- OJO: ${a}`);
      lineas.push(res.nota);
      return lineas.join('\n');
    }
  };
}

function crearManejadoresComunicacionYDev() {
  return {
    consultar_clima: async (args) => {
      const res = await consultarClima({
        ubicacion: args.ubicacion || config.weather?.defaultCity || 'Madrid',
        momento: args.momento || 'hoy',
        hora: args.hora || null
      });
      return res.ok ? res.resumen : `Error al consultar el clima: ${res.error}`;
    },
    navegar_y_leer_noticia: async (args) => {
      const resNav = await navegarYExtraerArticulo(args.url);
      return resNav.ok
        ? `Artículo web verificado en vivo con Chromium:\nTítulo: ${resNav.titulo}\nURL: ${resNav.url}\nAutor: ${resNav.autor || 'Redacción'}\nFecha: ${resNav.fecha || 'Reciente'}\nTexto íntegro:\n${resNav.contenido}`
        : `No se pudo leer la página con el navegador: ${resNav.error}`;
    },
    resumir_enlace: async (args, _opciones, deps) => {
      const resResumen = await generarResumenInteligente(args.url);
      return { texto: deps.limpiarRespuestaJarvis ? deps.limpiarRespuestaJarvis(resResumen) : resResumen, enlaces: null };
    },
    obtener_noticias_actuales: async (args) => {
      const cat = args.categoria || 'general';
      const data = await obtenerNoticiasEstructuradas(cat, 5);
      if (data.ok && data.articulos.length > 0) {
        const textoParaJarvis = data.articulos.map((a) => `${a.id}. Titular: ${a.titulo}\nDetalle: ${a.resumen}`).join('\n\n');
        return { texto: `Noticias reales recuperadas (${data.ramaNombre}):\n${textoParaJarvis}`, enlaces: data.articulos };
      }
      return { texto: 'No se pudieron recuperar noticias en este momento, señor.', enlaces: null };
    },
    activar_modo_vip: (args) => {
      const activo = setVipMode(args.activar !== false);
      if (args.contacto_vip) addVipContact(args.contacto_vip);
      return `Modo Filtro VIP ${activo ? 'activado' : 'desactivado'}, señor. ${args.contacto_vip ? `Contacto ${args.contacto_vip} añadido a la lista blanca autorizada.` : ''}`;
    },
    estado_modo_vip: () => {
      const activo = isVipModeActive();
      const vips = getVipContacts();
      return `Modo Filtro VIP: ${activo ? 'ACTIVO' : 'DESACTIVADO'}, señor. Contactos autorizados en lista blanca (${vips.length}): ${vips.join(', ') || 'ninguno'}.`;
    },
    agregar_contacto_vip: (args) => {
      addVipContact(args.contacto);
      return `Contacto ${args.contacto} registrado en la lista blanca del Filtro VIP con éxito, señor.`;
    },
    resumir_grupo: async (args) => {
      const res = await generateGroupSummary(args.id_grupo, args.horas_atras || 24, args.max_mensajes || 50);
      return res.ok ? res.summaryText : `No ha sido posible generar el resumen del grupo: ${res.error}`;
    },
    descargar_multimedia: async (args) => {
      const res = await downloadMedia(args.url, { format: args.formato || 'video', audioOnly: args.formato === 'audio' });
      return res.ok ? `Descarga completada con éxito: ${res.fileName} (${(res.fileSize / 1024 / 1024).toFixed(2)} MB). Tramitado para entrega directa al chat.` : `Error en la descarga multimedia: ${res.error}`;
    },
    enviar_contacto_vcard: (args) => `Tarjeta vCard digital generada para ${args.nombre} (${args.telefono}${args.organizacion ? ' - ' + args.organizacion : ''}). Tramitado para envío al chat de WhatsApp.`,
    crear_encuesta_whatsapp: (args) => `Encuesta configurada con éxito: "${args.pregunta}" (${args.opciones?.length || 0} opciones). Publicada en el chat.`,
    activar_traductor: (args, opciones) => {
      const res = activarTraductor({ idioma: args.idioma }, { rutaArchivo: opciones.rutaArchivoTraductor, chatId: opciones.chatId });
      return res.ok
        ? `Modo traductor activado, David: traducire tus mensajes al ${res.idioma} en este chat. Dime "desactiva el traductor" cuando quieras apagarlo.`
        : res.error;
    },
    desactivar_traductor: (_args, opciones) => {
      const res = desactivarTraductor({ rutaArchivo: opciones.rutaArchivoTraductor, chatId: opciones.chatId });
      return res.ok ? 'Traductor desactivado, David.' : res.error;
    },
    sugerir_respuestas: async (args, opciones) => {
      if (typeof opciones.chatCompletion !== 'function') {
        return 'Necesito el modelo de lenguaje para redactar sugerencias.';
      }
      const resp = await opciones.chatCompletion({
        messages: [
          { role: 'system', content: `Redacta 3 posibles respuestas${args.tono ? ` en tono ${String(args.tono).slice(0, 40)}` : ''} al mensaje que te pasa David. Numeralas (1, 2, 3), una por linea, sin explicaciones. Son propuestas para que el elija: no las envies a nadie.` },
          { role: 'user', content: String(args.mensaje || '').slice(0, 2000) }
        ]
      });
      return (resp?.message?.content || resp?.content || 'No se me ocurren sugerencias ahora mismo.').trim();
    },
    buscar_en_historial: (args, opciones) => {
      const res = buscarEnHistorial({ chatId: opciones.chatId, termino: args.termino, limite: args.limite });
      return !res.ok
        ? res.error
        : res.total === 0
          ? `No encuentro "${args.termino}" en el historial de este chat.`
          : `Coincidencias con "${args.termino}" (mas recientes primero):\n` + res.coincidencias.map((c, i) => `${i + 1}. [${c.role}] ${c.content}`).join('\n');
    },
    estadisticas_grupo: (_args, opciones) => {
      const res = estadisticasChat({ chatId: opciones.chatId });
      return !res.ok
        ? res.error
        : `Estadisticas de este chat, David (ojo: solo cuento lo que he visto desde que estoy conectado, ${res.cobertura}):\n- Total de mensajes: ${res.total} (tuyos: ${res.tuyos}, mios: ${res.mios})${res.horaMasActiva ? `\n- Hora mas activa: sobre las ${res.horaMasActiva.hora}:00 (${res.horaMasActiva.mensajes} mensajes)` : ''}\n- Por dia: ${Object.entries(res.porDia).map(([d, n]) => `${d}: ${n}`).join(', ') || 'sin fechas registradas'}`;
    },
    anotar_idea: (args, opciones) => {
      const res = anotarIdea({ titulo: args.titulo, detalle: args.detalle }, { rutaArchivo: opciones.rutaArchivoIdeas });
      return res.ok ? `Anotada, David: "${res.idea.titulo}" (${res.total} idea(s) en total). Cuando quieras las revisamos: "prioriza mis ideas".` : res.error;
    },
    listar_ideas: (_args, opciones) => {
      const lista = listarIdeas({ rutaArchivo: opciones.rutaArchivoIdeas });
      return lista.length === 0
        ? 'No tienes ideas anotadas. Dime "anota esta idea: ..." y la guardo.'
        : 'Tus ideas anotadas:\n' + lista.map((i) => `- [${i.prioridad}] ${i.titulo}${i.detalle ? ` - ${i.detalle}` : ''} (${i.fecha.slice(0, 10)})`).join('\n');
    },
    priorizar_ideas: async (_args, opciones) => {
      const res = await priorizarIdeas({ rutaArchivo: opciones.rutaArchivoIdeas, chatCompletion: opciones.chatCompletion });
      return res.ok ? `${res.propuesta}\n(${res.nota})` : res.error;
    },
    generar_changelog: async (args, opciones) => {
      const res = await generarEntradaChangelog({ desde: args.desde, limite: args.limite }, { chatCompletion: opciones.chatCompletion });
      return res.ok ? `Propuesta de entrada (${res.commits} commits):\n${res.entrada}\n(${res.nota})` : res.error;
    },
    guiar_depuracion: async (args, opciones) => {
      const res = await guiarDepuracion({ fallo: args.fallo, contexto: args.contexto }, { chatCompletion: opciones.chatCompletion });
      return res.ok ? `${res.guia}\n(${res.nota})` : res.error;
    },
    revisar_pr: async (args, opciones) => {
      const res = await revisarPullRequest({ numero: args.numero, repo: args.repo }, { fetchFn: opciones.fetchFnGitHub, chatCompletion: opciones.chatCompletion });
      return res.ok
        ? `Resena de PR #${res.numero} (${res.repo}): ${res.titulo}\n${res.url}\n\n${res.resena}\n\n(${res.nota}${res.conToken ? ' Con DAVIS_GITHUB_TOKEN.' : ' API publica sin clave: 60 peticiones/hora; para repos privados, DAVIS_GITHUB_TOKEN por entorno, nunca por chat.'})`
        : res.error;
    },
    crear_rama_trabajo: async (args, opciones) => {
      const res = await crearRamaTrabajo({ nombreRama: args.nombreRama, base: args.base }, { repoPath: opciones.repoPathGit, execGit: opciones.execGit });
      return !res.ok ? res.error : res.nota;
    },
    crear_commit: async (args, opciones) => {
      const res = await crearCommit({ mensaje: args.mensaje, archivos: args.archivos }, { repoPath: opciones.repoPathGit, execGit: opciones.execGit });
      return !res.ok ? res.error : `Commit ${res.hash} creado: "${res.mensaje}".`;
    },
    empujar_rama: async (args, opciones) => {
      const res = await empujarRama({ rama: args.rama, forzar: args.forzar }, { repoPath: opciones.repoPathGit, execGit: opciones.execGit, token: opciones.githubToken || opciones.tokenGitHub });
      return !res.ok ? res.error : res.nota;
    },
    abrir_pull_request: async (args, opciones) => {
      const res = await abrirPullRequest({ titulo: args.titulo, cuerpo: args.cuerpo, rama: args.rama, base: args.base, repo: args.repo }, { token: opciones.githubToken || opciones.tokenGitHub, fetchFn: opciones.fetchFnGitHub });
      return !res.ok ? res.error : `Pull Request #${res.numero} abierta exitosamente: ${res.url}`;
    },
    ejecutar_tarea_programacion: async (args, opciones) => {
      const res = await ejecutarTareaProgramacion({ tarea: args.tarea, rama: args.rama, archivos: args.archivos, base: args.base }, { repoPath: opciones.repoPathGit, execGit: opciones.execGit, token: opciones.githubToken || opciones.tokenGitHub, fetchFn: opciones.fetchFnGitHub });
      return !res.ok ? res.error : `Tarea completada en rama ${res.rama}. PR: ${res.pr || 'sin PR'}`;
    },
    consultar_cuota_tenant: (_args, opciones) => consultarCuotaTexto(opciones.tenantId || 'propietario', opciones),
    solicitar_upgrade_tenant: (args, opciones) => procesarUpgradePlan(opciones.tenantId || 'propietario', args.plan, opciones),
    proponer_skill: (args, opciones, deps) => {
      const res = proponerSkill({
        nombre: args.nombre,
        descripcion: args.descripcion,
        parametros: args.parametros || [],
        pasos: args.pasos || []
      }, { chatId: opciones.chatId }, { herramientasConocidas: deps.herramientasConocidas || [] });
      if (!res.ok) return `No se pudo registrar la propuesta: ${res.error}`;
      const params = res.skill.parametros.map((p) => p.nombre);
      return `Propuesta registrada, señor. Skill "${res.skill.nombre}": ${res.skill.descripcion} Pasos: ${res.skill.pasos.map((p) => p.herramienta).join(' -> ')}${params.length ? `. Parametros: ${params.join(', ')}` : ''}. Para activarla escriba "aprobar skill ${res.skill.nombre}"; para descartarla, "rechazar skill ${res.skill.nombre}".`;
    },
    listar_skills: () => {
      const lista = listarSkills();
      return lista.length === 0
        ? 'No hay ninguna skill registrada.'
        : 'Skills registradas:\n' + lista.map((s, i) => `${i + 1}. ${s.nombre} [${s.estado}] - ${s.descripcion}${s.parametros.length ? ` (parametros: ${s.parametros.join(', ')})` : ''}`).join('\n');
    },
    ejecutar_skill: async (args, opciones, deps) => {
      const res = await ejecutarSkill(args.nombre, args.argumentos || {}, {
        ejecutor: (herramienta, argumentosPaso) => deps.ejecutarHerramientaJarvis(herramienta, argumentosPaso, opciones),
        verificarPaso: (herramienta, argumentosPaso) => {
          if (deps.HERRAMIENTAS_ENVIO_TERCEROS?.has(herramienta) && deps.destinatarioVerificado && !deps.destinatarioVerificado(argumentosPaso.numero, opciones.mensajeUsuario, opciones.historial, opciones)) {
            return 'el numero de destino no consta en este chat ni en los contactos verificados';
          }
          return null;
        }
      });
      return res.ok ? res.texto : `No se pudo ejecutar la skill: ${res.error}`;
    }
  };
}

const REGISTRO_MANEJADORES = new Map([
  ...Object.entries(crearManejadoresCalendario()),
  ...Object.entries(crearManejadoresFinanzas()),
  ...Object.entries(crearManejadoresMemoriaYCerebro()),
  ...Object.entries(crearManejadoresEstudioYCarrera()),
  ...Object.entries(crearManejadoresOpsYSeguridad()),
  ...Object.entries(crearManejadoresVidaPersonal()),
  ...Object.entries(crearManejadoresComunicacionYDev())
]);

export function tieneManejadorHerramienta(nombreFuncion) {
  return REGISTRO_MANEJADORES.has(nombreFuncion);
}

/**
 * Despacha una herramienta nativa registrada por dominio.
 * Devuelve { texto, enlaces } manteniendo el contrato historico de jarvisAgent.
 */
export async function despacharHerramienta(nombreFuncion, args = {}, opciones = {}, deps = {}) {
  const manejador = REGISTRO_MANEJADORES.get(nombreFuncion);
  if (!manejador) {
    return { texto: 'Función no reconocida.', enlaces: null };
  }
  const resultado = await manejador(args, opciones, deps);
  if (resultado && typeof resultado === 'object' && 'texto' in resultado) {
    return { texto: resultado.texto, enlaces: resultado.enlaces || null };
  }
  return { texto: resultado, enlaces: null };
}
