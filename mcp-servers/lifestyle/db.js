/**
 * db.js - Modulo de persistencia SQLite para habitos y lista de compra de mcp-server-lifestyle.
 *
 * Tablas:
 *   habitos: id, nombre, marcas, creado_en.
 *   compra_items: id, item, comprado, creado_en.
 *
 * Soporte dual: better-sqlite3 nativo o node:sqlite integrado con adaptador compatible.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const RUTA_DB_POR_DEFECTO = path.resolve(__dirname, '../../data/lifestyle.db');

let DatabaseDriver;
try {
  const mod = (await import('better-sqlite3')).default;
  const probe = new mod(':memory:');
  probe.close();
  DatabaseDriver = mod;
} catch (_) {
  const { DatabaseSync } = await import('node:sqlite');
  DatabaseDriver = class BetterSqliteCompat extends DatabaseSync {
    pragma(instruccion) {
      return this.exec(`PRAGMA ${instruccion}`);
    }
    transaction(fn) {
      return (...args) => {
        this.exec('BEGIN IMMEDIATE');
        try {
          const resultado = fn(...args);
          this.exec('COMMIT');
          return resultado;
        } catch (error) {
          try {
            this.exec('ROLLBACK');
          } catch (_) {}
          throw error;
        }
      };
    }
  };
}

export { DatabaseDriver };

/**
 * Devuelve la fecha de hoy en formato YYYY-MM-DD.
 */
export function fechaHoy(referencia = new Date()) {
  return new Date(referencia).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
}

/**
 * Calcula la racha consecutiva de dias en que se cumplio un habito.
 */
export function calcularRacha(marcas, hoyStr) {
  if (!Array.isArray(marcas) || marcas.length === 0) return 0;
  let r = 0;
  const dia = new Date(`${hoyStr}T12:00:00Z`);
  if (!marcas.includes(hoyStr)) {
    dia.setUTCDate(dia.getUTCDate() - 1);
  }
  for (;;) {
    const clave = dia.toISOString().slice(0, 10);
    if (!marcas.includes(clave)) break;
    r++;
    dia.setUTCDate(dia.getUTCDate() - 1);
  }
  return r;
}

/**
 * Inicializa la base de datos de habitos y lista de compra.
 */
export function crearLifestyleDb(rutaDb = process.env.LIFESTYLE_DB_PATH || RUTA_DB_POR_DEFECTO) {
  if (rutaDb !== ':memory:') {
    fs.mkdirSync(path.dirname(rutaDb), { recursive: true });
  }

  const db = new DatabaseDriver(rutaDb);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS habitos (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL UNIQUE,
      marcas TEXT NOT NULL DEFAULT '[]',
      creado_en TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS compra_items (
      id TEXT PRIMARY KEY,
      item TEXT NOT NULL,
      comprado INTEGER NOT NULL DEFAULT 0,
      creado_en TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_compra_comprado ON compra_items(comprado);
  `);

  /* ------------------- Metodos de Habitos ------------------- */

  function registrarHabito({ nombre } = {}) {
    const n = String(nombre || '').trim();
    if (!n) {
      throw new Error('El parametro nombre es obligatorio para registrar un habito');
    }
    if (n.length > 80) {
      throw new Error('El nombre del habito excede el limite maximo de 80 caracteres');
    }

    const existente = db.prepare('SELECT id, nombre FROM habitos WHERE lower(nombre) = lower(?)').get(n);
    if (existente) {
      throw new Error(`Ya existe un habito registrado con el nombre "${n}"`);
    }

    const id = `hab_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const creadoEn = new Date().toISOString();
    const marcasJson = JSON.stringify([]);

    db.prepare(`
      INSERT INTO habitos (id, nombre, marcas, creado_en)
      VALUES (?, ?, ?, ?)
    `).run(id, n, marcasJson, creadoEn);

    return {
      ok: true,
      habito: {
        id,
        nombre: n,
        marcas: [],
        creado_en: creadoEn
      }
    };
  }

  function marcarHabito({ criterio, fecha, hoy } = {}) {
    const c = String(criterio || '').trim().toLowerCase();
    if (!c) {
      throw new Error('El parametro criterio (id o nombre) es obligatorio para marcar un habito');
    }

    const fechaHoyStr = hoy || fechaHoy();
    const f = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || '')) ? fecha : fechaHoyStr;

    const filas = db.prepare('SELECT id, nombre, marcas, creado_en FROM habitos').all();
    const habito = filas.find((h) => h.id === criterio || h.nombre.toLowerCase().includes(c));

    if (!habito) {
      throw new Error(`No se encontro ningun habito que coincida con "${criterio}"`);
    }

    let marcas = [];
    try {
      marcas = JSON.parse(habito.marcas);
    } catch (_) {}

    if (marcas.includes(f)) {
      throw new Error(`El habito "${habito.nombre}" ya estaba marcado en la fecha ${f}`);
    }

    marcas.push(f);
    marcas.sort();

    db.prepare('UPDATE habitos SET marcas = ? WHERE id = ?').run(JSON.stringify(marcas), habito.id);

    const rachaActual = calcularRacha(marcas, fechaHoyStr);

    return {
      ok: true,
      habito: {
        id: habito.id,
        nombre: habito.nombre,
        marcas,
        creado_en: habito.creado_en
      },
      fecha_marcada: f,
      racha: rachaActual,
      total_dias: marcas.length
    };
  }

  function listarHabitos({ hoy } = {}) {
    const fechaHoyStr = hoy || fechaHoy();
    const filas = db.prepare('SELECT id, nombre, marcas, creado_en FROM habitos ORDER BY nombre ASC').all();

    const habitos = filas.map((h) => {
      let marcas = [];
      try {
        marcas = JSON.parse(h.marcas);
      } catch (_) {}

      return {
        id: h.id,
        nombre: h.nombre,
        hecho_hoy: marcas.includes(fechaHoyStr),
        racha: calcularRacha(marcas, fechaHoyStr),
        total_dias: marcas.length
      };
    });

    return {
      ok: true,
      total: habitos.length,
      habitos
    };
  }

  /* ------------------- Metodos de Lista de Compra ------------------- */

  function anadirCompra({ item, items } = {}) {
    const lista = (Array.isArray(items) ? items : [item])
      .map((i) => String(i || '').trim().slice(0, 80))
      .filter(Boolean);

    if (lista.length === 0) {
      throw new Error('Debe proporcionar al menos un item para anadir a la lista de compra');
    }

    const pendientes = db.prepare('SELECT item FROM compra_items WHERE comprado = 0').all();
    const unicosPendientes = new Set(pendientes.map((p) => p.item.toLowerCase()));

    const anadidos = [];
    const creadoEn = new Date().toISOString();

    const insertStmt = db.prepare(`
      INSERT INTO compra_items (id, item, comprado, creado_en)
      VALUES (?, ?, 0, ?)
    `);

    for (const nombreItem of lista) {
      if (unicosPendientes.has(nombreItem.toLowerCase())) continue;
      const id = `cmp_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      insertStmt.run(id, nombreItem, creadoEn);
      unicosPendientes.add(nombreItem.toLowerCase());
      anadidos.push(nombreItem);
    }

    const totalPendientes = db.prepare('SELECT COUNT(*) as count FROM compra_items WHERE comprado = 0').get().count;

    return {
      ok: true,
      anadidos,
      total_pendientes: totalPendientes
    };
  }

  function listarCompra() {
    const filas = db.prepare('SELECT id, item, creado_en FROM compra_items WHERE comprado = 0 ORDER BY creado_en ASC').all();
    return {
      ok: true,
      total: filas.length,
      items: filas.map((f) => f.item),
      detalles: filas
    };
  }

  function tacharCompra({ criterio } = {}) {
    const c = String(criterio || '').trim().toLowerCase();
    if (!c) {
      throw new Error('El parametro criterio es obligatorio para tachar un item');
    }

    const pendientes = db.prepare('SELECT id, item FROM compra_items WHERE comprado = 0').all();
    const encontrado = pendientes.find((p) => p.id === criterio || p.item.toLowerCase().includes(c));

    if (!encontrado) {
      throw new Error(`No se encontro ningun item pendiente que coincida con "${criterio}"`);
    }

    db.prepare('UPDATE compra_items SET comprado = 1 WHERE id = ?').run(encontrado.id);

    const totalPendientes = db.prepare('SELECT COUNT(*) as count FROM compra_items WHERE comprado = 0').get().count;

    return {
      ok: true,
      tachado: encontrado.item,
      total_pendientes: totalPendientes
    };
  }

  function vaciarCompra() {
    const info = db.prepare('DELETE FROM compra_items WHERE comprado = 0').run();
    return {
      ok: true,
      eliminados: info.changes ?? 0
    };
  }

  function cerrar() {
    try {
      db.close();
    } catch (_) {}
  }

  return {
    registrarHabito,
    marcarHabito,
    listarHabitos,
    anadirCompra,
    listarCompra,
    tacharCompra,
    vaciarCompra,
    cerrar,
    db
  };
}
