/**
 * skillsService.js
 * Procedimientos reutilizables ("skills") con aprobacion humana fuera del
 * modelo, adaptacion de la pieza de Hermes aprobada por David el 6 nov 2026
 * (WhatsApp wamid.HBgLMzQ2MzU2MDU2MDUVAgASGBQzQTk4MTU1N0ZFMzA4MjQ3RjI3RgA=
 * "vale pues aplica eso").
 *
 * Una skill es una receta declarativa: nombre, descripcion, parametros y una
 * secuencia de pasos que invocan herramientas YA existentes. Una skill nunca
 * concede permisos: cada paso se ejecuta a traves del ejecutor normal del
 * agente, con las mismas guardas (verificacion de destinatario, 2FA de
 * acciones destructivas, etc.) que si el modelo la hubiera invocado a mano.
 *
 * Aprobacion (mismo patron que destructiveActionService): el modelo puede
 * PROPONER una skill, pero jamas aprobarla. proponer_skill registra una
 * propuesta pendiente ligada al chat exacto y al hash del contenido, con
 * TTL y consumo de un solo uso. Solo un mensaje real de David en ESE chat
 * ("aprobar skill <nombre>" / "rechazar skill <nombre>") cambia el estado,
 * y lo hace whatsappBot directamente, sin pasar por el LLM.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = process.env.DAVIS_DATA_DIR || path.join(process.cwd(), 'data');
const RUTA_SKILLS_DEFECTO = path.join(DATA_DIR, 'skills.json');
export const TTL_APROBACION_MS = 30 * 60 * 1000;

// La capa de procedimientos nunca se crea ni se ejecuta a si misma.
const HERRAMIENTAS_META = new Set(['proponer_skill', 'ejecutar_skill', 'listar_skills']);
const NOMBRE_VALIDO = /^[a-z][a-z0-9_]{2,40}$/;
const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

// pendientes: chatId -> { nombre, hashContenido, creadoEn } (una por chat:
// una propuesta nueva sustituye a la anterior, igual que el borrado 2FA)
const pendientes = new Map();

function rutaSkills(deps = {}) {
  return deps.rutaSkills || RUTA_SKILLS_DEFECTO;
}

function hashContenido(skill) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ nombre: skill.nombre, descripcion: skill.descripcion, parametros: skill.parametros, pasos: skill.pasos }))
    .digest('hex').slice(0, 16);
}

function escrituraPermitida(deps) {
  // En tests nunca se escribe en el data/ real del repo: hace falta ruta
  // inyectada o DAVIS_DATA_DIR temporal (mismo criterio que episodios).
  return !(process.env.NODE_ENV === 'test' && !deps.rutaSkills && !process.env.DAVIS_DATA_DIR);
}

function guardar(data, deps = {}) {
  if (!escrituraPermitida(deps)) return;
  try {
    const ruta = rutaSkills(deps);
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.writeFileSync(ruta, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
  } catch (err) {
    console.error('[Skills] Error guardando:', err.message);
  }
}

/**
 * Skill semilla aprobada por David en el plan del 6 nov: diagnostico de
 * solo lectura (sin efectos). Aprobacion trazable a ese mensaje; cualquier
 * skill NUEVA que proponga el bot sigue necesitando su "aprobar skill ...".
 */
function skillSemillaDiagnostico() {
  const base = {
    id: 'skill_diagnostico_davis',
    nombre: 'diagnostico_davis',
    descripcion: 'Diagnostico de solo lectura: revisa la salud del servidor (RAM, CPU, Minecraft) y el estado de la infraestructura, y explica que falla sin modificar nada.',
    parametros: [],
    pasos: [
      { herramienta: 'consultar_estado_servidor', argumentos: {} },
      { herramienta: 'get_infrastructure_status', argumentos: {} }
    ],
    version: 1,
    estado: 'aprobada',
    origen: 'david (plan de mejora 6 nov 2026)',
    creadoEn: '2026-11-06T00:00:00.000Z',
    aprobadoEn: '2026-11-06T00:00:00.000Z'
  };
  return { ...base, hashContenido: hashContenido(base) };
}

function cargar(deps = {}) {
  const ruta = rutaSkills(deps);
  try {
    const data = JSON.parse(fs.readFileSync(ruta, 'utf-8'));
    if (data && Array.isArray(data.skills)) return data;
  } catch { /* falta o corrupto: se siembra */ }
  const semilla = { skills: [skillSemillaDiagnostico()] };
  guardar(semilla, deps);
  return semilla;
}

export function listarSkills(deps = {}) {
  return cargar(deps).skills.map((s) => ({
    nombre: s.nombre, descripcion: s.descripcion, estado: s.estado, version: s.version,
    parametros: (s.parametros || []).map((p) => p.nombre)
  }));
}

function buscarSkill(data, criterio) {
  const c = String(criterio || '').trim().toLowerCase();
  if (!c) return null;
  return data.skills.find((s) => s.id === criterio || s.nombre.toLowerCase() === c) || null;
}

/**
 * Valida la definicion de una skill contra el catalogo de herramientas
 * conocidas. deps.herramientasConocidas: array de nombres permitidos.
 */
export function validarDefinicion(def, deps = {}) {
  const errores = [];
  const conocidas = new Set(deps.herramientasConocidas || []);
  if (!def || typeof def !== 'object') return { ok: false, errores: ['Definicion vacia.'] };
  if (!NOMBRE_VALIDO.test(def.nombre || '')) errores.push('El nombre debe ser minusculas_con_guiones_bajos (3-41 caracteres).');
  if (!def.descripcion || typeof def.descripcion !== 'string') errores.push('Falta la descripcion.');
  if (!Array.isArray(def.pasos) || def.pasos.length === 0) errores.push('La skill necesita al menos un paso.');
  const parametros = Array.isArray(def.parametros) ? def.parametros : [];
  const nombresParam = new Set();
  for (const p of parametros) {
    if (!p || !NOMBRE_VALIDO.test(p.nombre || '')) errores.push(`Parametro con nombre invalido: ${JSON.stringify(p && p.nombre)}`);
    else nombresParam.add(p.nombre);
  }
  for (const [i, paso] of (def.pasos || []).entries()) {
    if (!paso || typeof paso.herramienta !== 'string') { errores.push(`Paso ${i + 1}: falta la herramienta.`); continue; }
    if (HERRAMIENTAS_META.has(paso.herramienta)) errores.push(`Paso ${i + 1}: "${paso.herramienta}" es de la capa de skills y no puede ser un paso.`);
    else if (conocidas.size > 0 && !conocidas.has(paso.herramienta)) errores.push(`Paso ${i + 1}: herramienta desconocida "${paso.herramienta}".`);
    const args = paso.argumentos || {};
    if (typeof args !== 'object' || Array.isArray(args)) { errores.push(`Paso ${i + 1}: argumentos debe ser un objeto.`); continue; }
    for (const v of Object.values(args)) {
      if (typeof v !== 'string') continue;
      for (const m of v.matchAll(PLACEHOLDER)) {
        if (!nombresParam.has(m[1])) errores.push(`Paso ${i + 1}: el placeholder {{${m[1]}}} no esta declarado como parametro.`);
      }
    }
  }
  return { ok: errores.length === 0, errores };
}

/**
 * El modelo propone una skill: queda en estado pendiente y se registra la
 * aprobacion fuera de banda para ESTE chat. Nunca aprueba por si misma.
 */
export function proponerSkill(def, { chatId } = {}, deps = {}) {
  const validacion = validarDefinicion(def, deps);
  if (!validacion.ok) return { ok: false, error: `Propuesta no valida: ${validacion.errores.join(' ')}` };
  const data = cargar(deps);
  if (buscarSkill(data, def.nombre)) return { ok: false, error: `Ya existe una skill llamada "${def.nombre}". Si quieres cambiarla, rechazala o borrala y proponla de nuevo.` };
  const base = {
    id: `skill_${crypto.randomBytes(4).toString('hex')}`,
    nombre: def.nombre,
    descripcion: def.descripcion,
    parametros: (def.parametros || []).map((p) => ({ nombre: p.nombre, descripcion: p.descripcion || '', requerido: !!p.requerido })),
    pasos: def.pasos.map((p) => ({ herramienta: p.herramienta, argumentos: p.argumentos || {} })),
    version: 1,
    estado: 'pendiente',
    origen: 'agente',
    creadoEn: new Date().toISOString()
  };
  const skill = { ...base, hashContenido: hashContenido(base) };
  data.skills.push(skill);
  guardar(data, deps);
  const ahora = typeof deps.now === 'function' ? deps.now() : Date.now();
  pendientes.set(chatId || 'sin-chat', { nombre: skill.nombre, hashContenido: skill.hashContenido, creadoEn: ahora });
  return { ok: true, skill };
}

/**
 * Resuelve "aprobar skill <nombre>" / "rechazar skill <nombre>" escritos por
 * David directamente en el chat. Devuelve null si el texto no es una
 * confirmacion; si lo es, un objeto con el resultado para whatsappBot.
 */
export function resolverConfirmacionSkill(chatId, texto, deps = {}) {
  const m = /^\s*(aprobar|rechazar)\s+skill\s+([a-z0-9_]+)\s*$/i.exec(String(texto || ''));
  if (!m) return null;
  const accion = m[1].toLowerCase();
  const nombre = m[2].toLowerCase();
  const clave = chatId || 'sin-chat';
  const pend = pendientes.get(clave);
  const ahora = typeof deps.now === 'function' ? deps.now() : Date.now();
  if (!pend || pend.nombre !== nombre) {
    return { confirmado: false, motivo: `No hay ninguna propuesta de skill pendiente con ese nombre en este chat.` };
  }
  if (ahora - pend.creadoEn > TTL_APROBACION_MS) {
    pendientes.delete(clave);
    return { confirmado: false, motivo: 'Esa propuesta caduco (30 minutos). Pide al asistente que la proponga de nuevo.' };
  }
  pendientes.delete(clave); // un solo uso
  const data = cargar(deps);
  const skill = buscarSkill(data, nombre);
  if (!skill || skill.estado !== 'pendiente') {
    return { confirmado: false, motivo: 'Esa propuesta ya no existe o ya fue resuelta.' };
  }
  // La aprobacion esta ligada al contenido exacto propuesto: si la
  // definicion cambiara, el hash ya no coincide y hay que reproponer.
  if (skill.hashContenido !== pend.hashContenido) {
    return { confirmado: false, motivo: 'La definicion cambio desde que se propuso; por seguridad hay que proponerla de nuevo.' };
  }
  skill.estado = accion === 'aprobar' ? 'aprobada' : 'rechazada';
  skill[accion === 'aprobar' ? 'aprobadoEn' : 'rechazadoEn'] = new Date().toISOString();
  guardar(data, deps);
  if (accion === 'aprobar') {
    const params = (skill.parametros || []).map((p) => p.nombre);
    return {
      confirmado: true, tipo: 'aprobada',
      motivo: `Skill "${skill.nombre}" aprobada (v${skill.version}). Puedes ejecutarla cuando quieras${params.length ? ` con parametros: ${params.join(', ')}` : ''}. Sus pasos siguen pasando por las mismas guardas de siempre.`
    };
  }
  return { confirmado: true, tipo: 'rechazada', motivo: `Skill "${skill.nombre}" rechazada; no se podra ejecutar.` };
}

function sustituirPlaceholders(valor, args) {
  if (typeof valor === 'string') {
    return valor.replace(PLACEHOLDER, (_, p) => String(args[p]));
  }
  if (Array.isArray(valor)) return valor.map((v) => sustituirPlaceholders(v, args));
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, sustituirPlaceholders(v, args)]));
  }
  return valor;
}

/**
 * Ejecuta una skill APROBADA. deps.ejecutor: async (herramienta, argumentos)
 * => { texto } (el ejecutor normal del agente: las guardas se aplican en
 * cada paso). Se detiene en el primer paso que lanza error.
 */
export async function ejecutarSkill(criterio, args = {}, deps = {}) {
  const data = cargar(deps);
  const skill = buscarSkill(data, criterio);
  if (!skill) return { ok: false, error: `No existe ninguna skill llamada "${criterio}".` };
  if (skill.estado !== 'aprobada') {
    return { ok: false, error: `La skill "${skill.nombre}" esta ${skill.estado}: solo se ejecutan skills aprobadas por David.` };
  }
  if (typeof deps.ejecutor !== 'function') return { ok: false, error: 'Ejecutor no disponible.' };
  const argumentos = args && typeof args === 'object' ? args : {};
  for (const p of skill.parametros || []) {
    if (p.requerido && (argumentos[p.nombre] === undefined || argumentos[p.nombre] === '')) {
      return { ok: false, error: `Falta el parametro obligatorio "${p.nombre}".` };
    }
  }
  const declarados = new Set((skill.parametros || []).map((p) => p.nombre));
  const desconocidos = Object.keys(argumentos).filter((k) => !declarados.has(k));
  if (desconocidos.length > 0) {
    return { ok: false, error: `Parametros no declarados en la skill: ${desconocidos.join(', ')}.` };
  }
  const resultados = [];
  for (const [i, paso] of skill.pasos.entries()) {
    const argumentosPaso = sustituirPlaceholders(paso.argumentos || {}, argumentos);
    try {
      const res = await deps.ejecutor(paso.herramienta, argumentosPaso);
      resultados.push({ paso: i + 1, herramienta: paso.herramienta, texto: res && res.texto ? res.texto : String(res) });
    } catch (err) {
      resultados.push({ paso: i + 1, herramienta: paso.herramienta, error: err.message });
      return { ok: false, skill: skill.nombre, resultados, error: `El paso ${i + 1} (${paso.herramienta}) fallo: ${err.message}` };
    }
  }
  const texto = resultados.map((r) => `[Paso ${r.paso}: ${r.herramienta}] ${r.texto}`).join('\n\n');
  return { ok: true, skill: skill.nombre, resultados, texto };
}

export function eliminarSkill(criterio, deps = {}) {
  const data = cargar(deps);
  const skill = buscarSkill(data, criterio);
  if (!skill) return { ok: false, error: `No existe ninguna skill llamada "${criterio}".` };
  data.skills = data.skills.filter((s) => s !== skill);
  guardar(data, deps);
  return { ok: true };
}

/** Solo para pruebas: reinicia las propuestas pendientes. */
export function _reiniciarPendientes() {
  pendientes.clear();
}
