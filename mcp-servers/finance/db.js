/**
 * db.js - Modulo de persistencia SQLite y calculo contable para mcp-server-finance.
 *
 * Tablas:
 *   gastos: id, monto, categoria, concepto, fecha, base, iva, creado_en.
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
export const RUTA_DB_POR_DEFECTO = path.resolve(__dirname, '../../data/finance.db');

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
 * Valida y normaliza un importe numerico en euros.
 */
export function normalizarMonto(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0 || n >= 100000000) {
    throw new Error('monto debe ser un numero positivo finito menor a 100.000.000');
  }
  return Math.round(n * 100) / 100;
}

/**
 * Normaliza y valida una fecha YYYY-MM-DD.
 */
export function normalizarFecha(fechaInput) {
  if (!fechaInput) {
    return new Date().toISOString().slice(0, 10);
  }
  const limpia = String(fechaInput).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(limpia)) {
    throw new Error(`Fecha invalida: ${fechaInput}. Se esperaba formato YYYY-MM-DD`);
  }
  const d = new Date(`${limpia}T00:00:00Z`);
  if (isNaN(d.getTime())) {
    throw new Error(`Fecha no parseable: ${fechaInput}`);
  }
  return limpia;
}

/**
 * Normaliza el trimestre a formato 'T1', 'T2', 'T3', 'T4'.
 */
export function normalizarTrimestre(trimestreInput) {
  if (trimestreInput === undefined || trimestreInput === null || trimestreInput === '') {
    return null;
  }
  const str = String(trimestreInput).trim().toUpperCase();
  if (str === '1' || str === 'T1' || str === 'Q1') return 'T1';
  if (str === '2' || str === 'T2' || str === 'Q2') return 'T2';
  if (str === '3' || str === 'T3' || str === 'Q3') return 'T3';
  if (str === '4' || str === 'T4' || str === 'Q4') return 'T4';
  throw new Error(`Trimestre invalido: ${trimestreInput}. Se esperaba 1..4, T1..T4 o Q1..Q4`);
}

/**
 * Crea e inicializa la base de datos contable de finanzas.
 */
export function crearFinanceDb(rutaDb = process.env.FINANCE_DB_PATH || RUTA_DB_POR_DEFECTO) {
  if (rutaDb !== ':memory:') {
    fs.mkdirSync(path.dirname(rutaDb), { recursive: true });
  }

  const db = new DatabaseDriver(rutaDb);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS gastos (
      id TEXT PRIMARY KEY,
      monto REAL NOT NULL,
      categoria TEXT NOT NULL,
      concepto TEXT NOT NULL,
      fecha TEXT NOT NULL,
      base REAL NOT NULL,
      iva REAL NOT NULL,
      creado_en TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gastos_fecha ON gastos(fecha);
    CREATE INDEX IF NOT EXISTS idx_gastos_categoria ON gastos(categoria);
  `);

  /**
   * Registra un gasto contable en la base de datos SQLite.
   */
  function registrarGasto({
    monto,
    importe,
    categoria,
    concepto,
    comercio,
    fecha,
    base,
    iva
  } = {}) {
    const montoFinal = normalizarMonto(monto ?? importe);

    if (!categoria || typeof categoria !== 'string' || !categoria.trim()) {
      throw new Error('categoria es obligatoria y no puede estar vacia');
    }
    const categoriaNormalizada = categoria.trim().toLowerCase();

    const conceptoFinal = concepto ?? comercio;
    if (!conceptoFinal || typeof conceptoFinal !== 'string' || !conceptoFinal.trim()) {
      throw new Error('concepto es obligatorio y no puede estar vacio');
    }
    const conceptoLimpio = conceptoFinal.trim();

    const fechaFinal = normalizarFecha(fecha);

    let baseFinal;
    let ivaFinal;

    if (base !== undefined && base !== null && iva !== undefined && iva !== null) {
      baseFinal = Math.round(Number(base) * 100) / 100;
      ivaFinal = Math.round(Number(iva) * 100) / 100;
    } else if (base !== undefined && base !== null) {
      baseFinal = Math.round(Number(base) * 100) / 100;
      ivaFinal = Math.round((montoFinal - baseFinal) * 100) / 100;
    } else if (iva !== undefined && iva !== null) {
      ivaFinal = Math.round(Number(iva) * 100) / 100;
      baseFinal = Math.round((montoFinal - ivaFinal) * 100) / 100;
    } else {
      // Calculo estandar con IVA al 21%
      baseFinal = Math.round((montoFinal / 1.21) * 100) / 100;
      ivaFinal = Math.round((montoFinal - baseFinal) * 100) / 100;
    }

    const id = `gasto_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const creadoEn = new Date().toISOString();

    const transaccion = db.transaction(() => {
      db.prepare(`
        INSERT INTO gastos (id, monto, categoria, concepto, fecha, base, iva, creado_en)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        montoFinal,
        categoriaNormalizada,
        conceptoLimpio,
        fechaFinal,
        baseFinal,
        ivaFinal,
        creadoEn
      );

      return {
        id,
        monto: montoFinal,
        categoria: categoriaNormalizada,
        concepto: conceptoLimpio,
        fecha: fechaFinal,
        base: baseFinal,
        iva: ivaFinal,
        creado_en: creadoEn
      };
    });

    const gastoCreado = transaccion();
    return {
      ok: true,
      gasto: gastoCreado
    };
  }

  /**
   * Exporta el resumen contable agrupado por trimestre para un ano fiscal.
   */
  function exportarResumenTrimestral({ anio, trimestre } = {}) {
    const anioNum = Number(anio || new Date().getFullYear());
    if (!Number.isInteger(anioNum) || anioNum < 2000 || anioNum > 2100) {
      throw new Error(`anio invalido: ${anio}. Debe ser un entero entre 2000 y 2100`);
    }

    const trimestreSolicitado = normalizarTrimestre(trimestre);

    const inicioAnio = `${anioNum}-01-01`;
    const finAnio = `${anioNum}-12-31`;

    const filas = db.prepare(`
      SELECT id, monto, categoria, concepto, fecha, base, iva, creado_en
      FROM gastos
      WHERE fecha >= ? AND fecha <= ?
      ORDER BY fecha ASC
    `).all(inicioAnio, finAnio);

    const trimestres = {
      T1: { total: 0, base: 0, iva: 0, num_gastos: 0, por_categoria: {} },
      T2: { total: 0, base: 0, iva: 0, num_gastos: 0, por_categoria: {} },
      T3: { total: 0, base: 0, iva: 0, num_gastos: 0, por_categoria: {} },
      T4: { total: 0, base: 0, iva: 0, num_gastos: 0, por_categoria: {} }
    };

    for (const fila of filas) {
      const mes = Number(fila.fecha.slice(5, 7));
      let claveT = 'T1';
      if (mes >= 1 && mes <= 3) claveT = 'T1';
      else if (mes >= 4 && mes <= 6) claveT = 'T2';
      else if (mes >= 7 && mes <= 9) claveT = 'T3';
      else if (mes >= 10 && mes <= 12) claveT = 'T4';

      const tObj = trimestres[claveT];
      tObj.total = Math.round((tObj.total + fila.monto) * 100) / 100;
      tObj.base = Math.round((tObj.base + fila.base) * 100) / 100;
      tObj.iva = Math.round((tObj.iva + fila.iva) * 100) / 100;
      tObj.num_gastos += 1;

      const cat = fila.categoria;
      tObj.por_categoria[cat] = Math.round(((tObj.por_categoria[cat] || 0) + fila.monto) * 100) / 100;
    }

    const totalAnual = Math.round((trimestres.T1.total + trimestres.T2.total + trimestres.T3.total + trimestres.T4.total) * 100) / 100;
    const baseAnual = Math.round((trimestres.T1.base + trimestres.T2.base + trimestres.T3.base + trimestres.T4.base) * 100) / 100;
    const ivaAnual = Math.round((trimestres.T1.iva + trimestres.T2.iva + trimestres.T3.iva + trimestres.T4.iva) * 100) / 100;
    const numGastosAnual = trimestres.T1.num_gastos + trimestres.T2.num_gastos + trimestres.T3.num_gastos + trimestres.T4.num_gastos;

    const resultado = {
      ok: true,
      anio: anioNum,
      trimestres,
      resumen_anual: {
        total: totalAnual,
        base: baseAnual,
        iva: ivaAnual,
        num_gastos: numGastosAnual
      }
    };

    if (trimestreSolicitado) {
      resultado.trimestre_solicitado = trimestreSolicitado;
      resultado.detalle_trimestre = trimestres[trimestreSolicitado];
    }

    return resultado;
  }

  /**
   * Lista gastos registrados con filtros opcionales.
   */
  function listarGastos({ anio, mes, categoria } = {}) {
    let sql = 'SELECT * FROM gastos WHERE 1=1';
    const params = [];

    if (anio) {
      sql += ' AND fecha >= ? AND fecha <= ?';
      params.push(`${anio}-01-01`, `${anio}-12-31`);
    }
    if (mes) {
      sql += ' AND substr(fecha, 1, 7) = ?';
      params.push(String(mes));
    }
    if (categoria) {
      sql += ' AND categoria = ?';
      params.push(String(categoria).toLowerCase());
    }

    sql += ' ORDER BY fecha DESC';
    return db.prepare(sql).all(...params);
  }

  function cerrar() {
    try {
      db.close();
    } catch (_) {}
  }

  return {
    registrarGasto,
    exportarResumenTrimestral,
    listarGastos,
    cerrar,
    db
  };
}
