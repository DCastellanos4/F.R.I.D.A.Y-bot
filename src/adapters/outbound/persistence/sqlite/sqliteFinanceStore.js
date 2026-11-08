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
import { TENANT_PROPIETARIO, afirmarTenantId } from '../../../../core/tenancy.js';

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

export function crearSqliteFinanceStore(db, { tenantId = TENANT_PROPIETARIO } = {}) {
  afirmarTenantId(tenantId);
  const qGastos = db.prepare('SELECT * FROM finanzas_gastos WHERE tenant_id = ? ORDER BY rowid');
  const qSubs = db.prepare('SELECT * FROM finanzas_suscripciones WHERE tenant_id = ? ORDER BY rowid');
  const qPres = db.prepare('SELECT categoria, limite FROM finanzas_presupuestos WHERE tenant_id = ? ORDER BY rowid');
  const qBorr = db.prepare('SELECT * FROM finanzas_borradores WHERE tenant_id = ? ORDER BY rowid');
  const qConf = db.prepare('SELECT clave, valor FROM finanzas_config WHERE tenant_id = ?');

  const delGastos = db.prepare('DELETE FROM finanzas_gastos WHERE tenant_id = ?');
  const delSubs = db.prepare('DELETE FROM finanzas_suscripciones WHERE tenant_id = ?');
  const delPres = db.prepare('DELETE FROM finanzas_presupuestos WHERE tenant_id = ?');
  const delBorr = db.prepare('DELETE FROM finanzas_borradores WHERE tenant_id = ?');
  const delConf = db.prepare('DELETE FROM finanzas_config WHERE tenant_id = ?');

  const insGasto = db.prepare(`
    INSERT INTO finanzas_gastos (id, importe, comercio, categoria, fecha, notas, origen, creado_en, tenant_id)
    VALUES (@id, @importe, @comercio, @categoria, @fecha, @notas, @origen, @creado_en, @tenant_id)
  `);
  const insSub = db.prepare(`
    INSERT INTO finanzas_suscripciones (id, nombre, importe, dia_renovacion, categoria, ultimo_aviso_para, creada_en, tenant_id)
    VALUES (@id, @nombre, @importe, @dia_renovacion, @categoria, @ultimo_aviso_para, @creada_en, @tenant_id)
  `);
  const insPres = db.prepare('INSERT INTO finanzas_presupuestos (tenant_id, categoria, limite) VALUES (?, ?, ?)');
  const insBorr = db.prepare(`
    INSERT INTO finanzas_borradores (id, estado, chat_id, datos, dudas, gasto_id, creado_en, tenant_id)
    VALUES (@id, @estado, @chat_id, @datos, @dudas, @gasto_id, @creado_en, @tenant_id)
  `);
  const insConf = db.prepare('INSERT INTO finanzas_config (tenant_id, clave, valor) VALUES (?, ?, ?)');

  const reemplazarTodo = db.transaction((estado) => {
    delGastos.run(tenantId);
    delSubs.run(tenantId);
    delPres.run(tenantId);
    delBorr.run(tenantId);
    delConf.run(tenantId);
    for (const g of estado.gastos || []) {
      insGasto.run({
        id: g.id,
        importe: g.importe,
        comercio: g.comercio,
        categoria: g.categoria,
        fecha: g.fecha,
        notas: g.notas ?? null,
        origen: g.origen || 'manual',
        creado_en: g.creadoEn,
        tenant_id: tenantId
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
        creada_en: s.creadaEn,
        tenant_id: tenantId
      });
    }
    for (const [categoria, limite] of Object.entries(estado.presupuestos || {})) {
      insPres.run(tenantId, categoria, limite);
    }
    for (const b of estado.borradores || []) {
      insBorr.run({
        id: b.id,
        estado: b.estado,
        chat_id: b.chatId ?? null,
        datos: JSON.stringify(b.datos),
        dudas: JSON.stringify(Array.isArray(b.dudas) ? b.dudas : []),
        gasto_id: b.gastoId ?? null,
        creado_en: b.creadoEn,
        tenant_id: tenantId
      });
    }
    for (const [clave, valor] of Object.entries(estado.config || {})) {
      insConf.run(tenantId, clave, JSON.stringify(valor));
    }
  });

  return Object.freeze({
    tenantId,
    leer() {
      const presupuestos = {};
      for (const fila of qPres.all(tenantId)) presupuestos[fila.categoria] = fila.limite;
      const config = {};
      for (const fila of qConf.all(tenantId)) {
        try {
          config[fila.clave] = JSON.parse(fila.valor);
        } catch {
          config[fila.clave] = fila.valor;
        }
      }
      return {
        gastos: qGastos.all(tenantId).map(filaAGasto),
        suscripciones: qSubs.all(tenantId).map(filaASuscripcion),
        presupuestos,
        config,
        borradores: qBorr.all(tenantId).map(filaABorrador)
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
