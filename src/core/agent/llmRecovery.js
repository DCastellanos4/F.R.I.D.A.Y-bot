/**
 * Recuperacion ante errores 400 de validacion de herramientas y tool_choice=none.
 * Politica estricta: cero emojis.
 */

export function esError400ValidacionHerramientas(err) {
  const txt = String((err && err.message) || err || '');
  return /\b400\b/.test(txt) && /tool.?call validation|did not match schema/i.test(txt);
}

// Groq/gpt-oss: peticion sin herramientas (clasificada como conversacional)
// y el modelo emite igualmente una llamada a herramienta -> 400 "Tool choice
// is none, but model called a tool". El provider rechaza antes de ejecutar
// nada, asi que reintentar es seguro. El reintento va sin herramientas y con
// una instruccion de solo texto; no se ofrecen herramientas que el
// clasificador (o los permisos del tenant) dejaron fuera.
export function esError400ToolChoiceNone(err) {
  const txt = String((err && err.message) || err || '');
  return /\b400\b/.test(txt) && /tool choice is none/i.test(txt);
}

// Un 400 de validacion de tool-call significa que el provider RECHAZO la
// peticion antes de ejecutar nada: reintentar es seguro (no hay efectos que
// duplicar). Un unico reintento con pista de esquema; si el provider vuelve
// a rechazar, una ultima llamada degradada SIN herramientas para no dejar a
// David sin respuesta. Nunca se reintentan 2xx ambiguos ni timeouts
// posteriores a una posible ejecucion.
export async function chatConRecuperacion400(chatImpl, peticion, etiqueta) {
  try {
    return await chatImpl(peticion);
  } catch (err) {
    if (esError400ToolChoiceNone(err)) {
      console.warn(`[J.A.R.V.I.S.] 400 tool choice none en ${etiqueta}: el modelo intento llamar a una herramienta no ofrecida; 1 reintento solo texto.`);
      const soloTexto = {
        role: 'system',
        content: 'En este turno no hay herramientas disponibles: NO invoques ninguna. Responde solo con texto. Si la peticion exige una accion (guardar, enviar, programar, etc.), di con claridad que no la has realizado y que puede reintentarse; nunca afirmes haberla hecho.'
      };
      try {
        return await chatImpl({ ...peticion, tools: undefined, messages: [...peticion.messages, soloTexto] });
      } catch (errTc) {
        if (!esError400ToolChoiceNone(errTc) && !esError400ValidacionHerramientas(errTc)) throw errTc;
        console.error(`[J.A.R.V.I.S.] El reintento solo texto tambien fallo en ${etiqueta}:`, String((errTc && errTc.message) || errTc).slice(0, 200));
        return { message: { role: 'assistant', content: 'No he podido completar tu peticion, senor: el servicio del modelo ha rechazado la consulta y NO se ha realizado ninguna accion. Puedes reintentarlo en unos minutos.' } };
      }
    }
    if (!esError400ValidacionHerramientas(err)) throw err;
    console.warn(`[J.A.R.V.I.S.] 400 de validacion de tool-call en ${etiqueta}: ${err?.message || err}; el provider no ejecuto nada, 1 reintento con pista de esquema.`);
    const pista = {
      role: 'system',
      content: `Tu llamada a herramienta anterior fue rechazada por argumentos invalidos (${String((err && err.message) || err).slice(0, 300)}). Si necesitas una herramienta, genera argumentos que cumplan exactamente su esquema (tipos correctos y campos requeridos sin null). Si no tienes datos para argumentos validos, responde en texto pidiendo a David lo que falte, sin llamar a la herramienta.`
    };
    try {
      return await chatImpl({ ...peticion, messages: [...peticion.messages, pista] });
    } catch (err2) {
      if (!esError400ValidacionHerramientas(err2)) throw err2;
      console.warn(`[J.A.R.V.I.S.] Segundo 400 de validacion en ${etiqueta}; respuesta degradada sin herramientas.`);
      const soloTexto = {
        role: 'system',
        content: 'Responde SOLO con texto plano para David: NO invoques ninguna herramienta. Explica que no puedes completar la accion ahora mismo y que NO se ha realizado ninguna accion, e indica el siguiente paso util y concreto (por ejemplo, que te pase el enlace o el dato que falta, o que repita la peticion en unos minutos).'
      };
      try {
        return await chatImpl({ messages: [...peticion.messages, soloTexto], options: peticion.options });
      } catch (err3) {
        // Sin mas llamadas: fallback fijo y honesto (no afirma accion alguna).
        console.error(`[J.A.R.V.I.S.] La degradada tambien fallo en ${etiqueta}:`, String((err3 && err3.message) || err3).slice(0, 200));
        return { message: { role: 'assistant', content: 'No he podido completar tu peticion, senor: el servicio del modelo ha rechazado la consulta y NO se ha realizado ninguna accion. Puedes reintentarlo en unos minutos.' } };
      }
    }
  }
}
