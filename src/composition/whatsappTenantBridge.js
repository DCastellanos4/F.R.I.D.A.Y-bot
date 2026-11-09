/** Puente de chats directos tenant desde el evento Baileys del socket propio.
 * No autentica JSON recibido de HTTP ni claims de texto/metadata. Su llamador
 * es exclusivamente el listener messages.upsert de Baileys tras su sesion.
 * JID/LID exacto registrado, sin aliases inferidos ni alta automatica.
 */
import { crearInboundDesdeWhatsApp } from '../adapters/inbound/whatsapp/whatsappInboundAdapter.js';
import { crearWhatsAppChannelAdapter } from '../adapters/outbound/channels/whatsappChannelAdapter.js';
import { crearAccesoTenants } from './tenantAccess.js';
import { crearMessageProcessor } from '../core/messageProcessor.js';
import { tenantsHabilitados } from '../core/tenancy.js';
import { normalizarMarkdownWhatsApp } from '../services/textFormatService.js';

export function crearPuenteWhatsAppTenants({ tenantRepository, limitesStore, llmProvider, esPropietario } = {}) {
  if (!tenantRepository || !limitesStore || typeof esPropietario !== 'function') throw new TypeError('Puente WhatsApp requiere repositorios y comprobacion owner.');
  // La identidad verificada se liga al objeto inbound creado AQUI; copiar sus
  // campos o metadata no concede identidad. No se exporta el autenticador.
  const identidades = new WeakMap();
  const acceso = crearAccesoTenants({ tenantRepository, limitesStore,
    autenticar: (inbound) => identidades.get(inbound) || null,
    esPropietario: () => false // owner nunca entra en este carril
  });
  const processor = crearMessageProcessor({ accesoTenants: acceso, llmProvider });

  async function procesar(sock, msg, ensayo = false) {
    if (!ensayo && !tenantsHabilitados()) return { gestionado: false };
    const jid = msg?.key?.remoteJid;
    if (typeof jid !== 'string' || !/^[0-9]+@(s\.whatsapp\.net|lid)$/.test(jid)
        || msg?.key?.fromMe !== false || msg.key.participant || esPropietario(jid)) return { gestionado: false };
    let tid;
    let registrada;
    try {
      registrada = tenantRepository.identidadRegistrada('whatsapp',jid);
      tid = tenantRepository.buscar('whatsapp',jid);
    } catch { return { gestionado: true }; } // no reenviar posibles datos de tenant si BD falla
    if (!registrada) return { gestionado: false };
    if (!tid || tid === 'propietario') return { gestionado: true }; // suspendido no cae al buzon owner
    // Una identidad registrada tiene carril propio aunque el payload no sea
    // texto soportado: nunca cae en handlers/buzon/automatismos del owner.
    const handled = { gestionado: true };
    const m = msg.message;
    const texto = typeof m?.conversation === 'string' ? m.conversation.trim()
      : typeof m?.extendedTextMessage?.text === 'string' ? m.extendedTextMessage.text.trim() : null;
    if (!texto) return handled; // primera version: solo texto, sin audio/media/grupos
    const inbound = crearInboundDesdeWhatsApp({ msg, texto, remoteJid: jid });
    identidades.set(inbound,Object.freeze({canal:'whatsapp',identificador:jid}));
    let respuesta;
    try {
      respuesta = await (ensayo ? processor.procesarMensajeEnAmbito : processor.procesarMensajeEntrante)(inbound, { historial: [] });
    } catch {
      // Nunca exponer al tenant errores con detalles de proveedor/host.
      respuesta = 'No he podido completar la consulta ahora mismo.';
    } finally { identidades.delete(inbound); }
    // Revalidacion posterior a la espera. No enviar datos si la identidad fue
    // revocada/reasignada ni si se cerro el gate. No es una transaccion con red.
    if (!ensayo && !tenantsHabilitados()) return handled;
    try { if (tenantRepository.buscar('whatsapp',jid) !== tid) return handled; } catch { return handled; }
    if (typeof respuesta !== 'string' || !respuesta.trim()) return handled;
    try {
      await crearWhatsAppChannelAdapter(sock).enviarTexto(jid,normalizarMarkdownWhatsApp(respuesta));
    } catch {
      // No reenviar al owner ni cambiar destino cuando falla la respuesta.
      console.error('[WhatsApp Tenant] No se pudo entregar la respuesta al chat de origen.');
    }
    return handled;
  }
  return Object.freeze({
    procesar: (sock,msg) => procesar(sock,msg,false),
    // Solo ensayo interno igual que consultarJarvisEnAmbito: no instalado en
    // listener/API, no interruptor de entorno ni parametro de mensaje.
    procesarEnAmbito: (sock,msg) => procesar(sock,msg,true)
  });
}
