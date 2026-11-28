/**
 * calendarHandlers.js - Manejadores de herramientas del dominio Calendario.
 *
 * Politica estricta: cero emojis en codigo, comentarios y respuestas.
 */

import { consultarEventos, crearEvento, modificarEvento, cancelarEvento } from '../../services/calendarService.js';
import { obtenerRefreshTokenTenant, generarEnlaceGoogleOAuth, estadoConexionGoogleTenant, PROVIDERS_GOOGLE } from '../../services/tenantOAuthService.js';

export function depsCalendarioDe(opciones = {}) {
  let refreshToken = opciones.googleCalendarRefreshToken;
  if (refreshToken === undefined && opciones.tenantId) {
    refreshToken = obtenerRefreshTokenTenant(
      { tenantId: opciones.tenantId, provider: PROVIDERS_GOOGLE.calendar },
      { store: opciones.oauthTokenStore, dataDir: opciones.dataDirOAuth, encryptionKey: opciones.oauthEncryptionKey }
    ) || undefined;
  }
  return {
    rutaArchivo: opciones.rutaArchivoCalendario,
    apiKey: opciones.googleCalendarApiKey,
    accessToken: opciones.googleCalendarToken,
    refreshToken,
    calendarId: opciones.googleCalendarId,
    fetchFn: opciones.fetchFnCalendar
  };
}

export function crearManejadoresCalendario() {
  return {
    conectar_google: (args, opciones) => {
      const tenantId = opciones.tenantId || 'propietario';
      const servicio = args.servicio || 'calendar';
      const estado = estadoConexionGoogleTenant({ tenantId }, {
        store: opciones.oauthTokenStore,
        dataDir: opciones.dataDirOAuth,
        encryptionKey: opciones.oauthEncryptionKey
      });
      const res = generarEnlaceGoogleOAuth({
        tenantId,
        servicio,
        baseUrl: opciones.publicUrlOAuth
      }, {
        clientId: opciones.googleClientId,
        stateSecret: opciones.oauthStateSecret || opciones.oauthEncryptionKey
      });
      if (!res.ok) return res.error || 'No se pudo generar el enlace de conexion de Google.';
      const ya = servicio === 'gmail' ? estado.gmail : (servicio === 'ambos' ? (estado.calendar && estado.gmail) : estado.calendar);
      return `${ya ? 'Ya tienes Google conectado, pero puedes reautorizarlo aqui' : 'Pulsa este enlace para conectar tu Google en 1 clic'} (${res.servicio}):\n${res.url}`;
    },
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
