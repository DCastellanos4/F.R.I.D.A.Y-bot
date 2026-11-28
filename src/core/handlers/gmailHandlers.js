/**
 * gmailHandlers.js - Manejadores de herramientas del dominio Gmail.
 *
 * Politica estricta: cero emojis en codigo, comentarios y respuestas.
 */

import { listarCorreosRecientes, leerCorreo, resumirCorreosUrgentes, crearBorradorCorreo } from '../../services/gmailService.js';
import { obtenerRefreshTokenTenant, PROVIDERS_GOOGLE } from '../../services/tenantOAuthService.js';

function depsGmailDe(opciones = {}) {
  let refreshToken = opciones.googleGmailRefreshToken;
  if (refreshToken === undefined && opciones.tenantId) {
    refreshToken = obtenerRefreshTokenTenant(
      { tenantId: opciones.tenantId, provider: PROVIDERS_GOOGLE.gmail },
      { store: opciones.oauthTokenStore, dataDir: opciones.dataDirOAuth, encryptionKey: opciones.oauthEncryptionKey }
    ) || undefined;
  }
  return {
    fetchFn: opciones.fetchFnGmail,
    ...(refreshToken ? { refreshToken } : {})
  };
}

export function crearManejadoresGmail() {
  return {
    listar_correos: async (args, opciones) => {
      const deps = depsGmailDe(opciones);
      const res = await listarCorreosRecientes({
        query: args.query,
        maxResults: args.maxResults,
        soloNoLeidos: args.soloNoLeidos
      }, deps);
      if (!res.ok) return res.error || 'No se pudieron listar los correos.';
      if (!res.correos || res.correos.length === 0) return 'No hay correos que coincidan con esa busqueda.';
      return 'Correos recientes:\n' + res.correos.map((c) => `- [${c.id}] ${c.from}: ${c.subject} (${c.date})`).join('\n');
    },
    leer_correo: async (args, opciones) => {
      const res = await leerCorreo(args.messageId, depsGmailDe(opciones));
      if (!res.ok) return res.error || 'No se pudo leer el correo.';
      const c = res.correo;
      return `De: ${c.from}\nAsunto: ${c.subject}\nFecha: ${c.date}\n\n${c.body || c.snippet || ''}`;
    },
    resumir_correos_urgentes: async (_args, opciones) => {
      const res = await resumirCorreosUrgentes(depsGmailDe(opciones));
      if (!res.ok) return res.error || 'No se pudieron resumir los correos urgentes.';
      return res.resumen || 'No hay correos urgentes recientes.';
    },
    crear_borrador_correo: async (args, opciones) => {
      const res = await crearBorradorCorreo({
        para: args.para,
        asunto: args.asunto,
        cuerpo: args.cuerpo
      }, depsGmailDe(opciones));
      if (!res.ok) return res.error || 'No se pudo crear el borrador.';
      return `Borrador creado en Gmail (ID: ${res.draftId}) para ${args.para} con asunto "${args.asunto}". No se ha enviado; confirma si quieres enviarlo.`;
    }
  };
}
