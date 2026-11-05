import { config } from '../config/config.js';
import { herramientasJarvis } from './tools.js';
import { obtenerNoticiasEstructuradas } from '../services/newsService.js';
import {
  crearRecordatorio,
  listarRecordatorios,
  cancelarRecordatorio
} from '../services/reminderService.js';
import {
  programarMensaje,
  listarMensajesProgramados,
  cancelarMensajeProgramado
} from '../services/scheduledMessageService.js';
import { generarResumenInteligente } from '../services/summarizerService.js';
import { navegarYExtraerArticulo } from '../services/browserService.js';
import {
  consultarSaludServidor,
  comprobarPuertoTCP
} from '../monitors/proactiveAlerts.js';
import {
  guardarMemoria,
  buscarMemorias,
  listarMemorias,
  olvidarMemoria,
  normalizarTexto
} from '../services/memoryService.js';
import { registrarBorradoMasivoPendiente } from '../services/destructiveActionService.js';
import { NUM_CTX_DEFECTO, NUM_PREDICT_DEFECTO } from './llmService.js';
import {
  vigilarProducto,
  listarProductosVigilados,
  cancelarVigilancia
} from '../monitors/sniperService.js';
import { consultarClima } from '../services/weatherService.js';
import { chatCompletion, esRespuestaTruncada } from './llmService.js';
import { clasificarIntencionConModelo, UMBRAL_CONFIANZA } from './intentRouterService.js';
import { registrarCandidatura, listarCandidaturas, actualizarCandidatura, resumenCandidaturas } from '../services/applicationTrackerService.js';
import { escanearRadar, configurarRadar, leerConfigRadar, iniciarMonitorRadar } from '../services/jobRadarService.js';
import {
  setVipMode,
  isVipModeActive,
  addVipContact,
  getVipContacts
} from '../services/vipFilterService.js';
import { generateGroupSummary } from '../services/groupSummarizerService.js';
import { downloadMedia } from '../services/mediaDownloaderService.js';
import { savePersonalNote, listRecentNotes } from '../services/notesService.js';
import { requestExecution } from '../system/bashConsoleService.js';
import {
  generatePassword,
  generatePin,
  generateToken,
  generateCryptoKey,
  saveCredentialToMemory
} from '../services/cryptoGeneratorService.js';
import { inspectContainers } from '../monitors/dockerMonitorService.js';
import { checkDiskUsage } from '../system/diskStorageService.js';
import { readNetworkBytes } from '../monitors/networkMonitorService.js';
import { checkCertificateExpiry } from '../monitors/sslMonitorService.js';
import { getTunnelStatus, startTunnel, stopTunnel } from '../system/tunnelManagerService.js';
import { createEncryptedBackup } from '../system/backupService.js';

/**
 * Detecta si David pide poner más tabaco a la cachimba (Easter Egg Iron Man)
 */
export function esPeticionCachimba(texto) {
  if (!texto) return false;
  const t = normalizarTexto(texto);

  if (/^(recuerda|recuerdame|acuerdate|avisame|pon un recordatorio)/.test(t)) {
    return false;
  }

  const patrones = [
    /(pon|ponle|echa|echale|mete|metele|anade|anadele|recarga|recargale|mas)\s+(mas\s+)?tabaco.*(cachimba|shisha|hookah|cazoleta)/,
    /(cachimba|shisha|hookah|cazoleta).*(pon|ponle|echa|echale|mete|metele|anade|anadele|mas)\s+tabaco/,
    /(pon|ponle|echa|echale)\s+mas\s+tabaco/,
    /mas\s+tabaco\s+(a\s+la|en\s+la)?\s*(cachimba|shisha|hookah|cazoleta)/,
    /tabaco\s+(a\s+la|en\s+la)\s*(cachimba|shisha|hookah|cazoleta)/,
    /cachimba.*tabaco/,
    /tabaco.*cachimba/
  ];

  return patrones.some(p => p.test(t));
}

/**
 * Elimina emojis y filtra cualquier código residual o slop de la respuesta final
 */
export function limpiarRespuestaJarvis(texto) {
  if (!texto) return '';

  // 1. Quitar todos los emojis Unicode (incluyendo Extended_Pictographic, alarmas \u2300-\u23FF, modificadores)
  let limpio = texto
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F000}-\u{1F02F}\u{1FA70}-\u{1FAFF}\u{2300}-\u{23FF}\u{2B50}\u{200D}\u{FE0F}]/gu, '');

  // 2. Si el modelo escupió residualmente una línea de llamada a función en texto plano (ej: "consultar_clima {...}"), eliminarla
  limpio = limpio.replace(/^[a-zA-Z0-9_]+\s*\{[\s\S]*?\}\s*$/gm, '');

  // 3. Normalizar espacios y signos de puntuación huérfanos
  limpio = limpio.replace(/\s+,/g, ',').replace(/\s+\./g, '.');
  return limpio.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * Enrutador de herramientas de alta precisión (Dynamic Tool Pruning):
 * Inyecta las herramientas requeridas según la intención de David.
 */
export function seleccionarHerramientasPorIntencion(mensaje) {
  return analizarIntencion(mensaje).herramientas;
}

/**
 * Enrutador por expresiones regulares con metadatos: ademas de las
 * herramientas devuelve las intenciones detectadas, si cayo en el safety net
 * (sin coincidencias) y si es charla pura. jarvisAgent usa estos metadatos
 * para decidir si invoca al clasificador por modelo.
 */
export function analizarIntencion(mensaje) {
  const norm = normalizarTexto(mensaje);
  const sinNombre = norm.replace(/\b(jarvis|friday|viernes)\b/gi, '').replace(/\s+/g, ' ').trim();
  const tieneUrl = /(https?:\/\/[^\s]+)/i.test(mensaje);

  // Detección de charla puramente conversacional
  const tieneChitChat = /(hola|ey|hey|buenas|buenos dias|buenas tardes|buenas noches|que tal|como estas|como va|quien eres|que eres|que sabes hacer|que puedes hacer|gracias|muchas gracias|de nada|ok|vale|entendido|perfecto|genial|adios|hasta luego|chao|hasta pronto)/i.test(sinNombre);

  // Casos especiales de memoria:
  const esRecuerdaQueDato = /(recuerda que|apunta que|guarda que|anota que|no te olvides de que|apunta:|a partir de ahora|desde ahora)/i.test(sinNombre) && 
                            !/(a las \d+|en \d+\s*(min|hora)|manana)/i.test(sinNombre);

  const esClaveAlarma = /(codigo|clave|contrasena|pin)\s+(de\s+la\s+)?alarma/i.test(sinNombre);

  const intents = {
    // Clima y meteorología (incluye variaciones fonéticas comunes de voz como "del madre", "en el madre")
    clima: /(tiempo|clima|meteorolog|temperatura|lluvia|llover|paraguas|frio|calor|sol|grados|prevision|que tiempo|va a llover|hara sol|hara frio|hara calor|era manana)/i,

    // Second Brain (Memoria personal permanente)
    esHechoMemoria: /(recuerda que|apunta que|guarda que|anota que|no te olvides de que|apunta:|a partir de ahora|desde ahora|mi hermano|mi hermana|mi madre|mi padre|mi mama|mi papa|mi amigo|mi amiga|mi novia|mi novio|mi mujer|mi marido|mi hijo|mi hija|calza|talla|numero de pie|pie|zapatillas?|zapatos?|cumpleanos|cumple|clave|contrasena|password|pin|codigo|wifi|correo|email|mail|direccion|vive en|trabaja en|le gusta|favorit[ao]|preferencia|segunda memoria|segundo cerebro|que sabes de|que calza|que talla|cuando es el cumple|cual es la clave|cual es el wifi|cual es el codigo|cual es mi correo|cual es mi email|mis recuerdos|banco de memoria|olvida que|borra de tu memoria|elimina de tu memoria)/i,
    
    // Mensajes programados de WhatsApp a números externos
    mensajeProgramado: /(programa(r)?\s+(un\s+)?mensaje|manda(r)?\s+(un\s+)?mensaje|envia(r)?\s+(un\s+)?mensaje|escribe(le)?\s+a\s+(\+?\d+|[a-zA-Z]+)|mandale\s+(un\s+)?mensaje|enviale\s+(un\s+)?mensaje|mensajes?\s+programados?|cancela(r)?\s+(el\s+)?mensaje\s+programado)/i,

    // Recordatorios, avisos y alarmas temporales personales
    esRecordatorio: /(recuerda|record|acuerda|acord|avis|alarm|despiert|agend|cita|evento|tareas? pendientes?|que (tengo|hay) (pendiente|que hacer)|a las \d+|en \d+\s*(min|hora|dia|seg)|manana a las|pon (un )?(recordatorio|aviso|alarma)|cancela.*recordatorio|elimina.*recordatorio|borra.*recordatorio)/i,

    // Sniper de precios (Item Tracker)
    sniper: /(vigila|vigilar|precio|precios|oferta|ofertas|baja de|baje de|chollos?|gangas?|stock|disponibilidad|cuesta.*menos|cuanto vale|cuanto cuesta|amazon\.|wallapop|pccomponentes|aliexpress|productos? (vigilados?|en seguimiento)|que (vigilas|sigues|rastreas)|tracker|item tracker|tracking|seguimiento|deja de vigilar|cancela.*vigilancia)/i,
    
    // Noticias reales
    noticias: /(noticia|noticias|titular|titulares|actualidad|periodico|diario|prensa|ultima hora|briefing|que pasa en el mundo|que se cuenta en el mundo)/i,

    // Navegación Web / Playwright Browser / Lectura de enlaces
    navegacion: /(navega|entra|abre|lee|inspecciona|mira|visita|accede)\s+(a\s+la|en\s+la|la)?\s*(noticia|web|pagina|enlace|link|articulo)|resum(e|ir)|qu[eé?] dice|de qu[eé?] va/i,
    
    // Servidor / Minecraft
    servidor: /(servidor|server|minecraft|mc|ram|cpu|salud del servidor|sistema|como esta el server|esta online|puerto 25565)/i,

    // Filtro VIP / No molestar
    vip: /(modo\s+vip|filtro\s+vip|no\s+molestar|dnd|lista\s+blanca|contacto\s+vip|activar\s+vip|desactivar\s+vip|estado\s+vip)/i,

    // Resúmenes de grupos de WhatsApp
    grupo: /(resum(ir|e|en)\s+(el\s+)?grupo|mensajes\s+del\s+grupo|que\s+ha\s+pasado\s+en\s+el\s+grupo|actividad\s+del\s+grupo)/i,

    // Descarga multimedia (YouTube, Reels, TikTok)
    multimedia: /(descarga(r)?|bajar|extrae(r)?)\s+(el\s+)?(video|audio|cancion|reel|tiktok|youtube|mp3|mp4)/i,

    // Notas personales del Second Brain
    notas: /(guarda(r)?\s+(una\s+)?nota|apunta(r)?\s+(esta\s+)?nota|mis\s+notas|listar\s+notas|que\s+notas\s+tengo)/i,

    // Contactos y vCards
    vcard: /(manda(r)?|envia(r)?|pasa(me)?)\s+(el\s+)?(contacto|vcard|tarjeta)\s+de\s+/i,

    // Encuestas
    encuestas: /(crea(r)?|lanza(r)?|haz(me)?|pon(er)?)\s+(una\s+)?encuesta/i,

    // Empleo y practicas: radar de ofertas y CRM de candidaturas
    empleo: /(pr[aá]cticas\s+(de\s+)?(empresa|curriculares)?|oferta(s)?\s+de\s+(empleo|trabajo|pr[aá]cticas)|busca(r)?\s+(empleo|trabajo|ofertas)|candidatura(s)?|curr[ií]culum|\bcv\b|entrevista\s+(de\s+)?(trabajo|empleo)|infojobs|linkedin|radar\s+de\s+ofertas|seguimiento\s+de\s+candidatura)/i,

    // Terminal, consola bash y codigos 2FA OTP (Sector 2)
    bash: /(consola|terminal|bash|comando|ejecuta|ejecutar|lanzar|shell|otp|2fa|autorizar|confirmar\s+otp|codigo\s+de\s+confirmacion|uptime|top|free|df|ps\s+aux|pm2\s+status|pm2\s+restart|systemctl)/i,

    // Generacion criptografica y credenciales (Sector 2)
    crypto: /(genera(r)?|crea(r)?|dame|necesito)\s+(una?\s+)?(contrase[nñ]a|password|clave|pin|token|key|credencial|secreto)|generador\s+criptografico|alta\s+entropia/i,

    // Infraestructura: Docker, Disco, Red, SSL (Sector 2)
    docker: /(docker|contenedor|contenedores|container|containers|auto-?healing|reiniciar\s+contenedor|levantar\s+contenedor|estado\s+docker)/i,
    disco: /(espacio\s+en\s+disco|uso\s+de\s+disco|almacenamiento|disco\s+duro|purgar\s+disco|limpiar\s+disco|liberar\s+espacio|statfs|df\s+-h)/i,
    infraestructura: /(infraestructura|estado\s+del\s+sistema|salud\s+del\s+sistema|monitor\s+ssl|certificado\s+ssl|caducidad\s+ssl|expiracion\s+ssl|ancho\s+de\s+banda|trafico\s+de\s+red|pico\s+de\s+red)/i,

    // Gestion de tuneles Cloudflare / Tailscale (Sector 2)
    tuneles: /(t[uú]nel(es)?|tunnel(s)?|cloudflare\s+tunnel|cloudflared|tailscale|abrir\s+t[uú]nel|cerrar\s+t[uú]nel|iniciar\s+t[uú]nel|detener\s+t[uú]nel|estado\s+del?\s+t[uú]nel)/i,

    // Copias de seguridad cifradas DAVBAK (Sector 2)
    backup: /(backup|copia\s+de\s+seguridad|respaldo|hacer\s+backup|crear\s+backup|backup\s+cifrado|davbak|restaurar\s+backup)/i
  };

  let matchClima = intents.clima.test(sinNombre);
  let matchMemoria = intents.esHechoMemoria.test(sinNombre) || esClaveAlarma || esRecuerdaQueDato;
  let matchMensajeProgramado = intents.mensajeProgramado.test(sinNombre) || (/(programa|manda|envia|escribe).*(mensaje|whatsapp)/i.test(sinNombre) && /\d{6,}/.test(sinNombre));
  let matchRecordatorio = (intents.esRecordatorio.test(sinNombre) && !esClaveAlarma && !esRecuerdaQueDato && !matchMensajeProgramado);
  let matchSniper = intents.sniper.test(sinNombre);
  let matchNoticias = intents.noticias.test(sinNombre);
  let matchNavegacion = intents.navegacion.test(sinNombre) || tieneUrl;
  let matchServidor = intents.servidor.test(sinNombre);
  let matchVip = intents.vip.test(sinNombre);
  let matchGrupo = intents.grupo.test(sinNombre);
  let matchMultimedia = intents.multimedia.test(sinNombre);
  let matchNotas = intents.notas.test(sinNombre);
  let matchVCard = intents.vcard.test(sinNombre);
  let matchEncuestas = intents.encuestas.test(sinNombre);
  let matchBash = intents.bash.test(sinNombre);
  let matchCrypto = intents.crypto.test(sinNombre);
  let matchDocker = intents.docker.test(sinNombre);
  let matchDisco = intents.disco.test(sinNombre);
  let matchInfra = intents.infraestructura.test(sinNombre);
  let matchTunel = intents.tuneles.test(sinNombre);
  let matchBackup = intents.backup.test(sinNombre);
  let matchEmpleo = intents.empleo.test(sinNombre);

  // Si tiene saludo o agradecimiento y no pide ninguna acción: 0 herramientas (1.2s de respuesta)
  if (tieneChitChat && !matchClima && !matchMensajeProgramado && !matchRecordatorio && !matchMemoria && !matchSniper && !matchNoticias && !matchNavegacion && !matchServidor && !matchVip && !matchGrupo && !matchMultimedia && !matchNotas && !matchVCard && !matchEncuestas && !matchBash && !matchCrypto && !matchDocker && !matchDisco && !matchInfra && !matchTunel && !matchBackup && !matchEmpleo) {
    return { herramientas: [], intenciones: ['conversacion'], safetyNet: false, esChitChat: true };
  }

  const tools = [];

  if (matchClima) {
    tools.push(...herramientasJarvis.filter(h => h.function.name === 'consultar_clima'));
  }

  if (matchMensajeProgramado) {
    tools.push(...herramientasJarvis.filter(h => h.function.name.includes('mensaje_programado') || h.function.name.includes('programar_mensaje')));
  }

  if (matchRecordatorio) {
    tools.push(...herramientasJarvis.filter(h => h.function.name.includes('recordatorio')));
  }

  if (matchMemoria) {
    tools.push(...herramientasJarvis.filter(h => h.function.name.includes('memoria')));
  }

  if (matchSniper) {
    tools.push(...herramientasJarvis.filter(h => h.function.name.includes('vigila') || h.function.name.includes('sniper') || h.function.name.includes('producto')));
  }

  if (matchNoticias) {
    tools.push(...herramientasJarvis.filter(h => h.function.name === 'obtener_noticias_actuales' || h.function.name === 'navegar_y_leer_noticia'));
  }

  if (matchNavegacion) {
    tools.push(...herramientasJarvis.filter(h => h.function.name === 'navegar_y_leer_noticia' || h.function.name === 'resumir_enlace'));
  }

  if (matchServidor) {
    tools.push(...herramientasJarvis.filter(h => h.function.name === 'consultar_estado_servidor'));
  }

  if (matchVip) {
    tools.push(...herramientasJarvis.filter(h => h.function.name.includes('_vip')));
  }

  if (matchGrupo) {
    tools.push(...herramientasJarvis.filter(h => h.function.name === 'resumir_grupo'));
  }

  if (matchMultimedia) {
    tools.push(...herramientasJarvis.filter(h => h.function.name === 'descargar_multimedia'));
  }

  if (matchNotas) {
    tools.push(...herramientasJarvis.filter(h => h.function.name.includes('nota')));
  }

  if (matchVCard) {
    tools.push(...herramientasJarvis.filter(h => h.function.name === 'enviar_contacto_vcard'));
  }

  if (matchEncuestas) {
    tools.push(...herramientasJarvis.filter(h => h.function.name === 'crear_encuesta_whatsapp'));
  }

  if (matchBash) {
    tools.push(...herramientasJarvis.filter(h => h.function.name === 'execute_bash_command'));
  }

  if (matchCrypto) {
    tools.push(...herramientasJarvis.filter(h => h.function.name === 'generate_crypto_credential'));
  }

  if (matchDocker || matchDisco || matchInfra) {
    tools.push(...herramientasJarvis.filter(h => h.function.name === 'get_infrastructure_status'));
  }

  if (matchTunel) {
    tools.push(...herramientasJarvis.filter(h => h.function.name === 'manage_tunnel'));
  }

  if (matchBackup) {
    tools.push(...herramientasJarvis.filter(h => h.function.name === 'trigger_encrypted_backup'));
  }

  if (matchEmpleo) {
    tools.push(...herramientasJarvis.filter(h => ['registrar_candidatura', 'listar_candidaturas', 'actualizar_candidatura', 'escanear_ofertas_empleo', 'configurar_radar_ofertas'].includes(h.function.name)));
  }

  // Safety Net: si no encajó en ninguna categoría pero tampoco es chit-chat, pasar todas las herramientas
  if (tools.length === 0) {
    console.log(`[Router Safety Net] El regex no reconoce la intención: "${norm}". Se consultara al clasificador por modelo.`);
    return { herramientas: herramientasJarvis, intenciones: [], safetyNet: true, esChitChat: false };
  }

  const intenciones = [];
  if (matchClima) intenciones.push('clima');
  if (matchMemoria) intenciones.push('memoria');
  if (matchMensajeProgramado) intenciones.push('mensajeProgramado');
  if (matchRecordatorio) intenciones.push('recordatorio');
  if (matchSniper) intenciones.push('sniper');
  if (matchNoticias) intenciones.push('noticias');
  if (matchNavegacion) intenciones.push('navegacion');
  if (matchServidor) intenciones.push('servidor');
  if (matchVip) intenciones.push('vip');
  if (matchGrupo) intenciones.push('grupo');
  if (matchMultimedia) intenciones.push('multimedia');
  if (matchNotas) intenciones.push('notas');
  if (matchVCard) intenciones.push('vcard');
  if (matchEncuestas) intenciones.push('encuestas');
  if (matchBash) intenciones.push('bash');
  if (matchCrypto) intenciones.push('crypto');
  if (matchDocker) intenciones.push('docker');
  if (matchDisco) intenciones.push('disco');
  if (matchInfra) intenciones.push('infraestructura');
  if (matchTunel) intenciones.push('tuneles');
  if (matchBackup) intenciones.push('backup');
  if (matchEmpleo) intenciones.push('empleo');

  // Eliminar duplicados
  const unicas = [];
  const nombres = new Set();
  for (const t of tools) {
    if (!nombres.has(t.function.name)) {
      nombres.add(t.function.name);
      unicas.push(t);
    }
  }

  return { herramientas: unicas, intenciones, safetyNet: false, esChitChat: false };
}

/**
 * Conjunto de herramientas de SOLO LECTURA (idempotentes): un fallo en ellas
 * puede reintentarse sin riesgo. Las demas escriben, envian o ejecutan
 * acciones: jamas se reintentan a ciegas; primero se comprueba el efecto real.
 */
const HERRAMIENTAS_IDEMPOTENTES = new Set([
  'consultar_clima',
  'buscar_memoria',
  'listar_memorias',
  'listar_mensajes_programados',
  'listar_recordatorios',
  'listar_candidaturas',
  'listar_productos_vigilados',
  'obtener_noticias_actuales',
  'navegar_y_leer_noticia',
  'resumir_enlace',
  'consultar_estado_servidor',
  'estado_modo_vip',
  'resumir_grupo',
  'listar_notas_recientes',
  'get_infrastructure_status'
]);


/**
 * Ejecuta una llamada de herramienta del agente y devuelve el texto resultado.
 * opciones.ejecutores permite inyectar ejecutores simulados en pruebas.
 */
async function ejecutarHerramientaJarvis(nombreFuncion, args, opciones = {}) {
  const override = opciones.ejecutores && opciones.ejecutores[nombreFuncion];
  if (typeof override === 'function') {
    const res = await override(args);
    if (typeof res === 'string') return { texto: res };
    if (res && typeof res === 'object') {
      return { texto: res.texto || JSON.stringify(res), enlaces: res.enlaces || null };
    }
    return { texto: String(res) };
  }

  let resultadoTool = '';
  let enlacesTool = null;

      if (nombreFuncion === 'consultar_clima') {
        const res = await consultarClima({
          ubicacion: args.ubicacion || config.weather?.defaultCity || 'Madrid',
          momento: args.momento || 'hoy',
          hora: args.hora || null
        });
        if (res.ok) {
          resultadoTool = res.resumen;
        } else {
          resultadoTool = `Error al consultar el clima: ${res.error}`;
        }
      } else if (nombreFuncion === 'programar_mensaje_whatsapp') {
        const res = programarMensaje({
          numero: args.numero,
          mensaje: args.mensaje,
          minutosEnElFuturo: args.minutosEnElFuturo,
          hora: args.hora,
          fecha: args.fecha,
          inmediato: args.inmediato
        });
        if (res.ok) {
          if (res.inmediato) {
            resultadoTool = `Mensaje tramitado para entrega inmediata a +${res.programado.numero}, señor. Contenido: "${res.programado.mensaje}". (ID: ${res.programado.id})`;
          } else {
            resultadoTool = `Mensaje programado con éxito, señor. Destinatario: +${res.programado.numero}. Programado para: ${res.programado.fechaHoraLocal}. Mensaje: "${res.programado.mensaje}". (ID: ${res.programado.id})`;
          }
        } else {
          resultadoTool = `No ha sido posible programar el mensaje, señor. Detalle: ${res.error}`;
        }
      } else if (nombreFuncion === 'listar_mensajes_programados') {
        const lista = listarMensajesProgramados();
        if (lista.length === 0) {
          resultadoTool = 'No hay ningún mensaje de WhatsApp programado pendiente de envío, señor.';
        } else {
          resultadoTool = 'Mensajes de WhatsApp programados pendientes:\n' + lista.map((m, i) => `${i + 1}. [${m.fechaHoraLocal}] Para +${m.numero}: "${m.mensaje}" (ID: ${m.id})`).join('\n');
        }
      } else if (nombreFuncion === 'cancelar_mensaje_programado') {
        const res = cancelarMensajeProgramado(args.criterio);
        if (res.ok) {
          resultadoTool = res.mensaje || 'Mensaje programado cancelado con éxito, señor.';
        } else {
          resultadoTool = res.mensaje || res.error || 'No se encontró ningún mensaje programado que coincida con ese criterio, señor.';
        }
      } else if (nombreFuncion === 'registrar_candidatura') {
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
          resultadoTool = `Candidatura registrada, David: ${res.candidatura.puesto} en ${res.candidatura.empresa} (estado: ${res.candidatura.estado}, ID: ${res.candidatura.id}).${seg}`;
        } else {
          resultadoTool = `No se pudo registrar la candidatura: ${res.error}`;
        }
      } else if (nombreFuncion === 'listar_candidaturas') {
        const lista = listarCandidaturas({ estado: args.estado || null }, { rutaArchivo: opciones.rutaArchivoCandidaturas });
        if (lista.length === 0) {
          const resumen = resumenCandidaturas({ rutaArchivo: opciones.rutaArchivoCandidaturas });
          resultadoTool = resumen.total === 0
            ? 'Aun no hay candidaturas registradas.'
            : `No hay candidaturas en ese estado. Resumen actual: ${Object.entries(resumen.porEstado).filter(([, n]) => n > 0).map(([e, n]) => `${e}: ${n}`).join(', ')}.`;
        } else {
          resultadoTool = 'Candidaturas:\n' + lista.map((c, i) => `${i + 1}. ${c.puesto} en ${c.empresa} [${c.estado}] (ID: ${c.id})${c.url ? ` - ${c.url}` : ''}`).join('\n');
        }
      } else if (nombreFuncion === 'actualizar_candidatura') {
        const res = actualizarCandidatura(args.criterio, { estado: args.estado || null, notas: args.notas || null }, { rutaArchivo: opciones.rutaArchivoCandidaturas });
        if (res.ok) {
          resultadoTool = `Candidatura actualizada, David: ${res.candidatura.puesto} en ${res.candidatura.empresa} pasa a estado [${res.candidatura.estado}].`;
        } else if (res.coincidencias) {
          resultadoTool = `${res.error}\n` + res.coincidencias.map((c) => `- ${c.puesto} en ${c.empresa} [${c.estado}] (ID: ${c.id})`).join('\n');
        } else {
          resultadoTool = res.error;
        }
      } else if (nombreFuncion === 'escanear_ofertas_empleo') {
        const res = await escanearRadar(opciones.radarDeps || {});
        if (!res.escaneado) {
          resultadoTool = `Radar no escaneado: ${res.motivo}`;
        } else {
          const estadoFuentes = res.fuentes.map((f) => `${f.fuente}: ${f.estado}${f.detalle ? ` (${f.detalle})` : ''}`).join('; ');
          resultadoTool = res.nuevas.length === 0
            ? `Escaneo completado sin ofertas nuevas. Fuentes: ${estadoFuentes}.`
            : `Radar: ${res.nuevas.length} oferta(s) nueva(s):\n` + res.nuevas.map((o, i) => `${i + 1}. ${o.titulo} - ${o.empresa || 'Sin empresa'}${o.url ? ` (${o.url})` : ''}`).join('\n') + `\nFuentes: ${estadoFuentes}.`;
        }
      } else if (nombreFuncion === 'configurar_radar_ofertas') {
        // Activar el radar exige intencion explicita en el mensaje original de
        // David (canal confiable); no basta con que el modelo ponga activo:true
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
          resultadoTool = `Configuracion guardada, pero NO he activado el radar porque tu mensaje no lo pedia explicitamente (estado actual: ${cfgPendiente.activo ? 'activo' : 'desactivado'}). Si quieres activarlo, dimelo claramente: "activa el radar".`;
          return { texto: resultadoTool };
        }
        if (res.ok) {
          const cfg = leerConfigRadar(opciones.radarDeps || {});
          let estadoMonitor = '';
          if (cfg.activo) {
            const monitor = iniciarMonitorRadar(opciones.radarDeps || {});
            estadoMonitor = monitor.iniciado
              ? ' Monitor de rondas activo.'
              : ` Monitor en espera: ${monitor.motivo}`;
          }
          resultadoTool = `Radar configurado, David: palabras clave [${cfg.palabrasClave.join(', ')}], ubicacion ${cfg.ubicacion || 'sin definir'}, estado ${cfg.activo ? 'ACTIVO' : 'desactivado'}.${estadoMonitor} La fuente InfoJobs requiere credenciales (INFOJOBS_CLIENT_ID/SECRET) para devolver ofertas reales; las fuentes HTML solo se editan en el fichero de configuracion.`;
        } else {
          resultadoTool = `No se pudo configurar el radar: ${res.error}`;
        }
      } else if (nombreFuncion === 'guardar_memoria') {
        const res = guardarMemoria({
          sujeto: args.sujeto,
          dato: args.dato,
          categoria: args.categoria
        });
        if (res.ok) {
          resultadoTool = `Dato guardado con éxito en el Second Brain. Sujeto: "${res.memoria.sujeto}". Detalle: "${res.memoria.dato}". Fecha: ${res.memoria.fechaLocal}.`;
        } else {
          resultadoTool = `Error al guardar en la memoria: ${res.error}`;
        }
      } else if (nombreFuncion === 'buscar_memoria') {
        const memorias = buscarMemorias(args.consulta);
        if (memorias.length === 0) {
          resultadoTool = `No encontré ningún recuerdo previo sobre "${args.consulta}" en el Second Brain, señor.`;
        } else {
          resultadoTool = `Recuerdos recuperados del Second Brain:\n` + memorias.map(m => `- [${m.sujeto.toUpperCase()}]: ${m.dato} (Registrado: ${m.fechaLocal})`).join('\n');
        }
      } else if (nombreFuncion === 'listar_memorias') {
        const memorias = listarMemorias(args.categoria);
        if (memorias.length === 0) {
          resultadoTool = 'Actualmente no hay ningún dato guardado en el Second Brain, señor.';
        } else {
          resultadoTool = `Recuerdos almacenados en el Second Brain (${memorias.length}):\n` + memorias.map((m, i) => `${i + 1}. [${m.sujeto.toUpperCase()}]: ${m.dato}`).join('\n');
        }
      } else if (nombreFuncion === 'olvidar_memoria') {
        // El modelo NUNCA puede confirmar un borrado masivo: cualquier
        // argumento "confirmado" se ignora deliberadamente. La confirmacion
        // llega fuera de banda (mensaje directo de David) via
        // destructiveActionService, como el OTP de los comandos bash.
        const res = olvidarMemoria(args.criterio, { confirmado: false });
        if (res.requiereConfirmacion) {
          const idConfirmacion = opciones.chatId
            ? registrarBorradoMasivoPendiente(opciones.chatId, String(args.criterio), res.total)
            : null;
          resultadoTool = idConfirmacion
            ? `ATENCION: borrado masivo pendiente de confirmacion humana. ${res.mensaje} Indica a David que, si esta seguro, responda exactamente "confirmar borrado ${idConfirmacion}" (validez: 5 minutos). Tu no puedes confirmarlo ni volver a intentarlo con otro argumento.`
            : `ATENCION: borrado masivo solicitado sin canal de confirmacion directa (${res.total} registros). Solo puede confirmarse desde el chat de WhatsApp de David. Tu no puedes confirmarlo.`;
        } else {
          resultadoTool = res.mensaje || res.error || 'Operación completada, señor.';
        }
      } else if (nombreFuncion === 'vigilar_producto') {
        const res = await vigilarProducto({
          url: args.url,
          nombre: args.nombre,
          precioObjetivo: args.precioObjetivo
        });
        if (res.ok) {
          resultadoTool = res.mensaje || `Producto añadido al Sniper con éxito. Nombre: "${res.item.nombre}". Precio actual: ${res.item.precioActual}€. Alerta si baja a: ${res.item.precioObjetivo}€.`;
        } else {
          resultadoTool = `Error al añadir al Sniper: ${res.error}`;
        }
      } else if (nombreFuncion === 'listar_productos_vigilados') {
        const items = listarProductosVigilados();
        if (items.length === 0) {
          resultadoTool = 'No hay ningún producto bajo vigilancia en este momento, señor.';
        } else {
          resultadoTool = 'Productos vigilados en el Sniper:\n' + items.map((item, i) => `${i + 1}. [${item.id}] ${item.nombre}: ${item.precioActual}€ -> Meta: ${item.precioObjetivo}€\n   ${item.url}`).join('\n');
        }
      } else if (nombreFuncion === 'cancelar_vigilancia') {
        const res = cancelarVigilancia(args.criterio);
        if (res.ok) {
          resultadoTool = res.mensaje || (res.item ? `Vigilancia cancelada para: "${res.item.nombre}".` : 'Vigilancia cancelada con éxito, señor.');
        } else {
          resultadoTool = res.error || 'Error al cancelar la vigilancia.';
        }
      } else if (nombreFuncion === 'navegar_y_leer_noticia') {
        const resNav = await navegarYExtraerArticulo(args.url);
        if (resNav.ok) {
          resultadoTool = `Artículo web verificado en vivo con Chromium:\n` +
            `Título: ${resNav.titulo}\n` +
            `URL: ${resNav.url}\n` +
            `Autor: ${resNav.autor || 'Redacción'}\n` +
            `Fecha: ${resNav.fecha || 'Reciente'}\n` +
            `Texto íntegro:\n${resNav.contenido}`;
        } else {
          resultadoTool = `No se pudo leer la página con el navegador: ${resNav.error}`;
        }
      } else if (nombreFuncion === 'resumir_enlace') {
        const resResumen = await generarResumenInteligente(args.url);
        return { texto: limpiarRespuestaJarvis(resResumen) };
      } else if (nombreFuncion === 'obtener_noticias_actuales') {
        const cat = args.categoria || 'general';
        const data = await obtenerNoticiasEstructuradas(cat, 5);

        if (data.ok && data.articulos.length > 0) {
          enlacesTool = data.articulos;
          const textoParaJarvis = data.articulos.map(a => `${a.id}. Titular: ${a.titulo}\nDetalle: ${a.resumen}`).join('\n\n');
          resultadoTool = `Noticias reales recuperadas (${data.ramaNombre}):\n${textoParaJarvis}`;
        } else {
          resultadoTool = 'No se pudieron recuperar noticias en este momento, señor.';
        }
      } else if (nombreFuncion === 'crear_recordatorio') {
        const res = crearRecordatorio({
          mensaje: args.mensaje,
          minutosEnElFuturo: args.minutosEnElFuturo,
          hora: args.hora
        });
        resultadoTool = `Recordatorio guardado en el sistema, señor. ID: ${res.recordatorio.id}. Programado para: ${res.recordatorio.fechaHoraLocal}. Tarea: "${res.recordatorio.mensaje}".`;
      } else if (nombreFuncion === 'listar_recordatorios') {
        const lista = listarRecordatorios();
        if (lista.length === 0) {
          resultadoTool = 'No hay ningún recordatorio pendiente en el sistema, señor.';
        } else {
          resultadoTool = 'Recordatorios pendientes:\n' + lista.map((r, i) => `${i + 1}. [${r.fechaHoraLocal}] "${r.mensaje}" (ID: ${r.id})`).join('\n');
        }
      } else if (nombreFuncion === 'cancelar_recordatorio') {
        const res = cancelarRecordatorio(args.criterio);
        if (res.ok) {
          resultadoTool = res.mensaje || (res.recordatorio ? `Recordatorio cancelado con éxito: "${res.recordatorio.mensaje}".` : 'Recordatorio cancelado con éxito, señor.');
        } else {
          resultadoTool = res.mensaje || 'Error al cancelar el recordatorio.';
        }
      } else if (nombreFuncion === 'consultar_estado_servidor') {
        const salud = consultarSaludServidor();
        const mcOnline = await comprobarPuertoTCP(config.minecraft.host, config.minecraft.port, 2000);
        resultadoTool = `Salud del sistema:\n- Memoria RAM: ${salud.libreRamGB} GB libres de ${salud.totalRamGB} GB (${salud.porcentajeUso}% en uso)\n- Procesador: ${salud.cpus} núcleos (Carga media: ${salud.loadAvg})\n- Servidor de Minecraft (${config.minecraft.host}:${config.minecraft.port}): ${mcOnline ? 'ONLINE' : 'CAIDO / APAGADO'}`;
      } else if (nombreFuncion === 'activar_modo_vip') {
        const activo = setVipMode(args.activar !== false);
        if (args.contacto_vip) addVipContact(args.contacto_vip);
        resultadoTool = `Modo Filtro VIP ${activo ? 'activado' : 'desactivado'}, señor. ${args.contacto_vip ? `Contacto ${args.contacto_vip} añadido a la lista blanca autorizada.` : ''}`;
      } else if (nombreFuncion === 'estado_modo_vip') {
        const activo = isVipModeActive();
        const vips = getVipContacts();
        resultadoTool = `Modo Filtro VIP: ${activo ? 'ACTIVO' : 'DESACTIVADO'}, señor. Contactos autorizados en lista blanca (${vips.length}): ${vips.join(', ') || 'ninguno'}.`;
      } else if (nombreFuncion === 'agregar_contacto_vip') {
        addVipContact(args.contacto);
        resultadoTool = `Contacto ${args.contacto} registrado en la lista blanca del Filtro VIP con éxito, señor.`;
      } else if (nombreFuncion === 'resumir_grupo') {
        const res = await generateGroupSummary(args.id_grupo, args.horas_atras || 24, args.max_mensajes || 50);
        resultadoTool = res.ok ? res.summaryText : `No ha sido posible generar el resumen del grupo: ${res.error}`;
      } else if (nombreFuncion === 'descargar_multimedia') {
        const res = await downloadMedia(args.url, { format: args.formato || 'video', audioOnly: args.formato === 'audio' });
        resultadoTool = res.ok ? `Descarga completada con éxito: ${res.fileName} (${(res.fileSize / 1024 / 1024).toFixed(2)} MB). Tramitado para entrega directa al chat.` : `Error en la descarga multimedia: ${res.error}`;
      } else if (nombreFuncion === 'guardar_nota_personal') {
        const res = await savePersonalNote(args.texto, { category: args.categoria, tags: args.etiquetas });
        resultadoTool = res.ok ? `Nota personal guardada en el Second Brain (${res.category}): ${res.filename}.` : `Error al guardar nota: ${res.error}`;
      } else if (nombreFuncion === 'listar_notas_recientes') {
        const notas = await listRecentNotes({ category: args.categoria, limit: args.limite || 10 });
        resultadoTool = notas.length === 0 ? 'No hay notas registradas en esta categoría, señor.' : 'Notas registradas en el Second Brain:\n' + notas.map(n => `- [${n.category}] ${n.filename}: ${n.preview}`).join('\n');
      } else if (nombreFuncion === 'enviar_contacto_vcard') {
        resultadoTool = `Tarjeta vCard digital generada para ${args.nombre} (${args.telefono}${args.organizacion ? ' - ' + args.organizacion : ''}). Tramitado para envío al chat de WhatsApp.`;
      } else if (nombreFuncion === 'crear_encuesta_whatsapp') {
        resultadoTool = `Encuesta configurada con éxito: "${args.pregunta}" (${args.opciones?.length || 0} opciones). Publicada en el chat.`;
      } else if (nombreFuncion === 'execute_bash_command') {
        const cmd = args.comando || '';
        const res = await requestExecution(cmd, { otpDelivery: opciones.otpDelivery });
        if (res.status === 'EXECUTED') {
          resultadoTool = `Comando ejecutado con exito (Codigo: ${res.exitCode}):\n${res.stdout || res.stderr || 'Comando completado sin salida'}`;
          if (res.verificacion) {
            resultadoTool += `\nVerificacion posterior (${res.verificacion.comando}): ${res.verificacion.exito ? 'efecto confirmado en el sistema' : 'NO se pudo confirmar el efecto'}.\n${res.verificacion.salida}`;
          }
        } else if (res.status === 'OTP_REQUIRED') {
          if (res.otpDelivered) {
            resultadoTool = `El comando "${cmd}" es critico (${res.reason}). He enviado un codigo OTP de 6 digitos al canal privado de David (validez: ${res.ttlSeconds} segundos, ID: ${res.commandId}). Indicale que lo confirme respondiendo "confirmar otp CODIGO". Tu no tienes acceso al codigo ni puedes confirmarlo.`;
          } else {
            resultadoTool = `El comando "${cmd}" es critico (${res.reason}) y requiere confirmacion 2FA, pero no hay un canal directo configurado para entregar el codigo OTP (disponible desde WhatsApp o la terminal interactiva). Comando en espera con ID: ${res.commandId}.`;
          }
        } else if (res.status === 'FORBIDDEN') {
          resultadoTool = `Comando denegado por politica de seguridad: ${res.reason}`;
        } else {
          resultadoTool = `Fallo en la ejecucion del comando: ${res.error || res.status}`;
        }
      } else if (nombreFuncion === 'generate_crypto_credential') {
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
          if (resMem.ok) {
            info += `\nCredencial archivada de forma segura en el Second Brain bajo la clave "${nombreClave}".`;
          } else {
            info += `\nAviso: No se pudo archivar en el Second Brain: ${resMem.error}`;
          }
        }
        resultadoTool = info;
      } else if (nombreFuncion === 'get_infrastructure_status') {
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

        resultadoTool = lineas.join('\n');
      } else if (nombreFuncion === 'manage_tunnel') {
        const tipo = args.tipo_tunel;
        const accion = args.accion;
        const nombre = args.nombre_tunel;

        if (accion === 'status') {
          const res = await getTunnelStatus(tipo, { tunnelName: nombre });
          resultadoTool = `Estado del tunel ${tipo.toUpperCase()}: ${res.running ? 'ACTIVO Y EN LINEA' : 'DETENIDO'} (Instalado: ${res.installed ? 'SI' : 'NO'})`;
        } else if (accion === 'start') {
          const res = await startTunnel(tipo, { tunnelName: nombre });
          resultadoTool = res.success ? `Tunel ${tipo} iniciado con exito: ${res.message}` : `Fallo al iniciar tunel ${tipo}: ${res.message}`;
        } else if (accion === 'stop') {
          const res = await stopTunnel(tipo, { tunnelName: nombre });
          resultadoTool = res.success ? `Tunel ${tipo} detenido con exito: ${res.message}` : `Fallo al detener tunel ${tipo}: ${res.message}`;
        } else {
          resultadoTool = `Accion de tunel desconocida: ${accion}`;
        }
      } else if (nombreFuncion === 'trigger_encrypted_backup') {
        const pass = args.passphrase || process.env.BACKUP_PASSPHRASE || process.env.DAVIS_BACKUP_KEY || '';
        if (!pass) {
          resultadoTool = 'No se puede generar la copia de seguridad: falta BACKUP_PASSPHRASE en el entorno. Sin passphrase configurada no se cifra nada con valores por defecto.';
        } else try {
          const res = await createEncryptedBackup({ passphrase: pass });
          const tamanoKB = (res.sizeBytes / 1024).toFixed(2);
          resultadoTool = `Copia de seguridad cifrada completada con exito (AES-256-GCM DAVBAK01).\nArchivo: ${res.backupPath}\nTamano: ${tamanoKB} KB (${res.fileCount} ficheros incluidos)\nSHA256: ${res.sha256}`;
        } catch (errBak) {
          resultadoTool = `Error al generar la copia de seguridad cifrada: ${errBak.message}`;
        }
      } else {
        resultadoTool = 'Función no reconocida.';
      }

  return { texto: resultadoTool, enlaces: enlacesTool };
}

export async function consultarJarvis(mensajeUsuario, historial = [], opciones = {}) {
  const tiempoInicio = Date.now();
  opciones.mensajeUsuario = mensajeUsuario; // mensaje original de David para verificar intencion en acciones sensibles

  // Detección directa de URLs para resumen rápido
  const urlMatch = mensajeUsuario.match(/https?:\/\/[^\s]+/i);
  const pideResumen = /resum|qu[eé?] dice|de qu[eé?] va|lee|analiz/i.test(mensajeUsuario);
  const esUrlSola = urlMatch && mensajeUsuario.trim() === urlMatch[0];

  if (urlMatch && (pideResumen || esUrlSola)) {
    console.log(`[J.A.R.V.I.S.] Detección directa de lectura/resumen con Playwright para: ${urlMatch[0]}`);
    const resumen = await generarResumenInteligente(urlMatch[0]);
    return limpiarRespuestaJarvis(resumen);
  }

  // Easter Egg: Solicitud de más tabaco para la cachimba
  if (esPeticionCachimba(mensajeUsuario)) {
    console.log(`[J.A.R.V.I.S. Easter Egg] Cachimba detectada: "${mensajeUsuario}"`);
    return 'A su servicio, señor. Ajustando la cazoleta y aumentando la mezcla al máximo rendimiento. Parámetros térmicos estabilizados.';
  }

  // Búsqueda proactiva en el Second Brain para inyectar recuerdos en contexto
  const memoriasProactivas = buscarMemorias(mensajeUsuario);

  // LLM inyectable (pruebas con bateria dorada) o el real por defecto
  const chatImpl = typeof opciones.chatCompletion === 'function' ? opciones.chatCompletion : chatCompletion;

  // Selección inteligente de herramientas: regex primero; si el regex no
  // reconoce la intencion (safety net), un clasificador por modelo decide con
  // confianza. Confianza baja: desambiguacion en lugar de volcar herramientas.
  const analisis = analizarIntencion(mensajeUsuario);
  let herramientasActivas = analisis.herramientas;
  let directivaDesambiguacion = '';

  if (analisis.safetyNet) {
    const clasificacion = await clasificarIntencionConModelo(mensajeUsuario, { chatCompletion: chatImpl });
    if (clasificacion && clasificacion.confianza >= UMBRAL_CONFIANZA) {
      herramientasActivas = clasificacion.herramientas;
      console.log(`[RouterModelo] Intencion clasificada por modelo: ${clasificacion.intencion} (confianza ${clasificacion.confianza}, origen ${clasificacion.origen}).`);
    } else if (clasificacion) {
      herramientasActivas = [];
      directivaDesambiguacion = '\n\n[DIRECTIVA DE DESAMBIGUACION: No esta claro que necesita David. NO inventes acciones, datos ni confirmaciones: pidele una aclaracion breve y concreta, ofreciendo como mucho dos opciones, antes de actuar.]';
      console.log(`[RouterModelo] Confianza insuficiente (${clasificacion.confianza}); se pide desambiguacion sin herramientas.`);
    } else {
      console.log('[RouterModelo] Clasificador no disponible; se mantiene el safety net del regex con todas las herramientas.');
    }
  }

  console.log(`[J.A.R.V.I.S.] Evaluando: "${mensajeUsuario}" [Herramientas: ${herramientasActivas.length > 0 ? herramientasActivas.map(h => h.function.name).join(', ') : 'Ninguna (Conversacional)'}]`);

  let systemPrompt = `Eres D.A.V.I.S. (Digital Autonomous Voice & Intelligence System), la avanzada inteligencia artificial personal y copiloto táctico de David.
Naciste de la fusión entre la lealtad, ingenio técnico y serenidad del J.A.R.V.I.S. de Tony Stark en Los Vengadores y la propia mentalidad, pragmatismo y visión de David, actuando como su alter ego digital.

PERSONALIDAD Y VOZ:
- Estatus: Eres su socio y copiloto de confianza. Hablas de tú a tú en español de España de forma natural, directa, inteligente y sobria.
- Tratamiento: Te diriges a él como "David". Puedes usar "jefe" o "señor" exclusivamente con ironía sutil o humor seco cuando la ocasión sea propicia, sin caer jamás en sumisión artificial.
- Actitud: Hipercompetente, resolutivo y leal. Cero quejas o pretextos: ejecutas y resuelves. Posees un humor seco, inteligente y sutil.
- Especialización máxima: Eres un ingeniero de software y DevOps de élite. Cuando trates temas de código, infraestructura, Linux o arquitectura técnica, habla con la solidez, rigor y criterio de un senior engineer en su misma sintonía.
- Versatilidad táctica: Mantienes control impecable sobre su operativa diaria (mensajes, recordatorios, servidores, finanzas, descanso y aficiones).

REGLAS CRÍTICAS DE COMUNICACIÓN:
1. PROHIBICIÓN TOTAL DE EMOJIS: Queda terminantemente prohibido incluir emojis o iconos decorativos en tus respuestas. Mantén un formato puramente textual, sobrio y distinguido.
2. CERO SLOP Y ADAPTABILIDAD AL CONTEXTO:
   - Para confirmaciones o acciones operativas (enviar un mensaje, poner una alarma, consultar un dato puntual): sé conciso (1 o 2 frases directas y precisas).
   - Para análisis técnicos, arquitectura, clima o noticias: ofrece respuestas limpiamente estructuradas con viñetas, sin párrafos inflados ni rodeos vacíos.
3. CERO CLICHÉS CORPORATIVOS: Prohibido decir frases como "¡Hola! ¿En qué puedo ayudarte hoy?", "Como modelo de lenguaje...", o disculpas melodramáticas redundantes.`;

  // Inyección de recuerdos existentes en el prompt para respuesta instantánea y precisa
  if (memoriasProactivas.length > 0) {
    systemPrompt += `\n\n[REGISTROS DEL SECOND BRAIN / BANCO DE MEMORIA]:
${memoriasProactivas.map(m => `- [${m.sujeto.toUpperCase()}]: ${m.dato}`).join('\n')}
(DIRECTIVA: Si la consulta de David trata sobre alguno de estos temas, respóndele DIRECTAMENTE con esta información de forma sobria y elegante).`;
  }

  if (opciones.urgencyDirective) {
    systemPrompt += `\n\n${opciones.urgencyDirective}`;
  }

  if (directivaDesambiguacion) {
    systemPrompt += directivaDesambiguacion;
  }

  if (herramientasActivas.length > 0) {
    systemPrompt += `\nINSTRUCCIONES DE HERRAMIENTAS:
Dispones de herramientas nativas para consultar datos externos y realizar acciones. Utiliza exclusivamente el mecanismo nativo de function calling. NUNCA escribas el nombre de la función ni objetos JSON en el texto de tu respuesta.

Directrices de selección:
1. CLIMA Y METEOROLOGÍA: Para consultar el tiempo, temperatura o lluvia de hoy o de mañana en cualquier ciudad o localidad (ej: Madrid), invoca "consultar_clima".
2. MENSAJES PROGRAMADOS DE WHATSAPP: Para programar el envío de un mensaje de WhatsApp a un número de teléfono en una fecha u hora específica (o en X minutos), invoca "programar_mensaje_whatsapp". Para consultar los mensajes programados pendientes, "listar_mensajes_programados". Para cancelar uno, "cancelar_mensaje_programado".
3. RECORDATORIOS Y ALARMAS PERSONALES: Para programar avisos o alarmas personales de David, invoca "crear_recordatorio". Para consultarlos, "listar_recordatorios". Para cancelar, "cancelar_recordatorio".
4. SECOND BRAIN (MEMORIA PERSONAL): Para guardar hechos o datos personales (claves, cumpleaños, tallas, correos), invoca "guardar_memoria". Para consultar datos del pasado, "buscar_memoria". Para borrar, "olvidar_memoria".
5. SNIPER DE PRECIOS: Para vigilar un producto u oferta si baja de precio, invoca "vigilar_producto". Para listar, "listar_productos_vigilados".
6. NOTICIAS Y NAVEGADOR PLAYWRIGHT: Para noticias de actualidad, invoca "obtener_noticias_actuales". Para abrir o inspeccionar un enlace o artículo web con el navegador, invoca "navegar_y_leer_noticia" o "resumir_enlace".
7. ESTADO DEL SISTEMA: Para consultar la salud del servidor o el estado de Minecraft, invoca "consultar_estado_servidor".
8. TERMINAL Y BASH: Para ejecutar comandos en consola bash, invoca "execute_bash_command". Si un comando es critico, el sistema envia un codigo OTP al canal privado de David y solo el puede confirmarlo respondiendo "confirmar otp CODIGO": tu nunca ves ni confirmas ese codigo.
9. GENERADOR CRIPTOGRAFICO: Para generar contraseñas seguras, PINs, tokens o claves criptograficas, invoca "generate_crypto_credential".
10. INFRAESTRUCTURA Y SERVICIOS: Para consultar el estado de Docker, espacio en disco, red o certificados SSL, invoca "get_infrastructure_status".
11. GESTION DE TUNELES: Para consultar estado o arrancar/detener tuneles Cloudflare o Tailscale, invoca "manage_tunnel".
12. COPIAS DE SEGURIDAD: Para generar backups cifrados AES-256-GCM inmediatos, invoca "trigger_encrypted_backup".
13. EMPLEO Y PRACTICAS: Para registrar o actualizar candidaturas, "registrar_candidatura" y "actualizar_candidatura"; para consultarlas, "listar_candidaturas". Para lanzar el radar de ofertas, "escanear_ofertas_empleo"; para configurarlo (palabras clave, ubicacion, activacion), "configurar_radar_ofertas". Si una fuente requiere credenciales, informa a David de que configuracion falta en lugar de simular resultados.`;
  }

  const mensajes = [
    {
      role: 'system',
      content: systemPrompt
    },
    ...historial,
    { role: 'user', content: mensajeUsuario }
  ];

  let respuesta = await chatImpl({
    messages: mensajes,
    tools: herramientasActivas.length > 0 ? herramientasActivas : undefined,
    options: {
      temperature: 0.1,
      num_ctx: NUM_CTX_DEFECTO,
      num_thread: 4
    }
  });

  const MAX_RONDAS_HERRAMIENTAS = opciones.maxRondasHerramientas ?? 3;
  let ronda = 0;
  let enlacesParaAdjuntar = [];
  // Registro de acciones con efectos ya ejecutadas en ESTA peticion: una
  // instruccion en el prompt no basta; el ejecutor impide duplicar envios,
  // escrituras o comandos identicos entre rondas. Alcance deliberadamente
  // acotado: misma peticion y mismos argumentos exactos. NO cubre
  // reformulaciones, ni peticiones distintas, ni reinicios del proceso; no
  // es una garantia universal de "como mucho una vez".
  const accionesConEfectosEjecutadas = new Set();

  // Bucle acotado ejecutar -> comprobar -> decidir: tras cada ronda de
  // herramientas el modelo contrasta los resultados y puede encadenar otro
  // paso (hasta MAX_RONDAS_HERRAMIENTAS) antes de responder.
  while (respuesta.message.tool_calls && respuesta.message.tool_calls.length > 0) {
    if (ronda >= MAX_RONDAS_HERRAMIENTAS) {
      console.warn(`[J.A.R.V.I.S.] Limite de ${MAX_RONDAS_HERRAMIENTAS} rondas de herramientas alcanzado; se responde con lo disponible.`);
      break;
    }
    ronda++;
    mensajes.push(respuesta.message);

    for (const llamada of respuesta.message.tool_calls) {
      const nombreFuncion = llamada.function.name;
      const args = llamada.function.arguments || {};
      console.log(`[J.A.R.V.I.S. Tool Call R${ronda}] Invocando: ${nombreFuncion} con argumentos:`, args);

      let resultadoTool;
      const claveAccion = `${nombreFuncion}:${JSON.stringify(args)}`;
      if (!HERRAMIENTAS_IDEMPOTENTES.has(nombreFuncion) && accionesConEfectosEjecutadas.has(claveAccion)) {
        resultadoTool = `La accion ${nombreFuncion} con esos mismos argumentos ya se ejecuto en esta peticion. NO se duplica una accion con efectos externos: verifica su resultado e informa a David en lugar de repetirla.`;
        console.warn(`[J.A.R.V.I.S. Tool Dedup] Duplicado bloqueado: ${claveAccion}`);
        mensajes.push({ role: 'tool', content: resultadoTool, tool_call_id: llamada.id });
        continue;
      }
      if (!HERRAMIENTAS_IDEMPOTENTES.has(nombreFuncion)) {
        accionesConEfectosEjecutadas.add(claveAccion);
      }
      try {
        const salida = await ejecutarHerramientaJarvis(nombreFuncion, args, opciones);
        resultadoTool = salida.texto;
        if (salida.enlaces) enlacesParaAdjuntar = salida.enlaces;
      } catch (errTool) {
        // Recuperacion segura: solo las consultas idempotentes pueden
        // reintentarse; escrituras, envios y comandos exigen comprobar el
        // efecto real y avisar a David, nunca reintentar a ciegas.
        resultadoTool = HERRAMIENTAS_IDEMPOTENTES.has(nombreFuncion)
          ? `Error temporal ejecutando la consulta ${nombreFuncion}: ${errTool.message}. Es una operacion de solo lectura; si procede, reintentala con argumentos corregidos.`
          : `La accion ${nombreFuncion} ha fallado: ${errTool.message}. NO la reintentes automaticamente porque escribe, envia o ejecuta cambios: verifica primero el efecto real e informa a David del fallo.`;
        console.error(`[J.A.R.V.I.S. Tool Error R${ronda}] ${nombreFuncion}:`, errTool.message);
      }

      mensajes.push({
        role: 'tool',
        content: resultadoTool,
        tool_call_id: llamada.id
      });
    }

    console.log(`[J.A.R.V.I.S.] Sintetizando (ronda ${ronda}/${MAX_RONDAS_HERRAMIENTAS})...`);
    respuesta = await chatImpl({
      messages: mensajes,
      tools: herramientasActivas.length > 0 ? herramientasActivas : undefined,
      options: {
        num_ctx: NUM_CTX_DEFECTO,
        num_predict: NUM_PREDICT_DEFECTO,
        num_thread: 4,
        temperature: 0.1
      }
    });
  }

  let textoFinal = (respuesta.message.content || '').trim();

  // Chequeo de consistencia: si la respuesta quedo cortada por el limite de
  // tokens, se pide una continuacion en lugar de entregarla mutilada.
  if (esRespuestaTruncada(textoFinal, respuesta.finishReason)) {
    console.log('[J.A.R.V.I.S.] Respuesta truncada por limite de tokens; solicitando continuacion...');
    try {
      const continuacion = await chatImpl({
        messages: [
          ...mensajes,
          { role: 'assistant', content: textoFinal },
          { role: 'user', content: 'Continua exactamente donde lo dejaste, sin repetir lo anterior.' }
        ],
        options: { num_ctx: NUM_CTX_DEFECTO, num_predict: NUM_PREDICT_DEFECTO, num_thread: 4, temperature: 0.1 }
      });
      const extra = (continuacion?.message?.content || '').trim();
      if (extra) textoFinal = `${textoFinal} ${extra}`.trim();
    } catch (errCont) {
      console.error('[J.A.R.V.I.S.] Error pidiendo continuacion:', errCont.message);
    }
  }

  if (enlacesParaAdjuntar.length > 0) {
    textoFinal += '\n\n═════════════════════\nEnlaces para lectura completa:';
    for (const art of enlacesParaAdjuntar) {
      textoFinal += `\n${art.id}. ${art.titulo}\n   ${art.link}\n`;
    }
  }

  const duracionSeg = ((Date.now() - tiempoInicio) / 1000).toFixed(2);
  console.log(`[J.A.R.V.I.S.] Peticion completada en ${duracionSeg}s (${ronda} ronda(s) de herramientas)`);
  return limpiarRespuestaJarvis(textoFinal);
}

