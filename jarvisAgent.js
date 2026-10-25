import { config } from './config.js';
import { chatCompletion, getLlmProviderInfo } from './llmService.js';
import { herramientasJarvis } from './tools.js';
import { obtenerNoticiasEstructuradas } from './newsService.js';
import {
  crearRecordatorio,
  listarRecordatorios,
  cancelarRecordatorio
} from './reminderService.js';
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

/**
 * Detecta si David pide poner más tabaco a la cachimba (Easter Egg Tony Stark)
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
 * Enrutador de herramientas de alta precisión (Dynamic Tool Pruning):
 * Inyecta las herramientas requeridas según la intención de David.
 */
export function seleccionarHerramientasPorIntencion(mensaje) {
  const norm = normalizarTexto(mensaje);
  const sinNombre = norm.replace(/\b(friday|viernes|jarvis)\b/gi, '').replace(/\s+/g, ' ').trim();
  const tieneUrl = /(https?:\/\/[^\s]+)/i.test(mensaje);

  // Detección de charla puramente conversacional
  const tieneChitChat = /(hola|ey|hey|buenas|buenos dias|buenas tardes|buenas noches|que tal|como estas|como va|quien eres|que eres|que sabes hacer|que puedes hacer|gracias|muchas gracias|de nada|ok|vale|entendido|perfecto|genial|adios|hasta luego|chao|hasta pronto)/i.test(sinNombre);

  // Casos especiales de memoria:
  const esRecuerdaQueDato = /(recuerda que|apunta que|guarda que|anota que|no te olvides de que|apunta:|a partir de ahora|desde ahora)/i.test(sinNombre) && 
                            !/(a las \d+|en \d+\s*(min|hora)|manana)/i.test(sinNombre);

  const esClaveAlarma = /(codigo|clave|contrasena|pin)\s+(de\s+la\s+)?alarma/i.test(sinNombre);

  const intents = {
    // Clima y meteorología
    clima: /(tiempo|clima|meteorolog|temperatura|lluvia|llover|paraguas|frio|calor|sol|grados|prevision|que tiempo|va a llover|hara sol|hara frio|hara calor)/i,

    // Second Brain (Memoria personal permanente)
    esHechoMemoria: /(recuerda que|apunta que|guarda que|anota que|no te olvides de que|apunta:|a partir de ahora|desde ahora|mi hermano|mi hermana|mi madre|mi padre|mi mama|mi papa|mi amigo|mi amiga|mi novia|mi novio|mi mujer|mi marido|mi hijo|mi hija|calza|talla|numero de pie|pie|zapatillas?|zapatos?|cumpleanos|cumple|clave|contrasena|password|pin|codigo|wifi|correo|email|mail|direccion|vive en|trabaja en|le gusta|favorit[ao]|preferencia|segunda memoria|segundo cerebro|que sabes de|que calza|que talla|cuando es el cumple|cual es la clave|cual es el wifi|cual es el codigo|cual es mi correo|cual es mi email|mis recuerdos|banco de memoria|olvida que|borra de tu memoria|elimina de tu memoria)/i,
    
    // Recordatorios, avisos y alarmas temporales
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
  let matchRecordatorio = (intents.esRecordatorio.test(sinNombre) && !esClaveAlarma && !esRecuerdaQueDato);
  let matchSniper = intents.sniper.test(sinNombre);
  let matchNoticias = intents.noticias.test(sinNombre);
  let matchNavegacion = intents.navegacion.test(sinNombre) || tieneUrl;
  let matchServidor = intents.servidor.test(sinNombre);

  // Si tiene saludo o agradecimiento y no pide ninguna acción: 0 herramientas (1.2s de respuesta)
  if (tieneChitChat && !matchClima && !matchRecordatorio && !matchMemoria && !matchSniper && !matchNoticias && !matchNavegacion && !matchServidor) {
    return [];
  }

  const tools = [];

  if (matchClima) {
    tools.push(...herramientasJarvis.filter(h => h.function.name === 'consultar_clima'));
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

  // Safety Net: si no encajó en ninguna categoría pero tampoco es chit-chat,
  // PASAMOS TODAS LAS HERRAMIENTAS para no fallar jamás.
  if (tools.length === 0) {
    console.log(`🛡️ [Router Safety Net] Mensaje de intención ambigua: "${norm}". Pasando todas las herramientas.`);
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
    console.log(`⚡ [FRIDAY] Detección directa de lectura/resumen con Playwright para: ${urlMatch[0]}`);
    return await generarResumenInteligente(urlMatch[0]);
  }

  // Easter Egg: Solicitud de más tabaco para la cachimba
  if (esPeticionCachimba(mensajeUsuario)) {
    console.log(`🎯 [FRIDAY Easter Egg] Cachimba detectada: "${mensajeUsuario}"`);
    return 'A la orden, jefe. Calibrando cazoleta y aumentando la mezcla al 100%. Protocolo Stark activado.';
  }

  // Búsqueda proactiva en el Second Brain para inyectar recuerdos en contexto
  const memoriasProactivas = buscarMemorias(mensajeUsuario);

  // Selección inteligente de herramientas
  const herramientasActivas = seleccionarHerramientasPorIntencion(mensajeUsuario);

  console.log(`🤖 [FRIDAY] Evaluando: "${mensajeUsuario}" [Herramientas: ${herramientasActivas.length > 0 ? herramientasActivas.map(h => h.function.name).join(', ') : 'Ninguna (Conversacional Ultra-Rápido)'}]`);

  let systemPrompt = `Eres FRIDAY (F.R.I.D.A.Y.), la sofisticada inteligencia artificial táctica y asistente personal de David, al más puro estilo de la IA de Tony Stark en Iron Man.
Tu personalidad es impecable: inteligente, sagaz, eficiente, con clase y un toque sutilmente ingenioso de película de superhéroes. Tratas a David por su nombre o como "jefe" con naturalidad.
Responde siempre en español con elegancia, rapidez y concisión absoluta, sin párrafos de relleno innecesarios.`;

  // Inyección de recuerdos existentes en el prompt para respuesta instantánea y precisa
  if (memoriasProactivas.length > 0) {
    systemPrompt += `\n\n[DATOS RECORDADOS EN TU SECOND BRAIN (BANCO DE INFORMACIÓN PERSONAL)]:
${memoriasProactivas.map(m => `- [${m.sujeto.toUpperCase()}]: ${m.dato}`).join('\n')}
(DIRECTIVA OBLIGATORIA: Si la pregunta de David trata sobre alguno de estos temas, respóndele DIRECTAMENTE con esta información de forma concisa y elegante).`;
  }

  if (herramientasActivas.length > 0) {
    systemPrompt += `\nTIENES HERRAMIENTAS ACTIVAS Y ES OBLIGATORIO INVOCARLAS SI SE PIDE UNA ACCIÓN:
1. CLIMA Y METEOROLOGÍA:
   - Si David pregunta por el tiempo, temperatura, previsión, lluvia o paraguas en cualquier ciudad o lugar (ej: "¿qué tiempo hace en Madrid?", "¿va a llover mañana en Barcelona?"), INVOCA OBLIGATORIAMENTE "consultar_clima".
2. RECORDATORIOS Y ALARMAS:
   - Si David te pide recordarle algo, avisarle, poner una alarma o dice "recuerda...", "recuérdame...", "acuérdate de...", INVOCA OBLIGATORIAMENTE "crear_recordatorio".
   - Si pregunta por sus tareas o avisos pendientes, INVOCA "listar_recordatorios".
   - Si pide borrar o cancelar un recordatorio, INVOCA "cancelar_recordatorio".
3. SECOND BRAIN (BANCO DE INFORMACIÓN PERSONAL):
   - Si David te da un dato personal para recordar (ej: "a partir de ahora mi correo es...", "recuerda que el código de la alarma es...", "mi hermano calza un 43", cumpleaños, wifi, claves), INVOCA OBLIGATORIAMENTE "guardar_memoria".
   - Si David te pregunta por un recuerdo pasado o dato guardado (ej: "¿cuál es mi correo?", "¿cuál es el código?"), INVOCA "buscar_memoria" o respóndele con los datos del Second Brain inyectados arriba.
   - Si David pide listar todo lo que sabes o recuerdas, INVOCA "listar_memorias".
   - Si David pide olvidar o borrar un dato o todos, INVOCA "olvidar_memoria".
4. SNIPER DE PRECIOS (ITEM TRACKER):
   - Si pasa un enlace o pide vigilar un producto si baja de precio, o actualizar su precio objetivo, INVOCA "vigilar_producto".
   - Si pregunta qué artículos vigilas, cómo va el tracker o el seguimiento de ofertas, INVOCA "listar_productos_vigilados".
   - Si pide cancelar el rastreo de un artículo, INVOCA "cancelar_vigilancia".
5. NOTICIAS Y NAVEGADOR PLAYWRIGHT:
   - Si pide noticias de hoy o de última hora, INVOCA "obtener_noticias_actuales".
   - Si David te proporciona una URL o te pide abrir, leer o inspeccionar en profundidad una noticia o web, INVOCA OBLIGATORIAMENTE "navegar_y_leer_noticia" o "resumir_enlace".
6. ESTADO SERVIDOR: Si pregunta por RAM, CPU o Minecraft, INVOCA "consultar_estado_servidor".`;
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
      num_ctx: 2048,
      temperature: 0.1,
      num_thread: 4
    }
  });

  // Si el modelo decide ejecutar herramientas
  if (respuesta.message.tool_calls && respuesta.message.tool_calls.length > 0) {
    mensajes.push(respuesta.message);
    let enlacesParaAdjuntar = [];

    for (const llamada of respuesta.message.tool_calls) {
      const nombreFuncion = llamada.function.name;
      let args = llamada.function.arguments || {};
      if (typeof args === 'string') {
        try { args = JSON.parse(args); } catch { args = {}; }
      }
      const toolCallId = llamada.id || `call_${Date.now()}`;
      console.log(`⚙️ [FRIDAY Tool Call] Invocando: ${nombreFuncion} con argumentos:`, args);

      let resultadoTool = '';

      if (nombreFuncion === 'consultar_clima') {
        const res = await consultarClima({
          ubicacion: args.ubicacion || config.weather.defaultCity,
          momento: args.momento || 'hoy'
        });
        if (res.ok) {
          resultadoTool = res.resumen;
        } else {
          resultadoTool = `Error al consultar el clima: ${res.error}`;
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
          resultadoTool = `No encontré ningún recuerdo previo sobre "${args.consulta}" en el Second Brain.`;
        } else {
          resultadoTool = `Recuerdos recuperados del Second Brain:\n` + memorias.map(m => `- [${m.sujeto.toUpperCase()}]: ${m.dato} (Registrado: ${m.fechaLocal})`).join('\n');
        }
      } else if (nombreFuncion === 'listar_memorias') {
        const memorias = listarMemorias(args.categoria);
        if (memorias.length === 0) {
          resultadoTool = 'Actualmente no hay ningún dato guardado en el Second Brain.';
        } else {
          resultadoTool = `Recuerdos almacenados en el Second Brain (${memorias.length}):\n` + memorias.map((m, i) => `${i + 1}. [${m.sujeto.toUpperCase()}]: ${m.dato}`).join('\n');
        }
      } else if (nombreFuncion === 'olvidar_memoria') {
        const res = olvidarMemoria(args.criterio);
        resultadoTool = res.mensaje || res.error || 'Operación completada.';
      } else if (nombreFuncion === 'vigilar_producto') {
        const res = await vigilarProducto({
          url: args.url,
          nombre: args.nombre,
          precioObjetivo: args.precioObjetivo
        });
        if (res.ok) {
          resultadoTool = res.mensaje || `Producto añadido al Tracker (Sniper) con éxito. Nombre: "${res.item.nombre}". Precio actual detectado: ${res.item.precioActual}€. Alerta fijada si baja a: ${res.item.precioObjetivo}€.`;
        } else {
          resultadoTool = `Error al añadir al Sniper: ${res.error}`;
        }
      } else if (nombreFuncion === 'listar_productos_vigilados') {
        const lista = listarProductosVigilados();
        if (lista.length === 0) {
          resultadoTool = 'Actualmente el Item Tracker no tiene ningún producto en vigilancia activa.';
        } else {
          resultadoTool = 'Artículos en seguimiento activo del Item Tracker (Sniper):\n' + lista.map((item, i) => `${i + 1}. [${item.nombre}] - Precio actual: ${item.precioActual}€ -> Meta: ${item.precioObjetivo}€\n   🔗 ${item.url}`).join('\n');
        }
      } else if (nombreFuncion === 'cancelar_vigilancia') {
        const res = cancelarVigilancia(args.criterio);
        if (res.ok) {
          resultadoTool = res.mensaje || (res.item ? `Vigilancia cancelada para: "${res.item.nombre}".` : 'Vigilancia cancelada con éxito.');
        } else {
          resultadoTool = res.error || 'Error al cancelar la vigilancia.';
        }
      } else if (nombreFuncion === 'navegar_y_leer_noticia') {
        const resNav = await navegarYExtraerArticulo(args.url);
        if (resNav.ok) {
          resultadoTool = `Artículo web leído en vivo con Chromium (Playwright):\n` +
            `Título: ${resNav.titulo}\n` +
            `URL: ${resNav.url}\n` +
            `Autor: ${resNav.autor || 'Redacción'}\n` +
            `Fecha: ${resNav.fecha || 'Reciente'}\n` +
            `Texto íntegro verificado extraído del artículo:\n${resNav.contenido}`;
        } else {
          resultadoTool = `No se pudo leer la página con el navegador Playwright: ${resNav.error}`;
        }
      } else if (nombreFuncion === 'resumir_enlace') {
        return await generarResumenInteligente(args.url);
      } else if (nombreFuncion === 'obtener_noticias_actuales') {
        const cat = args.categoria || 'general';
        const data = await obtenerNoticiasEstructuradas(cat, 5);

        if (data.ok && data.articulos.length > 0) {
          enlacesParaAdjuntar = data.articulos;
          const textoParaJarvis = data.articulos.map(a => `${a.id}. Titular: ${a.titulo}\nDetalle: ${a.resumen}`).join('\n\n');
          resultadoTool = `Noticias reales recuperadas (${data.ramaNombre}):\n${textoParaJarvis}`;
        } else {
          resultadoTool = 'No se pudieron recuperar noticias en este momento.';
        }
      } else if (nombreFuncion === 'crear_recordatorio') {
        const res = crearRecordatorio({
          mensaje: args.mensaje,
          minutosEnElFuturo: args.minutosEnElFuturo,
          hora: args.hora
        });
        resultadoTool = `Recordatorio guardado correctamente en el sistema. ID: ${res.recordatorio.id}. Programado para: ${res.recordatorio.fechaHoraLocal}. Tarea: "${res.recordatorio.mensaje}".`;
      } else if (nombreFuncion === 'listar_recordatorios') {
        const lista = listarRecordatorios();
        if (lista.length === 0) {
          resultadoTool = 'No hay ningún recordatorio pendiente en el sistema.';
        } else {
          resultadoTool = 'Recordatorios pendientes:\n' + lista.map((r, i) => `${i + 1}. [${r.fechaHoraLocal}] "${r.mensaje}" (ID: ${r.id})`).join('\n');
        }
      } else if (nombreFuncion === 'cancelar_recordatorio') {
        const res = cancelarRecordatorio(args.criterio);
        if (res.ok) {
          resultadoTool = res.mensaje || (res.recordatorio ? `Recordatorio cancelado con éxito: "${res.recordatorio.mensaje}".` : 'Recordatorio cancelado con éxito.');
        } else {
          resultadoTool = res.mensaje || 'Error al cancelar el recordatorio.';
        }
      } else if (nombreFuncion === 'consultar_estado_servidor') {
        const salud = consultarSaludServidor();
        const mcOnline = await comprobarPuertoTCP(config.minecraft.host, config.minecraft.port, 2000);
        resultadoTool = `Salud del sistema:\n- RAM: ${salud.libreRamGB} GB libres de ${salud.totalRamGB} GB (${salud.porcentajeUso}% en uso)\n- CPUs: ${salud.cpus} núcleos (Carga media: ${salud.loadAvg})\n- Servidor de Minecraft (${config.minecraft.host}:${config.minecraft.port}): ${mcOnline ? 'ONLINE' : 'CAIDO / APAGADO'}`;
      } else {
        resultadoTool = 'Función no reconocida.';
      }

      mensajes.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: resultadoTool
      });
    }

    console.log(`💬 [FRIDAY] Sintetizando respuesta final...`);
    const respuestaFinal = await chatCompletion({
      messages: mensajes,
      options: {
        num_ctx: 2048,
        max_tokens: 300,
        temperature: 0.2,
        num_thread: 4
      }
    });

    let textoFinal = (respuestaFinal.message.content || '').trim();

    if (enlacesParaAdjuntar.length > 0) {
      textoFinal += '\n\n═════════════════════\n📰 *Enlaces para leer completas:*';
      for (const art of enlacesParaAdjuntar) {
        textoFinal += `\n*${art.id}.* ${art.titulo}\n   🔗 ${art.link}\n`;
      }
    }

    const duracionSeg = ((Date.now() - tiempoInicio) / 1000).toFixed(2);
    console.log(`⏱️ [FRIDAY] Petición con herramienta completada en ${duracionSeg}s`);
    return textoFinal;
  }

  const duracionSeg = ((Date.now() - tiempoInicio) / 1000).toFixed(2);
  console.log(`⏱️ [FRIDAY] Petición conversacional completada en ${duracionSeg}s`);
  return respuesta.message.content || '';
}
