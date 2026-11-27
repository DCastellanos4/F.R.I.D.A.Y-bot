/**
 * personalLifeHandlers.js - Manejadores de herramientas de Vida Personal, Hogar, Viajes y Compras.
 *
 * Politica estricta: cero emojis en codigo, comentarios y respuestas.
 */

import { crearRecordatorio, listarRecordatorios, cancelarRecordatorio } from '../../services/reminderService.js';
import { programarMensaje, listarMensajesProgramados, cancelarMensajeProgramado } from '../../services/scheduledMessageService.js';
import { registrarFechaSenalada, eliminarFechaSenalada, proximasFechas, configurarAvisosFechas } from '../../services/specialDatesService.js';
import { programarSnooze, listarSnoozes, cancelarSnooze } from '../../services/snoozeService.js';
import { registrarAvisoLlegada, listarAvisosLlegada, cancelarAvisoLlegada } from '../../services/arrivalWatchService.js';
import { registrarParadaFavorita, listarParadasFavoritas, eliminarParadaFavorita, proximasLlegadas, extraerDestinoHacia, extraerOrigenDesde } from '../../services/transportService.js';
import { escribirDiario, leerDiario } from '../../services/diaryService.js';
import { registrarHabito, marcarHabito, listarHabitos } from '../../services/habitsService.js';
import { ponerMenu, verMenu, sugerirMenu } from '../../services/menuService.js';
import { anadirCompra, listarCompra, tacharCompra, vaciarCompra } from '../../services/shoppingService.js';
import { recomendarSeriePelicula } from '../../services/recommenderService.js';
import { crearQuedada, listarQuedadas, redactarInvitacion } from '../../services/quedadasService.js';
import { resumenDeportivo } from '../../services/sportsService.js';
import { configurarModoNocturno } from '../../services/quietHoursService.js';
import { encenderPc, listarDispositivosRed, configurarVigilanciaRed, controlarDomotica, estadoDescargas, configurarAvisoDescargas, estimarFacturaOracle } from '../../services/hogarService.js';
import { vigilarRuta, listarRutasVigiladas, cancelarVigilanciaRuta, registrarPrecioRuta } from '../../services/viajesService.js';
import { vigilarProducto, listarProductosVigilados, cancelarVigilancia } from '../../monitors/sniperService.js';
import { buscarProducto, verificarOferta } from '../../services/productSearchService.js';

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

export function crearManejadoresVidaPersonal() {
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
