/**
 * migrar_json_a_sqlite.js - Script de migracion masiva de ficheros JSON historicos a SQLite.
 *
 * Lee los ficheros JSON en data/ (reminders, snoozes, habitos, compra, contactos,
 * quedadas, ideas, entregas, flashcards, tracked_items, scheduled_messages)
 * y los consolida en tablas relacionales SQLite con columna tenant_id.
 *
 * Operacion idempotente y segura bajo ACID (BEGIN IMMEDIATE).
 *
 * Strict Policy: Zero Emojis.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirBaseDatos } from '../src/adapters/outbound/persistence/sqlite/connection.js';
import { ejecutarMigraciones } from '../src/adapters/outbound/persistence/sqlite/migraciones.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DAVIS_DATA_DIR || path.join(PROJECT_ROOT, 'data');
const DB_PATH = process.env.DAVIS_DB_PATH || path.join(DATA_DIR, 'jarvis.db');

function leerJsonSeguro(ruta) {
  try {
    if (!fs.existsSync(ruta)) return null;
    const raw = fs.readFileSync(ruta, 'utf8').trim();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[Migracion] Advertencia leyendo ${path.basename(ruta)}:`, err.message);
    return null;
  }
}

export function migrarTodoASqlite({ dbPath = DB_PATH, dataDir = DATA_DIR } = {}) {
  console.log(`[Migracion] Iniciando consolidacion SQLite en: ${dbPath}`);
  console.log(`[Migracion] Directorio de datos origen: ${dataDir}`);

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = abrirBaseDatos(dbPath);
  ejecutarMigraciones(db);

  const stats = {
    recordatorios: 0,
    snoozes: 0,
    habitos: 0,
    lista_compra: 0,
    contactos: 0,
    quedadas: 0,
    ideas: 0,
    entregas: 0,
    flashcards: 0,
    articulos_vigilados: 0,
    mensajes_programados: 0
  };

  const migrarLote = db.transaction(() => {
    // 1. Recordatorios (reminders.json)
    const reminders = leerJsonSeguro(path.join(dataDir, 'reminders.json'));
    if (Array.isArray(reminders)) {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO recordatorios (id, tenant_id, chat_id, mensaje, fecha_objetivo, recurrencia, estado, creado_en)
        VALUES (@id, @tenant_id, @chat_id, @mensaje, @fecha_objetivo, @recurrencia, @estado, @creado_en)
      `);
      for (const r of reminders) {
        if (!r.id) continue;
        stmt.run({
          id: String(r.id),
          tenant_id: String(r.tenant_id || 'propietario'),
          chat_id: String(r.chatId || r.chat_id || ''),
          mensaje: String(r.text || r.mensaje || ''),
          fecha_objetivo: String(r.targetTime || r.fecha_objetivo || r.target_time || new Date().toISOString()),
          recurrencia: r.recurrence || r.recurrencia || null,
          estado: String(r.status || r.estado || 'pendiente'),
          creado_en: String(r.createdAt || r.creado_en || new Date().toISOString())
        });
        stats.recordatorios++;
      }
    }

    // 2. Snoozes (snoozes.json)
    const snoozes = leerJsonSeguro(path.join(dataDir, 'snoozes.json'));
    if (Array.isArray(snoozes)) {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO snoozes (id, tenant_id, chat_id, mensaje_original_id, fecha_aviso, estado, creado_en)
        VALUES (@id, @tenant_id, @chat_id, @mensaje_original_id, @fecha_aviso, @estado, @creado_en)
      `);
      for (const s of snoozes) {
        if (!s.id) continue;
        stmt.run({
          id: String(s.id),
          tenant_id: String(s.tenant_id || 'propietario'),
          chat_id: String(s.chatId || s.chat_id || ''),
          mensaje_original_id: s.originalMessageId || s.mensaje_original_id || null,
          fecha_aviso: String(s.reminderTime || s.fecha_aviso || new Date().toISOString()),
          estado: String(s.status || s.estado || 'pendiente'),
          creado_en: String(s.createdAt || s.creado_en || new Date().toISOString())
        });
        stats.snoozes++;
      }
    }

    // 3. Habitos (habitos.json)
    const habitos = leerJsonSeguro(path.join(dataDir, 'habitos.json'));
    if (Array.isArray(habitos)) {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO habitos (id, tenant_id, nombre, frecuencia, dias, hora, activo, creado_en)
        VALUES (@id, @tenant_id, @nombre, @frecuencia, @dias, @hora, @activo, @creado_en)
      `);
      for (const h of habitos) {
        if (!h.id) continue;
        stmt.run({
          id: String(h.id),
          tenant_id: String(h.tenant_id || 'propietario'),
          nombre: String(h.nombre || h.title || ''),
          frecuencia: String(h.frecuencia || 'diaria'),
          dias: JSON.stringify(h.dias || []),
          hora: h.hora || null,
          activo: h.activo !== false ? 1 : 0,
          creado_en: String(h.creado_en || new Date().toISOString())
        });
        stats.habitos++;
      }
    }

    // 4. Lista de la compra (compra.json)
    const compra = leerJsonSeguro(path.join(dataDir, 'compra.json'));
    if (Array.isArray(compra)) {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO lista_compra (id, tenant_id, item, cantidad, tachado, fecha)
        VALUES (@id, @tenant_id, @item, @cantidad, @tachado, @fecha)
      `);
      for (const item of compra) {
        const id = item.id || `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        stmt.run({
          id: String(id),
          tenant_id: String(item.tenant_id || 'propietario'),
          item: String(item.item || item.nombre || item.texto || ''),
          cantidad: String(item.cantidad || '1'),
          tachado: item.tachado ? 1 : 0,
          fecha: String(item.fecha || new Date().toISOString())
        });
        stats.lista_compra++;
      }
    }

    // 5. Contactos (contactos.json)
    const contactos = leerJsonSeguro(path.join(dataDir, 'contactos.json'));
    if (Array.isArray(contactos)) {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO contactos (id, tenant_id, nombre, telefono, notas, creado_en)
        VALUES (@id, @tenant_id, @nombre, @telefono, @notas, @creado_en)
      `);
      for (const c of contactos) {
        if (!c.id && !c.nombre) continue;
        const id = c.id || `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        stmt.run({
          id: String(id),
          tenant_id: String(c.tenant_id || 'propietario'),
          nombre: String(c.nombre || ''),
          telefono: c.telefono || null,
          notas: c.notas || null,
          creado_en: String(c.creado_en || new Date().toISOString())
        });
        stats.contactos++;
      }
    }

    // 6. Quedadas (quedadas.json)
    const quedadas = leerJsonSeguro(path.join(dataDir, 'quedadas.json'));
    if (Array.isArray(quedadas)) {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO quedadas_agenda (id, tenant_id, titulo, fecha, participantes, descripcion, creado_en)
        VALUES (@id, @tenant_id, @titulo, @fecha, @participantes, @descripcion, @creado_en)
      `);
      for (const q of quedadas) {
        if (!q.id && !q.titulo) continue;
        const id = q.id || `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        stmt.run({
          id: String(id),
          tenant_id: String(q.tenant_id || 'propietario'),
          titulo: String(q.titulo || q.title || ''),
          fecha: String(q.fecha || q.date || new Date().toISOString()),
          participantes: JSON.stringify(q.participantes || []),
          descripcion: q.descripcion || null,
          creado_en: String(q.creado_en || new Date().toISOString())
        });
        stats.quedadas++;
      }
    }

    // 7. Ideas (ideas.json)
    const ideas = leerJsonSeguro(path.join(dataDir, 'ideas.json'));
    if (Array.isArray(ideas)) {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO ideas (id, tenant_id, texto, prioridad, tags, creada_en)
        VALUES (@id, @tenant_id, @texto, @prioridad, @tags, @creada_en)
      `);
      for (const idea of ideas) {
        if (!idea.id && !idea.texto) continue;
        const id = idea.id || `idea_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        stmt.run({
          id: String(id),
          tenant_id: String(idea.tenant_id || 'propietario'),
          texto: String(idea.texto || idea.text || ''),
          prioridad: String(idea.prioridad || 'media'),
          tags: JSON.stringify(idea.tags || []),
          creada_en: String(idea.creada_en || new Date().toISOString())
        });
        stats.ideas++;
      }
    }

    // 8. Entregas (entregas.json)
    const entregas = leerJsonSeguro(path.join(dataDir, 'entregas.json'));
    if (Array.isArray(entregas)) {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO estudio_entregas (id, tenant_id, asignatura, descripcion, fecha_limite, completada, creada_en)
        VALUES (@id, @tenant_id, @asignatura, @descripcion, @fecha_limite, @completada, @creada_en)
      `);
      for (const e of entregas) {
        if (!e.id && !e.asignatura) continue;
        const id = e.id || `ent_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        stmt.run({
          id: String(id),
          tenant_id: String(e.tenant_id || 'propietario'),
          asignatura: String(e.asignatura || 'General'),
          descripcion: String(e.descripcion || ''),
          fecha_limite: String(e.fecha_limite || e.fecha || new Date().toISOString()),
          completada: e.completada ? 1 : 0,
          creada_en: String(e.creada_en || new Date().toISOString())
        });
        stats.entregas++;
      }
    }

    // 9. Flashcards (flashcards.json)
    const flashcards = leerJsonSeguro(path.join(dataDir, 'flashcards.json'));
    if (Array.isArray(flashcards)) {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO estudio_flashcards (id, tenant_id, asignatura, pregunta, respuesta, proximo_repaso, intervalo_dias, facilidad, repeticiones, creada_en)
        VALUES (@id, @tenant_id, @asignatura, @pregunta, @respuesta, @proximo_repaso, @intervalo_dias, @facilidad, @repeticiones, @creada_en)
      `);
      for (const f of flashcards) {
        if (!f.id && !f.pregunta) continue;
        const id = f.id || `fc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        stmt.run({
          id: String(id),
          tenant_id: String(f.tenant_id || 'propietario'),
          asignatura: String(f.asignatura || 'General'),
          pregunta: String(f.pregunta || ''),
          respuesta: String(f.respuesta || ''),
          proximo_repaso: String(f.proximo_repaso || f.nextReview || new Date().toISOString()),
          intervalo_dias: parseInt(f.intervalo_dias || f.interval || 1, 10),
          facilidad: parseFloat(f.facilidad || f.easeFactor || 2.5),
          repeticiones: parseInt(f.repeticiones || f.repetitions || 0, 10),
          creada_en: String(f.creada_en || new Date().toISOString())
        });
        stats.flashcards++;
      }
    }

    // 10. Articulos vigilados (tracked_items.json)
    const tracked = leerJsonSeguro(path.join(dataDir, 'tracked_items.json'));
    if (Array.isArray(tracked)) {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO articulos_vigilados (id, tenant_id, url, titulo, precio_objetivo, precio_actual, activo, creado_en)
        VALUES (@id, @tenant_id, @url, @titulo, @precio_objetivo, @precio_actual, @activo, @creado_en)
      `);
      for (const t of tracked) {
        if (!t.id && !t.url) continue;
        const id = t.id || `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        stmt.run({
          id: String(id),
          tenant_id: String(t.tenant_id || 'propietario'),
          url: String(t.url || ''),
          titulo: t.titulo || t.title || null,
          precio_objetivo: t.precio_objetivo || t.target_price || null,
          precio_actual: t.precio_actual || t.current_price || null,
          activo: t.activo !== false ? 1 : 0,
          creado_en: String(t.creado_en || new Date().toISOString())
        });
        stats.articulos_vigilados++;
      }
    }

    // 11. Mensajes programados (scheduled_messages.json)
    const scheduled = leerJsonSeguro(path.join(dataDir, 'scheduled_messages.json'));
    if (Array.isArray(scheduled)) {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO mensajes_programados (id, tenant_id, jid, mensaje, fecha_envio, estado, creado_en)
        VALUES (@id, @tenant_id, @jid, @mensaje, @fecha_envio, @estado, @creado_en)
      `);
      for (const m of scheduled) {
        if (!m.id && !m.jid) continue;
        const id = m.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        stmt.run({
          id: String(id),
          tenant_id: String(m.tenant_id || 'propietario'),
          jid: String(m.jid || ''),
          mensaje: String(m.mensaje || m.text || ''),
          fecha_envio: String(m.fecha_envio || m.sendAt || new Date().toISOString()),
          estado: String(m.estado || m.status || 'pendiente'),
          creado_en: String(m.creado_en || new Date().toISOString())
        });
        stats.mensajes_programados++;
      }
    }
  });

  migrarLote.immediate();
  db.close();

  console.log('[Migracion] Resumen de registros migrados a SQLite:', stats);
  return stats;
}

if (process.argv[1] && process.argv[1].endsWith('migrar_json_a_sqlite.js')) {
  try {
    migrarTodoASqlite();
    console.log('[Migracion] Finalizada con exito.');
  } catch (err) {
    console.error('[Migracion] Error critico durante migracion:', err);
    process.exit(1);
  }
}
