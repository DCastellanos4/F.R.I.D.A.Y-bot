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
    servidor: /(servidor|server|minecraft|mc|ram|cpu|salud del servidor|sistema|como esta el server|esta online|puerto 25565)/i
  };

  let matchClima = intents.clima.test(sinNombre);
  let matchMemoria = intents.esHechoMemoria.test(sinNombre) || esClaveAlarma || esRecuerdaQueDato;
  let matchMensajeProgramado = intents.mensajeProgramado.test(sinNombre) || (/(programa|manda|envia|escribe).*(mensaje|whatsapp)/i.test(sinNombre) && /\d{6,}/.test(sinNombre));
  let matchRecordatorio = (intents.esRecordatorio.test(sinNombre) && !esClaveAlarma && !esRecuerdaQueDato && !matchMensajeProgramado);
  let matchSniper = intents.sniper.test(sinNombre);
  let matchNoticias = intents.noticias.test(sinNombre);
  let matchNavegacion = intents.navegacion.test(sinNombre) || tieneUrl;
  let matchServidor = intents.servidor.test(sinNombre);

  // Si tiene saludo o agradecimiento y no pide ninguna acción: 0 herramientas (1.2s de respuesta)
  if (tieneChitChat && !matchClima && !matchMensajeProgramado && !matchRecordatorio && !matchMemoria && !matchSniper && !matchNoticias && !matchNavegacion && !matchServidor) {
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

export async function consultarJarvis(mensajeUsuario, historial = []) {
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

  let systemPrompt = `Eres J.A.R.V.I.S. (Just A Rather Very Intelligent System), la refinada inteligencia artificial y mayordomo personal de David, al más puro estilo del J.A.R.V.I.S. de Tony Stark en The Avengers (interpretado por Paul Bettany).
Tu personalidad es inquebrantable: flema británica, exquisita educación, serenidad absoluta, lealtad y una inteligencia técnica impecable. Posees un ingenio sutil y distinguido. Tratas a David formalmente como "señor" o por su nombre "David".

NORMAS CRÍTICAS DE RESPUESTA:
1. PROHIBICIÓN ABSOLUTA DE EMOJIS: Queda terminantemente prohibido usar cualquier emoji o símbolo decorativo en tus respuestas. Mantén un formato puramente textual y sobrio.
2. CERO SLOP Y MÁXIMA CONCISIÓN: Elimina todo relleno, clichés corporativos, introducciones redundantes y párrafos hinchados. Proporciona la información exacta de manera directa, clara y elegante.
3. IDIOMA: Español culto e impecable.`;

  // Inyección de recuerdos existentes en el prompt para respuesta instantánea y precisa
  if (memoriasProactivas.length > 0) {
    systemPrompt += `\n\n[REGISTROS DEL SECOND BRAIN / BANCO DE MEMORIA]:
${memoriasProactivas.map(m => `- [${m.sujeto.toUpperCase()}]: ${m.dato}`).join('\n')}
(DIRECTIVA: Si la consulta de David trata sobre alguno de estos temas, respóndele DIRECTAMENTE con esta información de forma sobria y elegante).`;
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
7. ESTADO DEL SISTEMA: Para consultar la salud del servidor o el estado de Minecraft, invoca "consultar_estado_servidor".`;
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
      } else {
        resultadoTool = 'Función no reconocida.';
      }

      mensajes.push({
        role: 'tool',
        content: resultadoTool,
        toolCallId: llamada.id
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
