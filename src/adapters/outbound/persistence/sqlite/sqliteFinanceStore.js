/**
 * Store SQLite para el estado de finanzas (gastos, suscripciones,
 * presupuestos, borradores de ticket y config).
 *
 * Misma costura que el JSON historico de financeService: leer devuelve
 * el estado completo y guardar lo reemplaza de forma atomica dentro de
 * una transaccion; transaccion(fn) envuelve la operacion de negocio
 * completa (leer-modificar-escribir) con BEGIN IMMEDIATE.
 *
 * Strict Policy: Zero Emojis.
 */
import { conSpanPosibleSincrono } from '../../../../observability/telemetry.js';

function filaAGasto(f) {
  return {
    id: f.id,
    importe: f.importe,
    comercio: f.comercio,
    categoria: f.categoria,
    fecha: f.fecha,
    notas: f.notas ?? null,
    origen: f.origen,
    creadoEn: f.creado_en
  };
}

function filaASuscripcion(f) {
  return {
    id: f.id,
    nombre: f.nombre,
    importe: f.importe,
    diaRenovacion: f.dia_renovacion,
    categoria: f.categoria,
    ultimoAvisoPara: f.ultimo_aviso_para ?? null,
    creadaEn: f.creada_en
  };
}

function filaABorrador(f) {
  const borrador = {
    id: f.id,
    estado: f.estado,
    origen: 'foto',
    chatId: f.chat_id ?? null,
    datos: JSON.parse(f.datos),
    dudas: JSON.parse(f.dudas || '[]'),
    creadoEn: f.creado_en
  };
  if (f.gasto_id) borrador.gastoId = f.gasto_id;
  return borrador;
}

export function crearSqliteFinanceStore(db) {
  const qGastos = db.prepare('SELECT * FROM finanzas_gastos ORDER BY rowid');
  const qSubs = db.prepare('SELECT * FROM finanzas_suscripciones ORDER BY rowid');
  const qPres = db.prepare('SELECT categoria, limite FROM finanzas_presupuestos ORDER BY rowid');
  const qBorr = db.prepare('SELECT * FROM finanzas_borradores ORDER BY rowid');
  const qConf = db.prepare('SELECT clave, valor FROM finanzas_config');

  const delGastos = db.prepare('DELETE FROM finanzas_gastos');
  const delSubs = db.prepare('DELETE FROM finanzas_suscripciones');
  const delPres = db.prepare('DELETE FROM finanzas_presupuestos');
  const delBorr = db.prepare('DELETE FROM finanzas_borradores');
  const delConf = db.prepare('DELETE FROM finanzas_config');

  const insGasto = db.prepare(`
    INSERT INTO finanzas_gastos (id, importe, comercio, categoria, fecha, notas, origen, creado_en)
    VALUES (@id, @importe, @comercio, @categoria, @fecha, @notas, @origen, @creado_en)
  `);
  const insSub = db.prepare(`
    INSERT INTO finanzas_suscripciones (id, nombre, importe, dia_renovacion, categoria, ultimo_aviso_para, creada_en)
    VALUES (@id, @nombre, @importe, @dia_renovacion, @categoria, @ultimo_aviso_para, @creada_en)
  `);
  const insPres = db.prepare('INSERT INTO finanzas_presupuestos (categoria, limite) VALUES (?, ?)');
  const insBorr = db.prepare(`
    INSERT INTO finanzas_borradores (id, estado, chat_id, datos, dudas, gasto_id, creado_en)
    VALUES (@id, @estado, @chat_id, @datos, @dudas, @gasto_id, @creado_en)
  `);
  const insConf = db.prepare('INSERT INTO finanzas_config (clave, valor) VALUES (?, ?)');

  const reemplazarTodo = db.transaction((estado) => {
    delGastos.run();
    delSubs.run();
    delPres.run();
    delBorr.run();
    delConf.run();
    for (const g of estado.gastos || []) {
      insGasto.run({
        id: g.id,
        importe: g.importe,
        comercio: g.comercio,
        categoria: g.categoria,
        fecha: g.fecha,
        notas: g.notas ?? null,
        origen: g.origen || 'manual',
        creado_en: g.creadoEn
      });
    }
    for (const s of estado.suscripciones || []) {
      insSub.run({
        id: s.id,
        nombre: s.nombre,
        importe: s.importe,
        dia_renovacion: s.diaRenovacion,
        categoria: s.categoria,
        ultimo_aviso_para: s.ultimoAvisoPara ?? null,
        creada_en: s.creadaEn
      });
    }
    for (const [categoria, limite] of Object.entries(estado.presupuestos || {})) {
      insPres.run(categoria, limite);
    }
    for (const b of estado.borradores || []) {
      insBorr.run({
        id: b.id,
        estado: b.estado,
        chat_id: b.chatId ?? null,
        datos: JSON.stringify(b.datos),
        dudas: JSON.stringify(Array.isArray(b.dudas) ? b.dudas : []),
        gasto_id: b.gastoId ?? null,
        creado_en: b.creadoEn
      });
    }
    for (const [clave, valor] of Object.entries(estado.config || {})) {
      insConf.run(clave, JSON.stringify(valor));
    }
  });

  return Object.freeze({
    leer() {
      const presupuestos = {};
      for (const fila of qPres.all()) presupuestos[fila.categoria] = fila.limite;
      const config = {};
      for (const fila of qConf.all()) {
        try {
          config[fila.clave] = JSON.parse(fila.valor);
        } catch {
          config[fila.clave] = fila.valor;
        }
      }
      return {
        gastos: qGastos.all().map(filaAGasto),
        suscripciones: qSubs.all().map(filaASuscripcion),
        presupuestos,
        config,
        borradores: qBorr.all().map(filaABorrador)
      };
    },
    guardar(estado) {
      // Observabilidad: span db_write (solo entidad/operacion, nunca datos).
      return conSpanPosibleSincrono('db_write', { entidad: 'finanzas', operacion: 'guardar' }, () => reemplazarTodo(estado));
    },
    /** Transaccion IMMEDIATE: candado de escritura antes de leer. */
    transaccion(fn) {
      return conSpanPosibleSincrono('db_write', { entidad: 'finanzas', operacion: 'transaccion' }, () => db.transaction(fn).immediate());
    }
  });
}
