/**
 * Procesador de medios entrantes de WhatsApp: audio (Whisper + urgencia),
 * imagenes (tickets + visionService), documentos (PDF/DOCX/XLSX/TXT) y ubicacion.
 *
 * Strict Policy: Zero Emojis.
 */

import { downloadMediaMessage } from '@whiskeysockets/baileys';
import pino from 'pino';

import { registrarIntercambio } from '../../../services/conversationHistoryService.js';
import { enviarConfirmacionInteractiva } from '../../../services/interactiveActionHandler.js';
import { crearBorradorDesdeTicket } from '../../../services/financeService.js';
import { crearAnalizadorTicket } from '../../../services/ticketVisionAdapter.js';
import { procesarUbicacionEntrante } from '../../../services/arrivalWatchService.js';
import { mensajeErrorParaUsuario } from '../../../services/errorSanitizerService.js';
import { transcribirAudioBuffer } from '../../../services/audioTranscriberService.js';
import { analizarImagen, procesarDocumentoPDF } from '../../../services/visionService.js';
import { extraerTextoDocumento, resumirDocumento, consultarSeccionPDF } from '../../../services/pdfReaderService.js';
import { classifyUrgency, getUrgencyPromptDirective } from '../../../services/urgencyService.js';

/**
 * Devuelve la funcion de descarga de medios, usando deps.descargarMedia si se inyecta en tests.
 */
export function crearDescargadorMedia(sock, deps = {}) {
  if (typeof deps.descargarMedia === 'function') {
    return deps.descargarMedia;
  }
  return (m) => downloadMediaMessage(
    m,
    'buffer',
    {},
    { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
  );
}

/**
 * Procesa audioMessage con Whisper, clasificacion de urgencia y directivas para audios largos o reenviados.
 */
export async function procesarAudioEntrante({ sock, msg, remoteJid, deps = {}, urgencyDirective = '' }) {
  console.log('[WhatsApp] Nota de voz recibida de David. Procesando audio con Whisper...');
  try {
    await sock.sendPresenceUpdate('recording', remoteJid);

    const descargarMedia = crearDescargadorMedia(sock, deps);
    const transcribirAudio = deps.transcribirAudio || transcribirAudioBuffer;

    const audioBuffer = await descargarMedia(msg);
    const resVoz = await transcribirAudio(audioBuffer, deps);

    if (resVoz.ok && resVoz.texto && resVoz.texto.length > 1) {
      const texto = resVoz.texto;
      console.log(`[Audio Transcrito]: "${texto}"`);

      const duracionSeg = msg.message.audioMessage?.seconds || 0;
      const urg = classifyUrgency(texto, duracionSeg);
      if (urg.isUrgent) {
        console.log(`[WhatsApp Urgencia Audio] Nivel: ${urg.level} (${urg.reason})`);
      }
      let directiva = getUrgencyPromptDirective(urg);
      const directivaVozDuplex = '[DIRECTIVA DE VOZ DUPLEX]: El usuario se esta comunicando mediante nota de voz. Responde de forma concisa, fluida y directa en espanol conversacional, disenada para ser sintetizada por voz TTS. No uses tablas markdown, listas con vinetas complejas, asteriscos dobles ni bloques de codigo a menos que se pidan explicitamente.';
      directiva = directiva ? `${directiva}\n${directivaVozDuplex}` : directivaVozDuplex;

      const esAudioLargo = duracionSeg > 60 || texto.length > 600;
      const esAudioReenviado = Boolean(msg.message.audioMessage?.contextInfo?.isForwarded);
      if (esAudioLargo || esAudioReenviado) {
        const partesDirectiva = [
          '[DIRECTIVA AUDIO LARGO/REENVIADO]: Devuelve un resumen estructurado en puntos clave y propuestas concretas de recordatorios, eventos o notas a guardar.'
        ];
        if (esAudioReenviado) {
          partesDirectiva.push('Este mensaje es reenviado: NO ejecutes mutaciones (crear recordatorios, eventos, notas ni envios) sin confirmacion explicita de David.');
        }
        directiva = `${directiva}\n${partesDirectiva.join(' ')}`;
      }
      return { handled: false, texto, esAudio: true, urgencyDirective: directiva };
    }

    console.warn('Aviso: Audio no pudo ser transcrito con claridad.');
    await sock.sendMessage(remoteJid, {
      text: 'He recibido la nota de voz pero no he podido transcribirla con claridad. Repitemela si puedes.'
    }, { quoted: msg });
    return { handled: true, texto: null, esAudio: false, urgencyDirective };
  } catch (errAudio) {
    console.error('Error procesando nota de voz:', errAudio);
    await sock.sendMessage(remoteJid, {
      text: mensajeErrorParaUsuario(errAudio, { contexto: 'audio' })
    }, { quoted: msg });
    return { handled: true, texto: null, esAudio: false, urgencyDirective };
  }
}

/**
 * Procesa imageMessage: tickets de compra o analisis multimodal con visionService y registro en historial.
 */
export async function procesarImagenEntrante({ sock, msg, remoteJid, deps = {} }) {
  const captionFoto = (msg.message.imageMessage.caption || '').trim();
  const descargarFoto = crearDescargadorMedia(sock, deps);

  if (/ticket|recibo|factura|compra|gasto/i.test(captionFoto)) {
    const analizarTicket = typeof deps.analizarTicket === 'function' ? deps.analizarTicket : crearAnalizadorTicket();
    if (typeof analizarTicket !== 'function') {
      await sock.sendMessage(remoteJid, {
        text: 'Veo que me mandas un ticket, David, pero el lector de fotos aun no esta configurado, asi que no puedo leerlo. Mientras tanto, dimelo tu: "gaste 12,50 en Mercadona".'
      }, { quoted: msg });
      return { handled: true };
    }
    try {
      const fotoBuffer = await descargarFoto(msg);
      const lectura = await analizarTicket(fotoBuffer, { chatId: remoteJid, caption: captionFoto });
      const resBorrador = crearBorradorDesdeTicket(lectura || {}, { rutaArchivo: deps.rutaArchivoFinanzas, chatId: remoteJid });
      if (resBorrador.ok) {
        const fnEnviarConfirmacion = deps.enviarConfirmacionInteractiva || enviarConfirmacionInteractiva;
        await fnEnviarConfirmacion(sock, remoteJid, resBorrador.resumen, {
          idConfirmar: 'btn_gasto_confirmar',
          idCancelar: 'btn_gasto_descartar',
          textoConfirmar: 'Confirmar gasto',
          textoCancelar: 'Descartar',
          footer: 'D.A.V.I.S. Finanzas'
        });
        try {
          const resumenEntrada = captionFoto ? `[Imagen de ticket recibida: ${captionFoto}]` : '[Imagen de ticket recibida]';
          registrarIntercambio(remoteJid, resumenEntrada, resBorrador.resumen);
        } catch {}
      } else {
        await sock.sendMessage(remoteJid, { text: resBorrador.error }, { quoted: msg });
      }
    } catch (errTicket) {
      console.error('Error procesando foto de ticket:', errTicket.message);
      await sock.sendMessage(remoteJid, {
        text: 'No he podido procesar la foto del ticket, David. Prueba de nuevo o dimelo en texto y lo anoto.'
      }, { quoted: msg });
    }
    return { handled: true };
  }

  const fnAnalizar = typeof deps.analizarImagen === 'function' ? deps.analizarImagen : analizarImagen;
  try {
    const fotoBuffer = await descargarFoto(msg);
    const resVision = await fnAnalizar({
      bufferOPath: fotoBuffer,
      prompt: captionFoto || undefined,
      mimeType: msg.message.imageMessage.mimetype || 'image/jpeg'
    }, deps);

    if (resVision && resVision.ok && resVision.analisis) {
      await sock.sendMessage(remoteJid, { text: resVision.analisis }, { quoted: msg });
      try {
        const resumenEntrada = captionFoto ? `[Imagen recibida: ${captionFoto}]` : '[Imagen recibida]';
        registrarIntercambio(remoteJid, resumenEntrada, resVision.analisis);
      } catch {}
      return { handled: true };
    }
    if (resVision && !resVision.ok && resVision.error) {
      await sock.sendMessage(remoteJid, { text: resVision.error }, { quoted: msg });
      return { handled: true };
    }
  } catch (errFoto) {
    console.error('Error procesando imagen general con visionService:', errFoto.message);
    if (!captionFoto) {
      await sock.sendMessage(remoteJid, {
        text: 'No he podido procesar la imagen recibida, David.'
      }, { quoted: msg });
      return { handled: true };
    }
  }
  return { handled: false };
}

/**
 * Procesa documentMessage / documentWithCaptionMessage (PDF, DOCX, XLSX, TXT, MD, CSV) y registra en historial.
 */
export async function procesarDocumentoEntrante({ sock, msg, docMsg, remoteJid, texto, deps = {} }) {
  console.log(`[WhatsApp] Documento recibido de David: ${docMsg.fileName || 'adjunto'} (${docMsg.mimetype || 'desconocido'}).`);
  try {
    const descargarDoc = crearDescargadorMedia(sock, deps);
    const docBuffer = await descargarDoc(msg);
    const captionDoc = (docMsg.caption || docMsg.title || texto || '').trim();
    const nombreArchivo = docMsg.fileName || 'adjunto';
    const fileName = String(nombreArchivo).toLowerCase();
    const mimetype = String(docMsg.mimetype || '').toLowerCase();

    const registrarDocEnHistorial = (resumenDoc, respuestaDoc) => {
      try {
        const entrada = `[Documento recibido: ${nombreArchivo}${captionDoc ? ` | Consulta: ${captionDoc}` : ''}${resumenDoc ? ` | Extracto: ${resumenDoc.slice(0, 300)}` : ''}]`;
        registrarIntercambio(remoteJid, entrada, respuestaDoc);
      } catch {}
    };

    if (mimetype.includes('pdf') || fileName.endsWith('.pdf')) {
      const fnProcesarPDF = typeof deps.procesarDocumentoPDF === 'function' ? deps.procesarDocumentoPDF : procesarDocumentoPDF;
      const resPDF = await fnProcesarPDF({ bufferOPath: docBuffer, pregunta: captionDoc || undefined }, deps);
      if (resPDF && resPDF.ok) {
        const textoRespuesta = resPDF.tipo === 'consulta' ? resPDF.respuesta : resPDF.resumen;
        await sock.sendMessage(remoteJid, { text: textoRespuesta }, { quoted: msg });
        registrarDocEnHistorial(resPDF.resumen || textoRespuesta, textoRespuesta);
      } else {
        let resueltoPorVision = false;
        if (typeof deps.renderizarPdfAImagen === 'function') {
          try {
            const imgBuf = await deps.renderizarPdfAImagen(docBuffer);
            if (imgBuf) {
              const fnAnalizar = typeof deps.analizarImagen === 'function' ? deps.analizarImagen : analizarImagen;
              const resVisionPdf = await fnAnalizar({
                bufferOPath: imgBuf,
                prompt: captionDoc || 'Extrae y resume el contenido de este documento PDF escaneado. Responde en espanol, sin emojis.',
                mimeType: 'image/png'
              }, deps);
              if (resVisionPdf && resVisionPdf.ok && resVisionPdf.analisis) {
                await sock.sendMessage(remoteJid, { text: resVisionPdf.analisis }, { quoted: msg });
                registrarDocEnHistorial('', resVisionPdf.analisis);
                resueltoPorVision = true;
              }
            }
          } catch {}
        }
        if (!resueltoPorVision) {
          const msgFallbackPdf = resPDF?.error || 'El documento PDF no contiene texto extraible (puede ser un PDF escaneado). Si quieres, enviame una captura o foto de la pagina para analizarla con vision.';
          await sock.sendMessage(remoteJid, { text: msgFallbackPdf }, { quoted: msg });
        }
      }
      return { handled: true };
    }

    const fnExtraerDoc = typeof deps.extraerTextoDocumento === 'function' ? deps.extraerTextoDocumento : extraerTextoDocumento;
    const resDoc = fnExtraerDoc(docBuffer, { fileName, mimetype });
    if (resDoc && resDoc.ok && resDoc.texto) {
      const fnConsultar = typeof deps.consultarSeccionPDF === 'function' ? deps.consultarSeccionPDF : consultarSeccionPDF;
      const fnResumir = typeof deps.resumirDocumento === 'function' ? deps.resumirDocumento : resumirDocumento;
      let textoRespuesta;
      if (captionDoc) {
        const resConsulta = fnConsultar(captionDoc, resDoc.texto);
        textoRespuesta = resConsulta.answer || resConsulta.respuesta || String(resConsulta);
      } else {
        textoRespuesta = fnResumir(resDoc.texto);
      }
      await sock.sendMessage(remoteJid, { text: textoRespuesta }, { quoted: msg });
      registrarDocEnHistorial(resDoc.texto, textoRespuesta);
    } else {
      await sock.sendMessage(remoteJid, {
        text: resDoc?.error || `He recibido el archivo "${nombreArchivo}", pero no he podido extraer texto legible. Formatos admitidos: PDF, TXT, MD, CSV, DOCX y XLSX.`
      }, { quoted: msg });
    }
    return { handled: true };
  } catch (errDoc) {
    console.error('Error procesando documento entrante:', errDoc.message);
    await sock.sendMessage(remoteJid, {
      text: 'No he podido procesar el documento recibido, David. Por favor verifica el archivo y prueba de nuevo.'
    }, { quoted: msg });
    return { handled: true };
  }
}

/**
 * Procesa locationMessage o liveLocationMessage contra vigilancias activas de llegada.
 */
export async function procesarUbicacionMensaje({ sock, msg, ubicacionMsg, remoteJid, texto, deps = {} }) {
  try {
    const rUbic = procesarUbicacionEntrante({
      chatId: remoteJid,
      latitud: ubicacionMsg.degreesLatitude,
      longitud: ubicacionMsg.degreesLongitude
    }, { rutaArchivo: deps.rutaArchivoLlegada });
    if (rUbic.disparados > 0) {
      await sock.sendMessage(remoteJid, {
        text: 'Has entrado en la zona de un aviso de llegada, David: te he dejado el aviso y lo he dado por completado.'
      }, { quoted: msg });
    }
  } catch (errUbic) {
    console.error('Error procesando ubicacion entrante:', errUbic.message);
  }
  return { handled: !texto };
}

/**
 * Orquesta el pipeline de medios entrantes (audio, texto reenviado, imagen, documento y ubicacion).
 * Devuelve { handled, texto, esAudio, urgencyDirective }.
 */
export async function procesarMediaEntrante({
  sock,
  msg,
  remoteJid,
  texto,
  esAudio,
  urgencyDirective,
  deps = {},
  extraerTextoMensaje
}) {
  let textoActual = texto;
  let esAudioActual = esAudio;
  let directivaActual = urgencyDirective;

  if (msg.message.audioMessage) {
    const resAudio = await procesarAudioEntrante({
      sock,
      msg,
      remoteJid,
      deps,
      urgencyDirective: directivaActual
    });
    if (resAudio.handled) {
      return resAudio;
    }
    textoActual = resAudio.texto;
    esAudioActual = resAudio.esAudio;
    directivaActual = resAudio.urgencyDirective;
  } else if (!textoActual && typeof extraerTextoMensaje === 'function') {
    textoActual = extraerTextoMensaje(msg);
  }

  if (!esAudioActual && msg.message.extendedTextMessage?.contextInfo?.isForwarded) {
    const directivaReenviado = '[DIRECTIVA MENSAJE REENVIADO]: Este mensaje es reenviado. Devuelve un resumen estructurado en puntos clave y propuestas concretas de recordatorios, eventos o notas a guardar. NO ejecutes mutaciones sin confirmacion explicita de David.';
    directivaActual = directivaActual ? `${directivaActual}\n${directivaReenviado}` : directivaReenviado;
  }

  if (msg.message.imageMessage) {
    const resImg = await procesarImagenEntrante({ sock, msg, remoteJid, deps });
    if (resImg.handled) {
      return { handled: true, texto: textoActual, esAudio: esAudioActual, urgencyDirective: directivaActual };
    }
  }

  const docMsg = msg.message.documentMessage || msg.message.documentWithCaptionMessage?.message?.documentMessage;
  if (docMsg) {
    await procesarDocumentoEntrante({ sock, msg, docMsg, remoteJid, texto: textoActual, deps });
    return { handled: true, texto: textoActual, esAudio: esAudioActual, urgencyDirective: directivaActual };
  }

  const ubicacionMsg = msg.message.locationMessage || msg.message.liveLocationMessage || null;
  if (ubicacionMsg) {
    const resUbic = await procesarUbicacionMensaje({ sock, msg, ubicacionMsg, remoteJid, texto: textoActual, deps });
    if (resUbic.handled) {
      return { handled: true, texto: textoActual, esAudio: esAudioActual, urgencyDirective: directivaActual };
    }
  }

  return {
    handled: false,
    texto: textoActual,
    esAudio: esAudioActual,
    urgencyDirective: directivaActual
  };
}
