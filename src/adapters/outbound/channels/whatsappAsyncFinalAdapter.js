/** Final async WhatsApp answer. An ambiguous voice send NEVER falls back to text. */
import {crearWhatsAppChannelAdapter} from './whatsappChannelAdapter.js';
export function crearCanalFinalWhatsapp({sock,normalizar,sintetizar,enviarVoz,registrarIntercambio,condensar}={}){
 const canal=crearWhatsAppChannelAdapter(sock);
 return Object.freeze({canal:'whatsapp',async enviarTexto(destinatario,texto,{contextoEntrega={}}={}){
  const respuesta=normalizar(texto);
  if(!sock.user){const e=new Error('RF01_WHATSAPP_NOT_READY');e.esFalloPreEnvioVerificado=true;throw e;}
  let audio=null;
  if(contextoEntrega.voz===true){try{audio=await sintetizar(respuesta,{voice:'es-ES-AlvaroNeural'});}catch{/* Synthesis is pre-send: safe text fallback. */}}
  // Do not catch a provider send and then send another message. Any reject
  // after this boundary stays uncertain under the existing deliverer policy.
  if(audio)await enviarVoz(sock,destinatario,audio);
  else await canal.enviarTexto(destinatario,respuesta);
  // History bookkeeping cannot turn an already resolved send into a retry.
  try{registrarIntercambio(destinatario,contextoEntrega.textoUsuario||'',respuesta);condensar?.(destinatario);}catch{}
 }});
}
