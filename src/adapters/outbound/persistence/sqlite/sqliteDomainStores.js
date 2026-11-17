/**
 * sqliteDomainStores.js - Almacenes SQLite de dominio para erradicacion total de JSONs.
 *
 * Provee adaptadores tipados con soporte multi-tenant (tenant_id) y transacciones ACID
 * sobre la base de datos principal jarvis.db.
 *
 * Strict Policy: Zero Emojis.
 */

import crypto from 'node:crypto';
import { TENANT_PROPIETARIO, afirmarTenantId } from '../../../../core/tenancy.js';

// ============================================================================
// 1. LISTA DE LA COMPRA
// ============================================================================
export function crearSqliteShoppingStore(db) {
  const ins = db.prepare('INSERT INTO lista_compra (id, tenant_id, item, cantidad, tachado, fecha) VALUES (?, ?, ?, ?, ?, ?)');
  const sel = db.prepare('SELECT id, item, cantidad, tachado, fecha FROM lista_compra WHERE tenant_id = ? AND tachado = 0 ORDER BY fecha ASC');
  const selAll = db.prepare('SELECT id, item, cantidad, tachado, fecha FROM lista_compra WHERE tenant_id = ? ORDER BY fecha ASC');
  const tach = db.prepare('UPDATE lista_compra SET tachado = 1 WHERE tenant_id = ? AND LOWER(item) LIKE ?');
  const vac = db.prepare('DELETE FROM lista_compra WHERE tenant_id = ?');

  return Object.freeze({
    anadir(items, tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      const lista = (Array.isArray(items) ? items : [items]).map((i) => String(i || '').trim().slice(0, 80)).filter(Boolean);
      const ahora = new Date().toISOString();
      const anadidos = [];
      const tx = db.transaction(() => {
        for (const item of lista) {
          const yaExiste = db.prepare('SELECT 1 FROM lista_compra WHERE tenant_id = ? AND LOWER(item) = ? AND tachado = 0').get(tenantId, item.toLowerCase());
          if (yaExiste) continue;
          const id = `item_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
          ins.run(id, tenantId, item, '1', 0, ahora);
          anadidos.push(item);
        }
      });
      tx.immediate();
      const total = sel.all(tenantId).length;
      return { ok: true, anadidos, total };
    },
    listar(tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      return sel.all(tenantId).map((r) => r.item);
    },
    listarDetalle(tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      return selAll.all(tenantId);
    },
    tachar(criterio, tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      const c = String(criterio || '').trim().toLowerCase();
      if (!c) return { ok: false, error: 'No encuentro eso en la lista.' };
      const info = tach.run(tenantId, `%${c}%`);
      if (info.changes === 0) return { ok: false, error: 'No encuentro eso en la lista.' };
      const restantes = sel.all(tenantId).map((r) => r.item);
      return { ok: true, tachado: criterio, restantes: restantes.length, items: restantes };
    },
    vaciar(tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      const info = vac.run(tenantId);
      return { ok: true, borrados: info.changes };
    }
  });
}

// ============================================================================
// 2. HABITOS Y LOGS
// ============================================================================
export function crearSqliteHabitsStore(db) {
  const insHab = db.prepare('INSERT INTO habitos (id, tenant_id, nombre, frecuencia, dias, hora, activo, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const selHab = db.prepare('SELECT id, nombre, frecuencia, dias, hora, activo, creado_en FROM habitos WHERE tenant_id = ? AND activo = 1');
  const delHab = db.prepare('UPDATE habitos SET activo = 0 WHERE tenant_id = ? AND id = ?');
  const insLog = db.prepare('INSERT INTO habitos_logs (id, tenant_id, habito_id, fecha, completado) VALUES (?, ?, ?, ?, 1)');
  const selLogs = db.prepare('SELECT fecha FROM habitos_logs WHERE tenant_id = ? AND habito_id = ? ORDER BY fecha DESC');
  const selExisteActivo = db.prepare('SELECT 1 FROM habitos WHERE tenant_id = ? AND activo = 1 AND LOWER(nombre) = LOWER(?)');
  const selHabitoPorCriterio = db.prepare('SELECT id, nombre FROM habitos WHERE tenant_id = ? AND activo = 1 AND (id = ? OR LOWER(nombre) LIKE ?) LIMIT 1');
  const selLogExiste = db.prepare('SELECT 1 FROM habitos_logs WHERE tenant_id = ? AND habito_id = ? AND fecha = ? LIMIT 1');
  const selLogHoy = db.prepare('SELECT 1 FROM habitos_logs WHERE tenant_id = ? AND habito_id = ? AND fecha = ? LIMIT 1');
  const cntLogsDistintos = db.prepare('SELECT COUNT(DISTINCT fecha) as total FROM habitos_logs WHERE tenant_id = ? AND habito_id = ?');

  return Object.freeze({
    crear({ id, nombre, frecuencia = 'diaria', dias = [], hora = null }, tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      const n = String(nombre || '').trim();
      const yaExiste = selExisteActivo.get(tenantId, n);
      if (yaExiste) {
        return { ok: false, error: 'Ya sigues el habito "' + n + '".' };
      }
      const hid = id || `hab_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      insHab.run(hid, tenantId, n, frecuencia, JSON.stringify(dias), hora, 1, new Date().toISOString());
      return { id: hid, nombre: n, frecuencia, dias, hora };
    },
    listar(tenantId = TENANT_PROPIETARIO, fechaHoy = null) {
      afirmarTenantId(tenantId);
      const hoyStr = fechaHoy || new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
      const filas = selHab.all(tenantId);
      return filas.map((f) => {
        const hechoHoy = Boolean(selLogHoy.get(tenantId, f.id, hoyStr));
        const totRow = cntLogsDistintos.get(tenantId, f.id);
        const totalDias = totRow ? Number(totRow.total) : 0;
        return {
          id: f.id,
          nombre: f.nombre,
          frecuencia: f.frecuencia,
          dias: JSON.parse(f.dias || '[]'),
          hora: f.hora,
          hechoHoy,
          racha: this.calcularRacha(f.id, tenantId),
          totalDias
        };
      });
    },
    marcar(criterio, fecha = new Date().toISOString().slice(0, 10), tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      const c = String(criterio || '').trim();
      if (!c) return { ok: false, error: 'No encuentro ese habito. Lista los tuyos con "mis habitos".' };
      const habito = selHabitoPorCriterio.get(tenantId, c, `%${c.toLowerCase()}%`);
      if (!habito) {
        return { ok: false, error: 'No encuentro ese habito. Lista los tuyos con "mis habitos".' };
      }
      const yaMarcado = selLogExiste.get(tenantId, habito.id, fecha);
      if (yaMarcado) {
        return { ok: false, error: '"' + habito.nombre + '" ya estaba marcado el ' + fecha + '.' };
      }
      const logId = `log_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      insLog.run(logId, tenantId, habito.id, fecha);
      return { ok: true, habito, habitoId: habito.id, fecha, racha: this.calcularRacha(habito.id, tenantId) };
    },
    calcularRacha(habitoId, tenantId = TENANT_PROPIETARIO) {
      const logs = selLogs.all(tenantId, habitoId).map((l) => l.fecha);
      if (logs.length === 0) return 0;
      let racha = 0;
      let ref = new Date();
      ref.setHours(0, 0, 0, 0);
      for (const logFecha of logs) {
        const d = new Date(logFecha);
        d.setHours(0, 0, 0, 0);
        const diffDias = Math.round((ref.getTime() - d.getTime()) / (1000 * 3600 * 24));
        if (diffDias === 0 || diffDias === 1) {
          racha++;
          ref = d;
        } else {
          break;
        }
      }
      return racha;
    },
    borrar(habitoId, tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      const info = delHab.run(tenantId, habitoId);
      return { ok: info.changes > 0 };
    }
  });
}

// ============================================================================
// 3. RECORDATORIOS
// ============================================================================
export function crearSqliteReminderStore(db) {
  const ins = db.prepare('INSERT INTO recordatorios (id, tenant_id, chat_id, mensaje, fecha_objetivo, recurrencia, estado, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const selPend = db.prepare('SELECT id, chat_id, mensaje, fecha_objetivo, recurrencia, estado, creado_en FROM recordatorios WHERE tenant_id = ? AND estado = ? ORDER BY fecha_objetivo ASC');
  const selTodos = db.prepare('SELECT id, chat_id, mensaje, fecha_objetivo, recurrencia, estado, creado_en FROM recordatorios WHERE tenant_id = ? ORDER BY fecha_objetivo ASC');
  const updEstado = db.prepare('UPDATE recordatorios SET estado = ? WHERE tenant_id = ? AND (id = ? OR LOWER(mensaje) LIKE ?)');
  const updTodos = db.prepare('UPDATE recordatorios SET estado = ? WHERE tenant_id = ? AND estado = ?');
  const del = db.prepare('DELETE FROM recordatorios WHERE tenant_id = ? AND id = ?');

  return Object.freeze({
    crear({ id, chatId, mensaje, fechaObjetivo, recurrencia = null }, tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      const rid = id || `rem_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const ahora = new Date().toISOString();
      ins.run(rid, tenantId, String(chatId || ''), String(mensaje || ''), String(fechaObjetivo || ''), recurrencia, 'pendiente', ahora);
      return { id: rid, chatId, mensaje, fechaObjetivo, recurrencia, estado: 'pendiente', creado_en: ahora };
    },
    listar(tenantId = TENANT_PROPIETARIO, estado = 'pendiente') {
      afirmarTenantId(tenantId);
      return estado ? selPend.all(tenantId, estado) : selTodos.all(tenantId);
    },
    actualizarEstado(id, nuevoEstado, tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      const info = updEstado.run(nuevoEstado, tenantId, id, `%${String(id || '').toLowerCase()}%`);
      return { ok: info.changes > 0 };
    },
    cancelar(criterio, tenantId = TENANT_PROPIETARIO) {
      return this.actualizarEstado(criterio, 'cancelado', tenantId);
    },
    cancelarTodos(tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      const info = updTodos.run('cancelado', tenantId, 'pendiente');
      return { ok: true, cancelados: info.changes };
    },
    eliminar(id, tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      const info = del.run(tenantId, id);
      return { ok: info.changes > 0 };
    }
  });
}

// ============================================================================
// 4. CONTACTOS
// ============================================================================
export function crearSqliteContactsStore(db) {
  const ins = db.prepare('INSERT OR REPLACE INTO contactos (id, tenant_id, nombre, telefono, notas, creado_en) VALUES (?, ?, ?, ?, ?, ?)');
  const sel = db.prepare('SELECT id, nombre, telefono, notas, creado_en FROM contactos WHERE tenant_id = ? ORDER BY nombre ASC');
  const delCrit = db.prepare('DELETE FROM contactos WHERE tenant_id = ? AND (id = ? OR LOWER(nombre) LIKE ?)');

  function decodificarNotas(txt) {
    let relacion = null;
    let email = null;
    let notas = txt || null;
    if (txt && typeof txt === 'string' && txt.startsWith('{') && txt.endsWith('}')) {
      try {
        const obj = JSON.parse(txt);
        relacion = obj.relacion || null;
        email = obj.email || null;
        notas = obj.notas || null;
      } catch {}
    }
    return { relacion, email, notas };
  }

  return Object.freeze({
    guardar({ id, nombre, telefono = '', relacion = '', email = '', notas = '' }, tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      const nombreLimpio = String(nombre || '').trim();
      const porNombre = db.prepare('SELECT id FROM contactos WHERE tenant_id = ? AND LOWER(nombre) = LOWER(?)').get(tenantId, nombreLimpio);
      const cid = id || (porNombre ? porNombre.id : `cnt_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`);
      const payloadNotas = (relacion || email) ? JSON.stringify({ relacion, email, notas }) : (notas || null);
      ins.run(cid, tenantId, nombreLimpio, String(telefono || '').trim(), payloadNotas, new Date().toISOString());
      return { id: cid, nombre: nombreLimpio, telefono, relacion, email, notas };
    },
    listar(tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      return sel.all(tenantId).map((r) => {
        const d = decodificarNotas(r.notas);
        return {
          id: r.id,
          nombre: r.nombre,
          telefono: r.telefono || null,
          relacion: d.relacion,
          email: d.email,
          notas: d.notas,
          creadoEn: r.creado_en
        };
      });
    },
    buscar(termino, tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      const lista = this.listar(tenantId);
      const c = String(termino || '').toLowerCase();
      return lista.filter((ct) =>
        ct.nombre.toLowerCase().includes(c) ||
        (ct.relacion || '').toLowerCase().includes(c) ||
        (ct.notas || '').toLowerCase().includes(c)
      );
    },
    borrar(criterio, tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      const info = delCrit.run(tenantId, criterio, `%${String(criterio || '').toLowerCase()}%`);
      return { ok: info.changes > 0 };
    }
  });
}

// ============================================================================
// 5. QUEDADAS Y AGENDA SOCIAL
// ============================================================================
export function crearSqliteQuedadasStore(db) {
  const ins = db.prepare('INSERT INTO quedadas_agenda (id, tenant_id, titulo, fecha, participantes, descripcion, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const sel = db.prepare('SELECT id, titulo, fecha, participantes, descripcion, creado_en FROM quedadas_agenda WHERE tenant_id = ? ORDER BY fecha ASC');
  const del = db.prepare('DELETE FROM quedadas_agenda WHERE tenant_id = ? AND id = ?');

  return Object.freeze({
    crear({ id, titulo, fecha, participantes = [], descripcion = '' }, tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      const qid = id || `qed_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const ahora = new Date().toISOString();
      ins.run(qid, tenantId, String(titulo || ''), String(fecha || ''), JSON.stringify(participantes), String(descripcion || ''), ahora);
      return { id: qid, titulo, fecha, participantes, descripcion, creado_en: ahora };
    },
    listar(tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      return sel.all(tenantId).map((q) => ({
        ...q,
        participantes: JSON.parse(q.participantes || '[]')
      }));
    },
    borrar(id, tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      const info = del.run(tenantId, id);
      return { ok: info.changes > 0 };
    }
  });
}

// ============================================================================
// 6. SNOOZES
// ============================================================================
export function crearSqliteSnoozeStore(db) {
  const ins = db.prepare('INSERT INTO snoozes (id, tenant_id, chat_id, mensaje_original_id, fecha_aviso, estado, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const selPend = db.prepare('SELECT id, chat_id, mensaje_original_id, fecha_aviso, estado, creado_en FROM snoozes WHERE tenant_id = ? AND estado = ? ORDER BY fecha_aviso ASC');
  const upd = db.prepare("UPDATE snoozes SET estado = ? WHERE tenant_id = ? AND estado = 'pendiente' AND (id = ? OR chat_id = ?)");

  return Object.freeze({
    guardar({ id, chatId, mensajeOriginalId, fechaAviso }, tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      const sid = id || `snz_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const ahora = new Date().toISOString();
      ins.run(sid, tenantId, String(chatId || ''), String(mensajeOriginalId || ''), String(fechaAviso || ''), 'pendiente', ahora);
      return { id: sid, chatId, mensajeOriginalId, fechaAviso, estado: 'pendiente' };
    },
    listarPendientes(tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      return selPend.all(tenantId, 'pendiente');
    },
    desactivar(idOChatId, nuevoEstado = 'completado', tenantId = TENANT_PROPIETARIO) {
      let estado = nuevoEstado;
      let tId = tenantId;
      if (nuevoEstado !== 'completado' && nuevoEstado !== 'cancelado') {
        if (typeof nuevoEstado === 'string' && (nuevoEstado === 'propietario' || nuevoEstado.startsWith('tenant_') || (nuevoEstado.length > 0 && tenantId === TENANT_PROPIETARIO))) {
          tId = nuevoEstado;
          estado = 'completado';
        }
      }
      afirmarTenantId(tId);
      const sid = String(idOChatId || '');
      const info = upd.run(estado, tId, sid, sid);
      return { ok: info.changes > 0 };
    }
  });
}

// ============================================================================
// 7. FLASHCARDS Y ESTUDIO
// ============================================================================
export function crearSqliteFlashcardsStore(db) {
  const ins = db.prepare('INSERT INTO estudio_flashcards (id, tenant_id, asignatura, pregunta, respuesta, proximo_repaso, intervalo_dias, facilidad, repeticiones, creada_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const sel = db.prepare('SELECT id, asignatura, pregunta, respuesta, proximo_repaso, intervalo_dias, facilidad, repeticiones, ultima_alerta_en, creada_en FROM estudio_flashcards WHERE tenant_id = ? ORDER BY proximo_repaso ASC');
  const selDue = db.prepare('SELECT id, asignatura, pregunta, respuesta, proximo_repaso, intervalo_dias, facilidad, repeticiones, ultima_alerta_en, creada_en FROM estudio_flashcards WHERE tenant_id = ? AND proximo_repaso <= ? ORDER BY proximo_repaso ASC');
  const upd = db.prepare('UPDATE estudio_flashcards SET proximo_repaso = ?, intervalo_dias = ?, facilidad = ?, repeticiones = ? WHERE tenant_id = ? AND id = ?');
  const updAlerta = db.prepare('UPDATE estudio_flashcards SET ultima_alerta_en = ? WHERE tenant_id = ? AND id = ?');
  const del = db.prepare('DELETE FROM estudio_flashcards WHERE tenant_id = ? AND id = ?');

  return Object.freeze({
    crear({ id, asignatura, pregunta, respuesta, intervaloDias = 1, facilidad = 2.5 }, tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      const fid = id || `fc_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const ahora = new Date().toISOString();
      ins.run(fid, tenantId, String(asignatura || 'general'), String(pregunta || ''), String(respuesta || ''), ahora, intervaloDias, facilidad, 0, ahora);
      return { id: fid, asignatura, pregunta, respuesta, proximo_repaso: ahora };
    },
    listar(tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      return sel.all(tenantId);
    },
    pendientesRepaso(tenantId = TENANT_PROPIETARIO, hasta = new Date().toISOString()) {
      afirmarTenantId(tenantId);
      return selDue.all(tenantId, hasta);
    },
    marcarAlerta(id, fechaIso, tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      const info = updAlerta.run(String(fechaIso || new Date().toISOString()), tenantId, id);
      return { ok: info.changes > 0 };
    },
    responder(id, { intervaloDias, facilidad, repeticiones, proximoRepaso }, tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      const info = upd.run(proximoRepaso, intervaloDias, facilidad, repeticiones, tenantId, id);
      return { ok: info.changes > 0 };
    },
    borrar(id, tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      const info = del.run(tenantId, id);
      return { ok: info.changes > 0 };
    }
  });
}

// ============================================================================
// 8. MENSAJES PROGRAMADOS
// ============================================================================
export function crearSqliteScheduledMessageStore(db) {
  const ins = db.prepare('INSERT INTO mensajes_programados (id, tenant_id, jid, mensaje, fecha_envio, estado, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET jid = excluded.jid, mensaje = excluded.mensaje, fecha_envio = excluded.fecha_envio, estado = excluded.estado');
  const selPend = db.prepare('SELECT id, jid, mensaje, fecha_envio, estado, creado_en FROM mensajes_programados WHERE tenant_id = ? AND estado = ? ORDER BY fecha_envio ASC');
  const upd = db.prepare('UPDATE mensajes_programados SET estado = ? WHERE tenant_id = ? AND id = ?');
  const del = db.prepare('DELETE FROM mensajes_programados WHERE tenant_id = ? AND id = ?');

  return Object.freeze({
    guardar({ id, jid, mensaje, fechaEnvio, estado = 'pendiente' }, tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      const mid = id || `msg_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const ahora = new Date().toISOString();
      ins.run(mid, tenantId, String(jid || ''), String(mensaje || ''), String(fechaEnvio || ''), String(estado || 'pendiente'), ahora);
      return { id: mid, jid, mensaje, fechaEnvio, estado: estado || 'pendiente', creado_en: ahora };
    },
    listarPendientes(tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      return selPend.all(tenantId, 'pendiente');
    },
    actualizarEstado(id, nuevoEstado, tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      const info = upd.run(nuevoEstado, tenantId, id);
      return { ok: info.changes > 0 };
    },
    cancelar(id, tenantId = TENANT_PROPIETARIO) {
      return this.actualizarEstado(id, 'cancelado', tenantId);
    },
    eliminar(id, tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      const info = del.run(tenantId, id);
      return { ok: info.changes > 0 };
    }
  });
}

// ============================================================================
// 9. HISTORIAL DE CONVERSACIONES (MIGRACION 012)
// ============================================================================
export function crearSqliteHistoryStore(db) {
  const ins = db.prepare('INSERT INTO conversaciones_historial (id, tenant_id, chat_id, role, content, resumen, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const selResumen = db.prepare('SELECT resumen FROM conversaciones_historial WHERE tenant_id = ? AND chat_id = ? AND resumen IS NOT NULL ORDER BY creado_en DESC LIMIT 1');
  const selMensajes = db.prepare('SELECT role, content FROM (SELECT role, content, creado_en, rowid FROM conversaciones_historial WHERE tenant_id = ? AND chat_id = ? ORDER BY creado_en DESC, rowid DESC LIMIT ?) ORDER BY creado_en ASC, rowid ASC');
  const delChat = db.prepare('DELETE FROM conversaciones_historial WHERE tenant_id = ? AND chat_id = ?');
  const delAntiguos = db.prepare('DELETE FROM conversaciones_historial WHERE tenant_id = ? AND chat_id = ? AND id NOT IN (SELECT id FROM conversaciones_historial WHERE tenant_id = ? AND chat_id = ? ORDER BY creado_en DESC, rowid DESC LIMIT ?)');
  const selBuscar = db.prepare('SELECT role, content FROM conversaciones_historial WHERE tenant_id = ? AND chat_id = ? AND LOWER(content) LIKE ? ORDER BY creado_en DESC, rowid DESC LIMIT ?');
  const cntMensajes = db.prepare('SELECT COUNT(*) as total FROM conversaciones_historial WHERE tenant_id = ? AND chat_id = ?');

  return Object.freeze({
    registrar(chatId, role, content, resumen = null, tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      const hid = `hist_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      ins.run(hid, tenantId, String(chatId || ''), String(role || ''), String(content || ''), resumen, new Date().toISOString());
      return { id: hid };
    },
    obtener(chatId, limite = 12, tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      const l = Math.max(Number(limite) || 12, 1);
      const filaResumen = selResumen.get(tenantId, String(chatId || ''));
      const ultimoResumen = filaResumen ? filaResumen.resumen : null;
      const mensajes = selMensajes.all(tenantId, String(chatId || ''), l).map((f) => ({ role: f.role, content: f.content }));
      return { resumen: ultimoResumen, mensajes };
    },
    purgarAntiguos(chatId, conservarLimite, tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      const k = Math.max(Number(conservarLimite) || 0, 0);
      const info = delAntiguos.run(tenantId, String(chatId || ''), tenantId, String(chatId || ''), k);
      return { ok: true, eliminados: info.changes };
    },
    buscar(chatId, termino, limite = 5, tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      const l = Math.min(Math.max(Number(limite) || 5, 1), 50);
      const t = String(termino || '').trim().toLowerCase();
      const filas = selBuscar.all(tenantId, String(chatId || ''), `%${t}%`, l);
      return filas;
    },
    contar(chatId, tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      const r = cntMensajes.get(tenantId, String(chatId || ''));
      return r ? Number(r.total) : 0;
    },
    limpiar(chatId, tenantId = TENANT_PROPIETARIO) {
      afirmarTenantId(tenantId);
      const info = delChat.run(tenantId, String(chatId || ''));
      return { ok: info.changes > 0 };
    }
  });
}
