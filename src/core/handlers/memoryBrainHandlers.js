/**
 * memoryBrainHandlers.js - Manejadores de herramientas de Memoria, Second Brain y Contactos.
 *
 * Politica estricta: cero emojis en codigo, comentarios y respuestas.
 */

import { guardarMemoria, buscarMemorias, listarMemorias, olvidarMemoria } from '../../services/memoryService.js';
import { registrarBorradoMasivoPendiente } from '../../services/destructiveActionService.js';
import { guardarReglaProcedural, listarReglasProcedurales, eliminarReglaProcedural } from '../../services/proceduralMemoryService.js';
import { formatearRutinasAprendidas } from '../../services/habitPatternPredictorService.js';
import { buscarSemantico } from '../../services/brainSearchService.js';
import { generarDigest, configurarDigestSemanal } from '../../services/brainDigestService.js';
import { generarWiki } from '../../services/wikiService.js';
import { capturarPagina } from '../../services/capturaService.js';
import { preguntarDocumentos } from '../../services/preguntasDocumentosService.js';
import { savePersonalNote, listRecentNotes } from '../../services/notesService.js';
import { registrarContacto, buscarContacto, listarContactos } from '../../services/contactsService.js';

export function repoMemoriaDe(opciones = {}) {
  const repo = opciones && opciones.memoryRepository;
  return {
    guardar: repo && typeof repo.guardar === 'function' ? repo.guardar : guardarMemoria,
    buscar: repo && typeof repo.buscar === 'function' ? repo.buscar : buscarMemorias,
    listar: repo && typeof repo.listar === 'function' ? repo.listar : listarMemorias,
    olvidar: repo && typeof repo.olvidar === 'function' ? repo.olvidar : olvidarMemoria
  };
}

export function crearManejadoresMemoriaYCerebro() {
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
