// Descubrimiento local, sin embeddings ni llamadas auxiliares. Recibir un
// esquema no concede permisos: el ejecutor conserva RBAC/OTP/confirmaciones.
export const NOMBRE_DESCUBRIR = 'descubrir_herramientas';
export const HERRAMIENTA_DESCUBRIR = Object.freeze({
  type: 'function', function: {
    name: NOMBRE_DESCUBRIR,
    description: 'Busca y carga esquemas de herramientas que faltan para la peticion. No ejecuta acciones. Si una herramienta necesaria no esta ofrecida, buscala antes de afirmar que no existe. Puedes pedir nombres exactos o describir la tarea.',
    parameters: { type: 'object', properties: {
      consulta: { type: 'string', description: 'Tarea que necesitas realizar.' },
      nombres: { type: 'array', items: { type: 'string' }, maxItems: 8, description: 'Nombres exactos opcionales de las herramientas a cargar.' }
    }, required: ['consulta'], additionalProperties: false }
  }
});
const normalizar = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const palabras = s => normalizar(s).split(/[^a-z0-9]+/).filter(p => p.length > 3 && !['para', 'como', 'quiero', 'puedes', 'necesito', 'david', 'esta', 'este', 'cuando'].includes(p));
export function buscarEsquemas(catalogo, { consulta = '', nombres = [] } = {}, maximo = 8) {
  const pedidos = new Set(Array.isArray(nombres) ? nombres.filter(n => typeof n === 'string') : []);
  const terminos = palabras(consulta);
  return catalogo.map((h, i) => {
    const nombre = h.function.name;
    const texto = normalizar(`${nombre.replaceAll('_', ' ')} ${h.function.description}`);
    const score = pedidos.has(nombre) ? 10000 : terminos.reduce((s, t) => s + (texto.includes(t) ? 1 : 0), 0);
    return { h, score, i };
  }).filter(r => r.score > 0).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, maximo).map(r => r.h);
}
export function prepararHerramientasProgresivas(seleccion, consulta, maximo = 12) {
  if (seleccion.length <= maximo) return [...seleccion];
  const relevantes = buscarEsquemas(seleccion, { consulta }, maximo);
  const nombres = new Set(relevantes.map(h => h.function.name));
  return [...relevantes, ...seleccion.filter(h => !nombres.has(h.function.name))].slice(0, maximo);
}
