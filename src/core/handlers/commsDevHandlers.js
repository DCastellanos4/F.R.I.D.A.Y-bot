/**
 * commsDevHandlers.js - Manejadores de herramientas de Comunicacion, Web, Desarrollo y Skills.
 *
 * Politica estricta: cero emojis en codigo, comentarios y respuestas.
 */

import { config } from '../../config/config.js';
import { consultarClima } from '../../services/weatherService.js';
import { navegarYExtraerArticulo } from '../../services/browserService.js';
import { generarResumenInteligente } from '../../services/summarizerService.js';
import { obtenerNoticiasEstructuradas } from '../../services/newsService.js';
import { setVipMode, isVipModeActive, addVipContact, getVipContacts } from '../../services/vipFilterService.js';
import { generateGroupSummary } from '../../services/groupSummarizerService.js';
import { downloadMedia } from '../../services/mediaDownloaderService.js';
import { activarTraductor, desactivarTraductor } from '../../services/translatorModeService.js';
import { buscarEnHistorial } from '../../services/historySearchService.js';
import { estadisticasChat } from '../../services/groupStatsService.js';
import { anotarIdea, listarIdeas, priorizarIdeas, generarEntradaChangelog, guiarDepuracion, revisarPullRequest } from '../../services/devToolsService.js';
import { crearRamaTrabajo, crearCommit, abrirPullRequest, empujarRama, ejecutarTareaProgramacion } from '../../services/githubAgentService.js';
import { consultarCuotaTexto, procesarUpgradePlan } from '../../services/tenantSelfService.js';
import { proponerSkill, listarSkills, ejecutarSkill } from '../../services/skillsService.js';

export function crearManejadoresComunicacionYDev() {
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
