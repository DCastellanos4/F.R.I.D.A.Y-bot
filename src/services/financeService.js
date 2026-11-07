/**
 * financeService.js - Finanzas personales (funciones nº 24-27 del roadmap)
 *
 * Registro de gastos, resumen mensual comparativo, vigilante de
 * suscripciones con aviso previo a la renovacion y presupuesto por
 * categoria con alerta al acercarse al limite. Todo local, sin cuentas
 * bancarias ni terceros: David dicta los datos por su chat (o llegan de un
 * ticket ya leido; la lectura de imagen queda fuera de este servicio).
 * Persistencia en JSON con escritura atomica; rutas y efectos inyectables.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../config/paths.js';
import { enqueueAlert } from './alertQueueService.js';

export const ARCHIVO_DEFECTO = path.join(DATA_DIR, 'finanzas.json');
export const DIAS_AVISO_SUSCRIPCION = 3;
export const UMBRAL_ALERTA_PRESUPUESTO = 0.8;
export const INTERVALO_DEFECTO_MS = Number(process.env.DAVIS_FINANZAS_INTERVALO_MS) || 24 * 60 * 60 * 1000;
export const TTL_BORRADOR_MS = Number(process.env.DAVIS_FINANZAS_TTL_BORRADOR_MS) || 30 * 60 * 1000;

function ruta(deps = {}) {
  return deps.rutaArchivo || ARCHIVO_DEFECTO;
}

function estadoInicial() {
  return { gastos: [], suscripciones: [], presupuestos: {}, config: { avisosSuscripciones: false } };
}

function leerEstado(deps = {}) {
  try {
    return { ...estadoInicial(), ...JSON.parse(fs.readFileSync(ruta(deps), 'utf-8')) };
  } catch {
    return estadoInicial();
  }
}

function guardarEstado(estado, deps = {}) {
  const destino = ruta(deps);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const tmp = `${destino}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(estado, null, 2), 'utf-8');
  fs.renameSync(tmp, destino);
}

function ahora(deps = {}) {
  return deps.ahora ? new Date(deps.ahora) : new Date();
}

function fechaISO(d) {
  return d.toISOString().slice(0, 10);
}

function mesDe(fecha) {
  return fecha.slice(0, 7);
}

function normalizarCategoria(categoria) {
  const c = String(categoria || 'otros').trim().toLowerCase();
  return c || 'otros';
}

function importeValido(importe) {
  const n = Number(importe);
  return Number.isFinite(n) && n > 0 && n < 1000000 ? Math.round(n * 100) / 100 : null;
}

// ---------- Gastos (nº 24) ----------

export function registrarGasto({ importe, comercio, categoria, fecha, notas, origen }, deps = {}) {
  const n = importeValido(importe);
  if (n === null) return { ok: false, error: 'Importe invalido: debe ser un numero positivo.' };
  if (typeof comercio !== 'string' || !comercio.trim()) {
    return { ok: false, error: 'El comercio o concepto es obligatorio.' };
  }
  const fechaGasto = fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : fechaISO(ahora(deps));
  const estado = leerEstado(deps);
  const duplicado = estado.gastos.find((g) =>
    g.importe === n && g.comercio.toLowerCase() === comercio.trim().toLowerCase() && g.fecha === fechaGasto);
  const gasto = {
    id: crypto.randomUUID().slice(0, 8),
    importe: n,
    comercio: comercio.trim(),
    categoria: normalizarCategoria(categoria),
    fecha: fechaGasto,
    notas: notas ? String(notas).slice(0, 300) : null,
    origen: origen === 'foto' ? 'foto' : 'manual',
    creadoEn: ahora(deps).toISOString()
  };
  estado.gastos.push(gasto);
  guardarEstado(estado, deps);
  return {
    ok: true,
    gasto,
    aviso: duplicado ? `Ojo: ya habia un gasto identico ese dia (${duplicado.id}). Si es repetido, dilo y lo quito.` : null
  };
}

export function eliminarGasto(id, deps = {}) {
  const estado = leerEstado(deps);
  const antes = estado.gastos.length;
  estado.gastos = estado.gastos.filter((g) => g.id !== id);
  if (estado.gastos.length === antes) return { ok: false, error: `No hay ningun gasto con ID ${id}.` };
  guardarEstado(estado, deps);
  return { ok: true };
}

export function listarGastos({ mes, categoria } = {}, deps = {}) {
  let gastos = leerEstado(deps).gastos;
  if (mes) gastos = gastos.filter((g) => mesDe(g.fecha) === mes);
  if (categoria) gastos = gastos.filter((g) => g.categoria === normalizarCategoria(categoria));
  return gastos.sort((a, b) => b.fecha.localeCompare(a.fecha));
}

// ---------- Resumen mensual (nº 25) ----------

function totalesPorCategoria(gastos, mes) {
  const totales = {};
  for (const g of gastos.filter((g) => mesDe(g.fecha) === mes)) {
    totales[g.categoria] = Math.round(((totales[g.categoria] || 0) + g.importe) * 100) / 100;
  }
  return totales;
}

export function resumenMensual({ mes } = {}, deps = {}) {
  const mesActual = mes || mesDe(fechaISO(ahora(deps)));
  const [anio, m] = mesActual.split('-').map(Number);
  const mesAnterior = fechaISO(new Date(Date.UTC(anio, m - 2, 1))).slice(0, 7);
  const gastos = leerEstado(deps).gastos;
  const actual = totalesPorCategoria(gastos, mesActual);
  const anterior = totalesPorCategoria(gastos, mesAnterior);
  const totalActual = Math.round(Object.values(actual).reduce((s, v) => s + v, 0) * 100) / 100;
  const totalAnterior = Math.round(Object.values(anterior).reduce((s, v) => s + v, 0) * 100) / 100;
  const comparativa = Object.keys(actual).map((categoria) => ({
    categoria,
    actual: actual[categoria],
    anterior: anterior[categoria] || 0,
    variacion: anterior[categoria] ? Math.round(((actual[categoria] - anterior[categoria]) / anterior[categoria]) * 100) : null
  })).sort((a, b) => b.actual - a.actual);
  return { mes: mesActual, mesAnterior, totalActual, totalAnterior, comparativa };
}

// ---------- Suscripciones (nº 26) ----------

export function registrarSuscripcion({ nombre, importe, diaRenovacion, categoria }, deps = {}) {
  if (typeof nombre !== 'string' || !nombre.trim()) {
    return { ok: false, error: 'El nombre de la suscripcion es obligatorio.' };
  }
  const n = importeValido(importe);
  if (n === null) return { ok: false, error: 'Importe invalido.' };
  const dia = Number(diaRenovacion);
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
    return { ok: false, error: 'diaRenovacion debe ser un entero entre 1 y 31.' };
  }
  const estado = leerEstado(deps);
  const q = nombre.trim().toLowerCase();
  if (estado.suscripciones.some((s) => s.nombre.toLowerCase() === q)) {
    return { ok: false, error: `Ya tienes una suscripcion llamada "${nombre.trim()}".` };
  }
  const suscripcion = {
    id: crypto.randomUUID().slice(0, 8),
    nombre: nombre.trim(),
    importe: n,
    diaRenovacion: dia,
    categoria: normalizarCategoria(categoria || 'suscripciones'),
    ultimoAvisoPara: null,
    creadaEn: ahora(deps).toISOString()
  };
  estado.suscripciones.push(suscripcion);
  guardarEstado(estado, deps);
  return { ok: true, suscripcion };
}

export function cancelarSuscripcion(criterio, deps = {}) {
  const estado = leerEstado(deps);
  const q = String(criterio || '').trim().toLowerCase();
  if (!q) return { ok: false, error: 'Indica el nombre o ID de la suscripcion.' };
  const coincidencias = estado.suscripciones.filter((s) => s.id === q || s.nombre.toLowerCase().includes(q));
  if (coincidencias.length === 0) return { ok: false, error: `No hay ninguna suscripcion que coincida con "${criterio}".` };
  if (coincidencias.length > 1) {
    return { ok: false, error: `Varias suscripciones coinciden con "${criterio}".`, coincidencias: coincidencias.map((s) => ({ id: s.id, nombre: s.nombre })) };
  }
  estado.suscripciones = estado.suscripciones.filter((s) => s.id !== coincidencias[0].id);
  guardarEstado(estado, deps);
  return { ok: true, cancelada: coincidencias[0] };
}

export function listarSuscripciones(deps = {}) {
  return [...leerEstado(deps).suscripciones].sort((a, b) => a.diaRenovacion - b.diaRenovacion);
}

/** Proxima fecha de renovacion desde 'hoy'. */
function proximaRenovacion(dia, hoy) {
  const anio = hoy.getUTCFullYear();
  const mes = hoy.getUTCMonth();
  let candidata = new Date(Date.UTC(anio, mes, Math.min(dia, 28)));
  if (dia > 28) {
    const ultimoDia = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
    candidata = new Date(Date.UTC(anio, mes, Math.min(dia, ultimoDia)));
  }
  if (candidata <= hoy) {
    const siguienteMes = new Date(Date.UTC(anio, mes + 1, 1));
    const ultimoDiaSig = new Date(Date.UTC(siguienteMes.getUTCFullYear(), siguienteMes.getUTCMonth() + 1, 0)).getUTCDate();
    candidata = new Date(Date.UTC(siguienteMes.getUTCFullYear(), siguienteMes.getUTCMonth(), Math.min(dia, ultimoDiaSig)));
  }
  return candidata;
}

/**
 * Ronda del vigilante: encola aviso para las suscripciones que renuevan en
 * DIAS_AVISO_SUSCRIPCION dias o menos, una vez por renovacion.
 */
export function lanzarRondaSuscripciones(deps = {}) {
  const estado = leerEstado(deps);
  if (estado.suscripciones.length === 0) return { ok: true, avisadas: 0 };
  const hoy = ahora(deps);
  const hoyISO = fechaISO(hoy);
  const encolar = typeof deps.enqueue === 'function'
    ? deps.enqueue
    : (alerta) => enqueueAlert(alerta, deps.alertQueueOptions || {});
  let avisadas = 0;
  for (const s of estado.suscripciones) {
    const renovacion = proximaRenovacion(s.diaRenovacion, hoy);
    const renovacionISO = fechaISO(renovacion);
    const diasQueFaltan = Math.round((renovacion - hoy) / 86400000);
    if (diasQueFaltan > DIAS_AVISO_SUSCRIPCION) continue;
    if (s.ultimoAvisoPara === renovacionISO) continue;
    encolar({
      title: `Renovacion de ${s.nombre}: ${s.importe} EUR`,
      details: `Renueva el ${renovacionISO} (en ${diasQueFaltan} dia(s)). Si ya no la usas, este es el momento de cancelarla.`,
      priority: 'normal',
      source: 'finanzas-suscripciones'
    });
    s.ultimoAvisoPara = renovacionISO;
    avisadas++;
  }
  guardarEstado(estado, deps);
  return { ok: true, avisadas };
}

// ---------- Presupuesto (nº 27) ----------

export function configurarPresupuesto({ categoria, limite }, deps = {}) {
  const c = normalizarCategoria(categoria);
  if (categoria === undefined || categoria === null || !String(categoria).trim()) {
    return { ok: false, error: 'La categoria es obligatoria.' };
  }
  const n = importeValido(limite);
  if (n === null) return { ok: false, error: 'Limite invalido: debe ser un numero positivo.' };
  const estado = leerEstado(deps);
  estado.presupuestos[c] = n;
  guardarEstado(estado, deps);
  return { ok: true, categoria: c, limite: n };
}

export function estadoPresupuestos({ mes } = {}, deps = {}) {
  const estado = leerEstado(deps);
  const mesActual = mes || mesDe(fechaISO(ahora(deps)));
  const totales = totalesPorCategoria(estado.gastos, mesActual);
  return Object.entries(estado.presupuestos).map(([categoria, limite]) => {
    const gastado = totales[categoria] || 0;
    const ratio = limite > 0 ? gastado / limite : 0;
    return {
      categoria,
      limite,
      gastado: Math.round(gastado * 100) / 100,
      porcentaje: Math.round(ratio * 100),
      alerta: ratio >= UMBRAL_ALERTA_PRESUPUESTO
    };
  }).sort((a, b) => b.porcentaje - a.porcentaje);
}

// ---------- Monitor ----------

let temporizador = null;

export function configurarAvisosSuscripciones({ activo } = {}, deps = {}) {
  const estado = leerEstado(deps);
  if (typeof estado.config !== 'object' || estado.config === null) estado.config = {};
  estado.config.avisosSuscripciones = activo === true;
  guardarEstado(estado, deps);
  if (estado.config.avisosSuscripciones) {
    iniciarMonitorFinanzas(deps);
    return { ok: true, activo: true };
  }
  detenerMonitorFinanzas();
  return { ok: true, activo: false };
}

export function iniciarMonitorFinanzas(deps = {}) {
  if (temporizador) return { iniciado: true, mensaje: 'El monitor de finanzas ya estaba activo.' };
  const estado = leerEstado(deps);
  if (!estado.config || estado.config.avisosSuscripciones !== true) {
    return { iniciado: false, motivo: 'Avisos de suscripciones desactivados: el propietario los activa explicitamente (configurar_avisos_suscripciones), no basta con registrar suscripciones.' };
  }
  if (estado.suscripciones.length === 0) {
    return { iniciado: false, motivo: 'Sin suscripciones registradas: el vigilante no arranca hasta que el propietario registre la primera.' };
  }
  temporizador = setInterval(() => {
    try {
      lanzarRondaSuscripciones(deps);
    } catch (err) {
      console.error('[Finanzas] Error en ronda de suscripciones:', err.message);
    }
  }, deps.intervaloMs || INTERVALO_DEFECTO_MS);
  if (typeof temporizador.unref === 'function') temporizador.unref();
  return { iniciado: true };
}

export function detenerMonitorFinanzas() {
  if (temporizador) {
    clearInterval(temporizador);
    temporizador = null;
  }
  return { ok: true };
}

// ---------- Gastos desde foto de ticket (nº 24, via de imagen) ----------

function estadoConBorradores(estado) {
  if (!Array.isArray(estado.borradores)) estado.borradores = [];
  return estado;
}

export function crearBorradorDesdeTicket(ticket = {}, deps = {}) {
  const dudas = Array.isArray(ticket.camposDudosos) ? ticket.camposDudosos.slice(0, 6) : [];
  const n = ticket.importe === undefined || ticket.importe === null ? null : importeValido(ticket.importe);
  if (n === null) {
    return { ok: false, error: 'No he podido leer el importe del ticket con claridad. Dimelo tu: "gaste 12,50 en Mercadona".' };
  }
  // Marcadores de "no se lee" del modelo (N/A, null, desconocido...) no son
  // un comercio: se tratan como ausentes y quedan en dudas para que David
  // confirme; nunca se registran literalmente.
  const comercioCrudo = typeof ticket.comercio === 'string' ? ticket.comercio.trim().slice(0, 80) : '';
  const comercio = comercioCrudo && !/^(n\/?a|null|none|unknown|desconocid[ao]|no\s+legible|ilegible|sin\s+datos?|ningun[ao]?)$/i.test(comercioCrudo) ? comercioCrudo : null;
  if (!comercio && !dudas.includes('comercio')) dudas.push('comercio');
  const moneda = typeof ticket.moneda === 'string' && /^[A-Z]{3}$/.test(ticket.moneda.trim()) ? ticket.moneda.trim() : 'EUR';
  if (ticket.moneda === undefined || ticket.moneda === null) dudas.push('moneda');
  let fecha = null;
  if (typeof ticket.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ticket.fecha)) {
    fecha = ticket.fecha;
  } else {
    fecha = fechaISO(ahora(deps));
    dudas.push('fecha');
  }
  const estado = estadoConBorradores(leerEstado(deps));
  const borrador = {
    id: crypto.randomUUID().slice(0, 8),
    estado: 'pendiente',
    origen: 'foto',
    chatId: typeof deps.chatId === 'string' ? deps.chatId : null,
    datos: {
      importe: n,
      comercio,
      moneda,
      fecha,
      categoria: normalizarCategoria(ticket.categoria)
    },
    dudas,
    creadoEn: ahora(deps).toISOString()
  };
  estado.borradores.push(borrador);
  estado.borradores = estado.borradores.slice(-20);
  guardarEstado(estado, deps);
  return { ok: true, borrador, resumen: resumenBorrador(borrador) };
}

export function resumenBorrador(borrador) {
  const d = borrador.datos;
  const partes = [`${d.importe.toFixed(2)} ${d.moneda}`, d.comercio ? `en ${d.comercio}` : '(sin comercio legible)', `fecha ${d.fecha}`];
  let texto = `Del ticket he leido: ${partes.join(', ')}.`;
  if (borrador.dudas.length > 0) {
    texto += ` Tengo dudas con: ${borrador.dudas.join(', ')}.`;
  }
  return `${texto} No lo registro hasta que confirmes: responde "si" o corrigeme (por ejemplo "importe 13,20" o "comercio Lidl").`;
}


function buscarBorradorPendiente(estado, { id } = {}, deps = {}) {
  estadoConBorradores(estado);
  const chatId = typeof deps.chatId === 'string' ? deps.chatId : null;
  const ahoraMs = ahora(deps).getTime();
  const candidatos = estado.borradores.filter((b) =>
    b.estado === 'pendiente' &&
    b.chatId === chatId &&
    ahoraMs - new Date(b.creadoEn).getTime() <= TTL_BORRADOR_MS);
  if (id) return candidatos.find((b) => b.id === id) || null;
  return candidatos.pop() || null;
}

export function borradorPendiente(deps = {}) {
  return buscarBorradorPendiente(leerEstado(deps), {}, deps);
}

export function confirmarBorrador({ id, correcciones } = {}, deps = {}) {
  const estado = estadoConBorradores(leerEstado(deps));
  const borrador = buscarBorradorPendiente(estado, { id }, deps);
  if (!borrador) return { ok: false, error: 'No hay ningun gasto de foto pendiente de confirmar (o ha caducado: mandame otra vez el ticket).' };
  const datos = { ...borrador.datos };
  if (correcciones && typeof correcciones === 'object') {
    if (correcciones.importe !== undefined) {
      const n = importeValido(correcciones.importe);
      if (n === null) return { ok: false, error: 'Ese importe corregido no es valido. Prueba con un numero como 13,20.' };
      datos.importe = n;
    }
    if (correcciones.comercio !== undefined) {
      const c = String(correcciones.comercio || '').trim();
      if (!c) return { ok: false, error: 'El comercio corregido no puede quedar vacio.' };
      datos.comercio = c.slice(0, 80);
    }
    if (correcciones.categoria !== undefined) datos.categoria = normalizarCategoria(correcciones.categoria);
    if (correcciones.fecha !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(correcciones.fecha))) return { ok: false, error: 'La fecha corregida debe ser AAAA-MM-DD.' };
      datos.fecha = String(correcciones.fecha);
    }
    if (correcciones.moneda !== undefined) {
      const m = String(correcciones.moneda || '').trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(m)) return { ok: false, error: 'La moneda debe ser un codigo de 3 letras (EUR, USD...).' };
      datos.moneda = m;
    }
  }
  if (!datos.comercio) {
    return { ok: false, error: 'Sigue faltando el comercio. Dime donde fue el gasto y lo registro.' };
  }
  const resultado = registrarGasto({
    importe: datos.importe,
    comercio: datos.comercio,
    categoria: datos.categoria,
    fecha: datos.fecha,
    notas: `Registrado desde foto de ticket (${borrador.id}). Moneda leida: ${datos.moneda}.`,
    origen: 'foto'
  }, deps);
  if (!resultado.ok) return resultado;
  const estadoFinal = estadoConBorradores(leerEstado(deps));
  const b = estadoFinal.borradores.find((x) => x.id === borrador.id);
  if (b) {
    b.estado = 'confirmado';
    b.gastoId = resultado.gasto.id;
    guardarEstado(estadoFinal, deps);
  }
  return { ok: true, gasto: resultado.gasto, aviso: resultado.aviso, dudas: borrador.dudas };
}

export function descartarBorrador({ id } = {}, deps = {}) {
  const estado = estadoConBorradores(leerEstado(deps));
  const borrador = buscarBorradorPendiente(estado, { id }, deps);
  if (!borrador) return { ok: false, error: 'No habia ningun gasto de foto pendiente.' };
  borrador.estado = 'descartado';
  guardarEstado(estado, deps);
  return { ok: true, id: borrador.id };
}

export function interpretarRespuestaBorrador(texto) {
  const t = String(texto || '').trim();
  if (!t) return null;
  const correcciones = {};
  const mImporte = t.match(/importe\s+(\d+(?:[.,]\d{1,2})?)/i);
  if (mImporte) correcciones.importe = Number(mImporte[1].replace(',', '.'));
  const mComercio = t.match(/comercio\s+(.+?)(?:\s+(?:importe|categoria|fecha|moneda)\b|$)/i);
  if (mComercio) correcciones.comercio = mComercio[1].trim();
  const mCategoria = t.match(/categor[ií]a\s+(\S+)/i);
  if (mCategoria) correcciones.categoria = mCategoria[1];
  const mFecha = t.match(/fecha\s+(\d{4}-\d{2}-\d{2})/i);
  if (mFecha) correcciones.fecha = mFecha[1];
  const mMoneda = t.match(/moneda\s+([A-Za-z]{3})/i);
  if (mMoneda) correcciones.moneda = mMoneda[1].toUpperCase();
  const hayCorrecciones = Object.keys(correcciones).length > 0;
  const limpio = t.toLowerCase();
  if (/^(no|cancela|descarta|borra|olvidalo|olvídalo)\b/.test(limpio)) return { accion: 'descartar' };
  if (/^(si|sí|vale|ok|perfecto|adelante|correcto|confirmo|registralo|regístralo)\b/.test(limpio)) {
    return { accion: 'confirmar', correcciones: hayCorrecciones ? correcciones : undefined };
  }
  if (hayCorrecciones) return { accion: 'confirmar', correcciones };
  return null;
}
