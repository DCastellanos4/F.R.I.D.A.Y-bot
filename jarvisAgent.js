import { config } from './config.js';
import { herramientasJarvis } from './tools.js';
import { obtenerNoticiasEstructuradas } from './newsService.js';
import {
  crearRecordatorio,
  listarRecordatorios,
  cancelarRecordatorio
} from './reminderService.js';
import {
  programarMensaje,
  listarMensajesProgramados,
  cancelarMensajeProgramado
} from './scheduledMessageService.js';
import { generarResumenInteligente } from './summarizerService.js';
import { navegarYExtraerArticulo } from './browserService.js';
import {
  consultarSaludServidor,
  comprobarPuertoTCP
} from './proactiveAlerts.js';
import {
  guardarMemoria,
  buscarMemorias,
  listarMemorias,
  olvidarMemoria,
  normalizarTexto
} from './memoryService.js';
import {
  vigilarProducto,
  listarProductosVigilados,
  cancelarVigilancia
} from './sniperService.js';
import { consultarClima } from './weatherService.js';
import { chatCompletion } from './llmService.js';
import {
  setVipMode,
  isVipModeActive,
  addVipContact,
  getVipContacts
} from './vipFilterService.js';
import { generateGroupSummary } from './groupSummarizerService.js';
import { downloadMedia } from './mediaDownloaderService.js';
import { savePersonalNote, listRecentNotes } from './notesService.js';
import { requestExecution, confirmAndExecute } from './bashConsoleService.js';
import {
  generatePassword,
  generatePin,
  generateToken,
  generateCryptoKey,
  saveCredentialToMemory
} from './cryptoGeneratorService.js';
import { inspectContainers } from './dockerMonitorService.js';
import { checkDiskUsage } from './diskStorageService.js';
import { readNetworkBytes } from './networkMonitorService.js';
import { checkCertificateExpiry } from './sslMonitorService.js';
import { getTunnelStatus, startTunnel, stopTunnel } from './tunnelManagerService.js';
import { createEncryptedBackup } from './backupService.js';

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

  // Si tiene saludo o agradecimiento y no pide ninguna acción: 0 herramientas (1.2s de respuesta)
  if (tieneChitChat && !matchClima && !matchMensajeProgramado && !matchRecordatorio && !matchMemoria && !matchSniper && !matchNoticias && !matchNavegacion && !matchServidor && !matchVip && !matchGrupo && !matchMultimedia && !matchNotas && !matchVCard && !matchEncuestas && !matchBash && !matchCrypto && !matchDocker && !matchDisco && !matchInfra && !matchTunel && !matchBackup) {
    return [];
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
    tools.push(...herramientasJarvis.filter(h => h.function.name === 'execute_bash_command' || h.function.name === 'confirm_bash_otp'));
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

  // Safety Net: si no encajó en ninguna categoría pero tampoco es chit-chat, pasar todas las herramientas
  if (tools.length === 0) {
    console.log(`[Router Safety Net] Mensaje de intención ambigua: "${norm}". Pasando todas las herramientas.`);
    return herramientasJarvis;
  }

  // Eliminar duplicados
  const unicas = [];
  const nombres = new Set();
  for (const t of tools) {
    if (!nombres.has(t.function.name)) {
      nombres.add(t.function.name);
      unicas.push(t);
    }
  }

  return unicas;
}

export async function consultarJarvis(mensajeUsuario, historial = [], opciones = {}) {
  const tiempoInicio = Date.now();

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

  // Selección inteligente de herramientas
  const herramientasActivas = seleccionarHerramientasPorIntencion(mensajeUsuario);

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
8. TERMINAL Y BASH: Para ejecutar comandos en consola bash, invoca "execute_bash_command". Para confirmar autorizaciones OTP pendientes, invoca "confirm_bash_otp".
9. GENERADOR CRIPTOGRAFICO: Para generar contraseñas seguras, PINs, tokens o claves criptograficas, invoca "generate_crypto_credential".
10. INFRAESTRUCTURA Y SERVICIOS: Para consultar el estado de Docker, espacio en disco, red o certificados SSL, invoca "get_infrastructure_status".
11. GESTION DE TUNELES: Para consultar estado o arrancar/detener tuneles Cloudflare o Tailscale, invoca "manage_tunnel".
12. COPIAS DE SEGURIDAD: Para generar backups cifrados AES-256-GCM inmediatos, invoca "trigger_encrypted_backup".`;
  }

  const mensajes = [
    {
      role: 'system',
      content: systemPrompt
    },
    ...historial,
    { role: 'user', content: mensajeUsuario }
  ];

  const respuesta = await chatCompletion({
    messages: mensajes,
    tools: herramientasActivas.length > 0 ? herramientasActivas : undefined,
    options: {
      temperature: 0.1,
      num_ctx: 2048,
      num_thread: 4
    }
  });

  // Si el modelo decide ejecutar herramientas (o el fallback las extrajo)
  if (respuesta.message.tool_calls && respuesta.message.tool_calls.length > 0) {
    mensajes.push(respuesta.message);
    let enlacesParaAdjuntar = [];

    for (const llamada of respuesta.message.tool_calls) {
      const nombreFuncion = llamada.function.name;
      const args = llamada.function.arguments || {};
      console.log(`[J.A.R.V.I.S. Tool Call] Invocando: ${nombreFuncion} con argumentos:`, args);

      let resultadoTool = '';

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
        const res = olvidarMemoria(args.criterio);
        resultadoTool = res.mensaje || res.error || 'Operación completada, señor.';
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
        return limpiarRespuestaJarvis(resResumen);
      } else if (nombreFuncion === 'obtener_noticias_actuales') {
        const cat = args.categoria || 'general';
        const data = await obtenerNoticiasEstructuradas(cat, 5);

        if (data.ok && data.articulos.length > 0) {
          enlacesParaAdjuntar = data.articulos;
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
        const res = await requestExecution(cmd);
        if (res.status === 'EXECUTED') {
          resultadoTool = `Comando ejecutado con exito (Codigo: ${res.exitCode}):\n${res.stdout || res.stderr || 'Comando completado sin salida'}`;
        } else if (res.status === 'OTP_REQUIRED') {
          resultadoTool = `El comando "${cmd}" es critico (${res.reason}). Se requiere confirmacion 2FA. Codigo OTP de 6 digitos generado: ${res.otpCode} (Validez: ${res.ttlSeconds} segundos, ID: ${res.commandId}). Confirma con confirm_bash_otp o "confirmar otp ${res.otpCode}".`;
        } else if (res.status === 'FORBIDDEN') {
          resultadoTool = `Comando denegado por politica de seguridad: ${res.reason}`;
        } else {
          resultadoTool = `Fallo en la ejecucion del comando: ${res.error || res.status}`;
        }
      } else if (nombreFuncion === 'confirm_bash_otp') {
        const res = await confirmAndExecute(args.id_comando || args.otp, args.otp);
        if (res.status === 'EXECUTED') {
          resultadoTool = `Autorizacion 2FA confirmada con exito. Comando "${res.command}" ejecutado:\n${res.stdout || res.stderr || 'Comando completado sin salida'}`;
        } else if (res.status === 'INVALID_OTP') {
          resultadoTool = `Codigo OTP invalido: ${res.error}`;
        } else if (res.status === 'EXPIRED') {
          resultadoTool = `El codigo OTP ha expirado. Por favor, vuelve a solicitar el comando.`;
        } else {
          resultadoTool = `Error en autorizacion OTP: ${res.error || res.status}`;
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
        const pass = args.passphrase || process.env.BACKUP_PASSPHRASE || process.env.DAVIS_BACKUP_KEY || 'davis_master_passphrase_2026';
        try {
          const res = await createEncryptedBackup({ passphrase: pass });
          const tamanoKB = (res.sizeBytes / 1024).toFixed(2);
          resultadoTool = `Copia de seguridad cifrada completada con exito (AES-256-GCM DAVBAK01).\nArchivo: ${res.backupPath}\nTamano: ${tamanoKB} KB (${res.fileCount} ficheros incluidos)\nSHA256: ${res.sha256}`;
        } catch (errBak) {
          resultadoTool = `Error al generar la copia de seguridad cifrada: ${errBak.message}`;
        }
      } else {
        resultadoTool = 'Función no reconocida.';
      }

      mensajes.push({
        role: 'tool',
        content: resultadoTool,
        tool_call_id: llamada.id
      });
    }

    console.log(`[J.A.R.V.I.S.] Sintetizando respuesta final...`);
    const respuestaFinal = await chatCompletion({
      messages: mensajes,
      options: {
        num_ctx: 2048,
        num_predict: 250,
        num_thread: 4,
        temperature: 0.1
      }
    });

    let textoFinal = respuestaFinal.message.content.trim();

    if (enlacesParaAdjuntar.length > 0) {
      textoFinal += '\n\n═════════════════════\nEnlaces para lectura completa:';
      for (const art of enlacesParaAdjuntar) {
        textoFinal += `\n${art.id}. ${art.titulo}\n   ${art.link}\n`;
      }
    }

    const duracionSeg = ((Date.now() - tiempoInicio) / 1000).toFixed(2);
    console.log(`[J.A.R.V.I.S.] Petición con herramienta completada en ${duracionSeg}s`);
    return limpiarRespuestaJarvis(textoFinal);
  }

  const duracionSeg = ((Date.now() - tiempoInicio) / 1000).toFixed(2);
  console.log(`[J.A.R.V.I.S.] Petición conversacional completada en ${duracionSeg}s`);
  return limpiarRespuestaJarvis(respuesta.message.content);
}
