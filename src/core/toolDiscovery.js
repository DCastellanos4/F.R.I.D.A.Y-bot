// Descubrimiento local, sin embeddings ni llamadas auxiliares. Recibir un
// esquema no concede permisos: el ejecutor conserva RBAC/OTP/confirmaciones.
export const NOMBRE_DESCUBRIR = 'descubrir_herramientas';
export const HERRAMIENTA_DESCUBRIR = Object.freeze({
  type: 'function', function: {
    name: NOMBRE_DESCUBRIR,
    description: 'Busca y carga esquemas de herramientas que faltan para la peticion. No ejecuta acciones. Si una herramienta necesaria no esta ofrecida, buscala antes de afirmar que no existe. Puedes pedir nombres exactos o describir la tarea. Para preguntas sobre tus funciones o altas pendientes, recupera contexto capacidades o configuracion antes de responder.',
    parameters: { type: 'object', properties: {
      consulta: { type: 'string', description: 'Tarea que necesitas realizar.' },
      contexto: { type: 'string', enum: ['capacidades', 'configuracion'], description: 'Recupera el inventario real del asistente o sus integraciones pendientes, sin ejecutar acciones.' },
      nombres: { type: 'array', items: { type: 'string' }, maxItems: 8, description: 'Nombres exactos opcionales de las herramientas a cargar.' }
    }, required: ['consulta'], additionalProperties: false }
  }
});
const normalizar = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const palabras = s => normalizar(s).split(/[^a-z0-9]+/).filter(p => p.length > 3 && !['para', 'como', 'quiero', 'puedes', 'necesito', 'david', 'esta', 'este', 'cuando'].includes(p));

// Falla 14 nov 2026 (2a): el modelo pedia «enviar la probabilidad de lluvia
// a paula por whatsapp» y la tool de envio puntuaba 1 (< umbral 2): «enviar»
// nunca casa con «envia»/«envie» de la descripcion por subcadena exacta.
// Raiz ligera por desinencia verbal/nominal española (enviar~envia~envio,
// mandar~manda, programar~programa) con minimo de 4 letras para no confundir
// lexemas distintos («recorrido» NO debe casar con «recordatorio»).
// Es un comparador de relevancia, no un stemmer linguistico; el umbral de
// buscarEsquemasRelevantes sigue filtrando el ruido.
const raizDe = p => {
  const w = String(p || '');
  const m = w.match(/^(.+?)(ando|iendo|aron|aran|aste|aria|ado|ido|ar|er|ir|an|en|as|es|a|e|o|s)?$/);
  return m && m[1].length >= 4 ? m[1] : w;
};
const mismaRaiz = (a, b) => a === b || a.startsWith(b) || b.startsWith(a);

// Verbos de accion discriminativos: cuando el modelo pide «mandar la
// probabilidad de lluvia a paula» el unico termino que casa es el verbo;
// un sustantivo suelto es mucho menos indicativo que un verbo de accion.
// Pesan doble para que una sola coincidencia verbal supere el umbral sin
// abrir la puerta a preguntas genericas («que sabes hacer» no los usa).
const VERBOS_ACCION = new Set(['enviar', 'mandar', 'escribir', 'remitir', 'programar', 'registrar', 'guardar', 'borrar', 'eliminar', 'cancelar', 'crear']);

function puntuar(catalogo, { consulta = '', nombres = [] } = {}) {
  const pedidos = new Set(Array.isArray(nombres) ? nombres.filter(n => typeof n === 'string') : []);
  const terminos = palabras(consulta);
  return catalogo.map((h, i) => {
    const nombre = h.function.name;
    const texto = normalizar(`${nombre.replaceAll('_', ' ')} ${h.function.description}`);
    const raicesTexto = palabras(texto).map(raizDe);
    const score = pedidos.has(nombre) ? 10000 : terminos.reduce((s, t) => {
      const peso = VERBOS_ACCION.has(t) ? 2 : 1;
      if (texto.includes(t)) return s + peso;
      const raiz = raizDe(t);
      return s + (raicesTexto.some(r => mismaRaiz(r, raiz)) ? peso : 0);
    }, 0);
    return { h, score, i };
  }).filter(r => r.score > 0).sort((a, b) => b.score - a.score || a.i - b.i);
}

export function buscarEsquemas(catalogo, { consulta = '', nombres = [] } = {}, maximo = 8) {
  return puntuar(catalogo, { consulta, nombres }).slice(0, maximo).map(r => r.h);
}

// Falla 14 nov 2026: con contexto "capacidades" el modelo pedia la tool de
// envio de WhatsApp y solo recibia el inventario fijo, asi que concluia que
// no existia. Esta variante exige un encaje minimo (2 terminos, o nombre
// exacto pedido) para no ensuciar preguntas genericas de capacidades con
// esquemas irrelevantes.
export function buscarEsquemasRelevantes(catalogo, { consulta = '', nombres = [] } = {}, { maximo = 8, puntuacionMinima = 2 } = {}) {
  return puntuar(catalogo, { consulta, nombres }).filter(r => r.score >= puntuacionMinima).slice(0, maximo).map(r => r.h);
}
export function prepararHerramientasProgresivas(seleccion, consulta, maximo = 12) {
  if (seleccion.length <= maximo) return [...seleccion];
  const relevantes = buscarEsquemas(seleccion, { consulta }, maximo);
  const nombres = new Set(relevantes.map(h => h.function.name));
  return [...relevantes, ...seleccion.filter(h => !nombres.has(h.function.name))].slice(0, maximo);
}
