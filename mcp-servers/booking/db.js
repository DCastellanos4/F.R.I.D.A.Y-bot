/**
 * db.js - Modulo de persistencia SQLite y logica de reservas para mcp-server-booking.
 *
 * Tablas:
 *   citas: id, cliente_nombre, cliente_telefono, fecha_inicio, duracion_minutos,
 *          servicio, estado, creado_en.
 *
 * Logica de huecos y reservas libre de colisiones en horario comercial (09:00 - 20:00).
 *
 * Soporte dual: better-sqlite3 nativo cuando este compilado; respaldo automatico
 * en node:sqlite con adaptador compatible para portabilidad completa.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const RUTA_DB_POR_DEFECTO = path.resolve(__dirname, '../../data/booking.db');

export const HORARIO_COMERCIAL_DEFECTO = {
  hora_apertura: '09:00',
  hora_cierre: '20:00',
  duracion_minutos_defecto: 30,
  paso_minutos_defecto: 30
};

// Carga resiliente del motor SQLite
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
 * Normaliza y valida una cadena de fecha a formato ISO 8601 UTC.
 * Si no incluye zona horaria explicita, se interpreta en UTC para garantizar consistencia.
 */
export function normalizarFechaIso(fechaInput) {
  if (!fechaInput || typeof fechaInput !== 'string') {
    throw new Error('fecha_inicio debe ser una cadena en formato ISO 8601');
  }
  const str = fechaInput.trim();
  const tieneZona = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(str);
  const candidatoIso = tieneZona ? str : `${str}Z`;
  const fechaObj = new Date(candidatoIso);
  if (isNaN(fechaObj.getTime())) {
    throw new Error(`Fecha invalida: ${fechaInput}`);
  }
  return fechaObj.toISOString();
}

/**
 * Convierte una hora 'HH:MM' a minutos transcurridos desde medianoche.
 */
export function horaAMinutos(horaStr) {
  if (!horaStr || typeof horaStr !== 'string' || !/^\d{1,2}:\d{2}$/.test(horaStr.trim())) {
    throw new Error(`Formato de hora invalido: ${horaStr}. Se esperaba HH:MM`);
  }
  const [h, m] = horaStr.trim().split(':').map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) {
    throw new Error(`Valores de hora fuera de rango: ${horaStr}`);
  }
  return h * 60 + m;
}

/**
 * Inicializa y retorna la instancia de base de datos de reservas.
 */
export function crearBookingDb(rutaDb = process.env.BOOKING_DB_PATH || RUTA_DB_POR_DEFECTO) {
  if (rutaDb !== ':memory:') {
    fs.mkdirSync(path.dirname(rutaDb), { recursive: true });
  }

  const db = new DatabaseDriver(rutaDb);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  // Inicializacion del esquema
  db.exec(`
    CREATE TABLE IF NOT EXISTS citas (
      id TEXT PRIMARY KEY,
      cliente_nombre TEXT NOT NULL,
      cliente_telefono TEXT NOT NULL,
      fecha_inicio TEXT NOT NULL,
      duracion_minutos INTEGER NOT NULL,
      servicio TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'confirmada',
      creado_en TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_citas_fecha_inicio ON citas(fecha_inicio);
    CREATE INDEX IF NOT EXISTS idx_citas_cliente_telefono ON citas(cliente_telefono);
    CREATE INDEX IF NOT EXISTS idx_citas_estado ON citas(estado);
  `);

  /**
   * Consulta disponibilidad de huecos sin colisiones en una fecha dada.
   */
  function consultarDisponibilidad({
    fecha,
    duracion_minutos = HORARIO_COMERCIAL_DEFECTO.duracion_minutos_defecto,
    hora_apertura = HORARIO_COMERCIAL_DEFECTO.hora_apertura,
    hora_cierre = HORARIO_COMERCIAL_DEFECTO.hora_cierre,
    paso_minutos = HORARIO_COMERCIAL_DEFECTO.paso_minutos_defecto
  } = {}) {
    if (!fecha || typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha.trim())) {
      throw new Error('fecha debe tener formato YYYY-MM-DD');
    }
    const fechaStr = fecha.trim();
    const duracion = Number(duracion_minutos);
    if (!Number.isInteger(duracion) || duracion <= 0) {
      throw new Error('duracion_minutos debe ser un entero positivo');
    }
    const paso = Number(paso_minutos);
    if (!Number.isInteger(paso) || paso <= 0) {
      throw new Error('paso_minutos debe ser un entero positivo');
    }

    const aperturaMin = horaAMinutos(hora_apertura);
    const cierreMin = horaAMinutos(hora_cierre);
    const maxDuracionPermitida = cierreMin - aperturaMin;

    if (duracion > maxDuracionPermitida) {
      throw new Error(`duracion_minutos (${duracion}) excede la duracion maxima permitida (${maxDuracionPermitida} min)`);
    }
    if (aperturaMin >= cierreMin) {
      throw new Error('hora_apertura debe ser anterior a hora_cierre');
    }

    // Busqueda de citas confirmadas que puedan superponerse a la fecha
    const ventanaInicioIso = new Date(Date.parse(`${fechaStr}T00:00:00.000Z`) - 24 * 3600 * 1000).toISOString();
    const ventanaFinIso = new Date(Date.parse(`${fechaStr}T23:59:59.999Z`) + 24 * 3600 * 1000).toISOString();

    const citasExistentes = db.prepare(`
      SELECT id, cliente_nombre, cliente_telefono, fecha_inicio, duracion_minutos, servicio, estado
      FROM citas
      WHERE estado = 'confirmada'
        AND fecha_inicio >= ?
        AND fecha_inicio <= ?
    `).all(ventanaInicioIso, ventanaFinIso);

    const citasMs = citasExistentes.map((c) => {
      const s = new Date(c.fecha_inicio).getTime();
      return {
        id: c.id,
        startMs: s,
        endMs: s + c.duracion_minutos * 60000,
        servicio: c.servicio
      };
    });

    const huecos_disponibles = [];
    for (let m = aperturaMin; m + duracion <= cierreMin; m += paso) {
      const hInicio = Math.floor(m / 60);
      const minInicio = m % 60;
      const mFin = m + duracion;
      const hFin = Math.floor(mFin / 60);
      const minFin = mFin % 60;

      const horaInicioStr = `${String(hInicio).padStart(2, '0')}:${String(minInicio).padStart(2, '0')}`;
      const horaFinStr = `${String(hFin).padStart(2, '0')}:${String(minFin).padStart(2, '0')}`;
      const slotInicioIso = `${fechaStr}T${horaInicioStr}:00.000Z`;
      const slotFinIso = `${fechaStr}T${horaFinStr}:00.000Z`;

      const slotStartMs = new Date(slotInicioIso).getTime();
      const slotEndMs = new Date(slotFinIso).getTime();

      const colisiona = citasMs.some((c) => slotStartMs < c.endMs && slotEndMs > c.startMs);
      if (!colisiona) {
        huecos_disponibles.push({
          inicio: slotInicioIso,
          fin: slotFinIso,
          hora_inicio: horaInicioStr,
          hora_fin: horaFinStr
        });
      }
    }

    return {
      ok: true,
      fecha: fechaStr,
      duracion_minutos: duracion,
      horario_comercial: {
        apertura: hora_apertura,
        cierre: hora_cierre
      },
      total_disponibles: huecos_disponibles.length,
      huecos_disponibles
    };
  }

  /**
   * Reserva una nueva cita de manera atomica comprobando ausencia de colisiones.
   */
  function reservarCita({
    cliente_nombre,
    cliente_telefono,
    fecha_inicio,
    duracion_minutos = HORARIO_COMERCIAL_DEFECTO.duracion_minutos_defecto,
    servicio,
    hora_apertura = HORARIO_COMERCIAL_DEFECTO.hora_apertura,
    hora_cierre = HORARIO_COMERCIAL_DEFECTO.hora_cierre
  } = {}) {
    if (!cliente_nombre || typeof cliente_nombre !== 'string' || !cliente_nombre.trim()) {
      throw new Error('cliente_nombre es obligatorio y no puede estar vacio');
    }
    if (!cliente_telefono || typeof cliente_telefono !== 'string' || !cliente_telefono.trim()) {
      throw new Error('cliente_telefono es obligatorio y no puede estar vacio');
    }
    if (!fecha_inicio || typeof fecha_inicio !== 'string') {
      throw new Error('fecha_inicio es obligatorio y debe ser formato ISO 8601');
    }
    const fechaInicioIso = normalizarFechaIso(fecha_inicio);
    const duracion = Number(duracion_minutos);
    if (!Number.isInteger(duracion) || duracion <= 0) {
      throw new Error('duracion_minutos debe ser un entero positivo');
    }
    if (!servicio || typeof servicio !== 'string' || !servicio.trim()) {
      throw new Error('servicio es obligatorio y no puede estar vacio');
    }

    const dInicio = new Date(fechaInicioIso);
    const inicioMinutosDia = dInicio.getUTCHours() * 60 + dInicio.getUTCMinutes();
    const finMinutosDia = inicioMinutosDia + duracion;

    const aperturaMin = horaAMinutos(hora_apertura);
    const cierreMin = horaAMinutos(hora_cierre);
    const maxDuracionPermitida = cierreMin - aperturaMin;

    if (duracion > maxDuracionPermitida) {
      throw new Error(`duracion_minutos (${duracion}) excede la duracion maxima permitida (${maxDuracionPermitida} min)`);
    }

    if (inicioMinutosDia < aperturaMin || finMinutosDia > cierreMin) {
      const horaInicioTexto = `${String(Math.floor(inicioMinutosDia / 60)).padStart(2, '0')}:${String(inicioMinutosDia % 60).padStart(2, '0')}`;
      const horaFinTexto = `${String(Math.floor(finMinutosDia / 60)).padStart(2, '0')}:${String(finMinutosDia % 60).padStart(2, '0')}`;
      throw new Error(`La cita solicitada (${horaInicioTexto} - ${horaFinTexto}) queda fuera del horario comercial (${hora_apertura} - ${hora_cierre})`);
    }

    const transaccion = db.transaction(() => {
      const reqStartMs = dInicio.getTime();
      const reqEndMs = reqStartMs + duracion * 60000;

      const ventanaInicio = new Date(reqStartMs - 24 * 3600 * 1000).toISOString();
      const ventanaFin = new Date(reqEndMs + 24 * 3600 * 1000).toISOString();

      const citasActivas = db.prepare(`
        SELECT id, cliente_nombre, cliente_telefono, fecha_inicio, duracion_minutos, servicio, estado
        FROM citas
        WHERE estado = 'confirmada'
          AND fecha_inicio >= ?
          AND fecha_inicio <= ?
      `).all(ventanaInicio, ventanaFin);

      for (const cita of citasActivas) {
        const citaStartMs = new Date(cita.fecha_inicio).getTime();
        const citaEndMs = citaStartMs + (cita.duracion_minutos * 60000);
        if (reqStartMs < citaEndMs && reqEndMs > citaStartMs) {
          throw new Error(`Conflicto de horario: ya existe una cita confirmada en el intervalo solicitado (Inicio: ${cita.fecha_inicio}, Duracion: ${cita.duracion_minutos} min, Servicio: ${cita.servicio})`);
        }
      }

      const id = crypto.randomUUID();
      const creado_en = new Date().toISOString();

      db.prepare(`
        INSERT INTO citas (id, cliente_nombre, cliente_telefono, fecha_inicio, duracion_minutos, servicio, estado, creado_en)
        VALUES (?, ?, ?, ?, ?, ?, 'confirmada', ?)
      `).run(
        id,
        cliente_nombre.trim(),
        cliente_telefono.trim(),
        fechaInicioIso,
        duracion,
        servicio.trim(),
        creado_en
      );

      return {
        id,
        cliente_nombre: cliente_nombre.trim(),
        cliente_telefono: cliente_telefono.trim(),
        fecha_inicio: fechaInicioIso,
        duracion_minutos: duracion,
        servicio: servicio.trim(),
        estado: 'confirmada',
        creado_en
      };
    });

    const citaCreada = transaccion();
    return {
      ok: true,
      mensaje: 'Cita reservada exitosamente',
      cita: citaCreada
    };
  }

  /**
   * Cancela una cita por cita_id o por combinacion de telefono y fecha.
   */
  function cancelarCita({ cita_id, id, cliente_telefono, telefono, fecha, fecha_inicio } = {}) {
    const targetId = cita_id || id;
    const targetPhone = cliente_telefono || telefono;
    const targetFecha = fecha || fecha_inicio;

    if (targetId) {
      const transaccionId = db.transaction(() => {
        const cita = db.prepare('SELECT * FROM citas WHERE id = ?').get(targetId);
        if (!cita) {
          return { ok: false, error: `No se encontro ninguna cita con id: ${targetId}` };
        }
        if (cita.estado === 'cancelada') {
          return { ok: false, error: 'La cita ya se encuentra cancelada', cita };
        }
        db.prepare("UPDATE citas SET estado = 'cancelada' WHERE id = ?").run(targetId);
        const citaActualizada = db.prepare('SELECT * FROM citas WHERE id = ?').get(targetId);
        return { ok: true, mensaje: 'Cita cancelada exitosamente', cita: citaActualizada };
      });
      return transaccionId();
    }

    if (targetPhone && targetFecha) {
      const phone = String(targetPhone).trim();
      const phoneSinEspacios = phone.replace(/\s+/g, '');
      const fechaPrefijo = String(targetFecha).trim().slice(0, 10);

      const transaccionTelefono = db.transaction(() => {
        const citas = db.prepare(`
          SELECT * FROM citas
          WHERE (cliente_telefono = ? OR cliente_telefono = ?)
            AND fecha_inicio LIKE ?
            AND estado = 'confirmada'
        `).all(phone, phoneSinEspacios, `${fechaPrefijo}%`);

        if (citas.length === 0) {
          return {
            ok: false,
            error: `No se encontraron citas confirmadas para telefono ${targetPhone} en fecha ${targetFecha}`
          };
        }

        for (const c of citas) {
          db.prepare("UPDATE citas SET estado = 'cancelada' WHERE id = ?").run(c.id);
        }

        const ids = citas.map((c) => c.id);
        const citasActualizadas = db.prepare(`
          SELECT * FROM citas WHERE id IN (${ids.map(() => '?').join(',')})
        `).all(...ids);

        return {
          ok: true,
          mensaje: `Se cancelaron ${citas.length} cita(s) exitosamente`,
          citas_canceladas: citasActualizadas
        };
      });
      return transaccionTelefono();
    }

    throw new Error('cancelar_cita requiere cita_id o (cliente_telefono y fecha)');
  }

  /**
   * Lista citas con filtros opcionales.
   */
  function listarCitas({ fecha, cliente_telefono, telefono, estado } = {}) {
    let sql = 'SELECT * FROM citas WHERE 1=1';
    const params = [];

    if (fecha && typeof fecha === 'string') {
      sql += ' AND fecha_inicio LIKE ?';
      params.push(`${fecha.trim().slice(0, 10)}%`);
    }

    const tel = (cliente_telefono || telefono || '').toString().trim();
    if (tel) {
      sql += ' AND (cliente_telefono = ? OR cliente_telefono = ?)';
      params.push(tel, tel.replace(/\s+/g, ''));
    }

    if (estado && typeof estado === 'string') {
      sql += ' AND estado = ?';
      params.push(estado.trim());
    }

    sql += ' ORDER BY fecha_inicio ASC';
    const citas = db.prepare(sql).all(...params);

    return {
      ok: true,
      total: citas.length,
      citas
    };
  }

  /**
   * Obtiene una cita por su identificador unico.
   */
  function obtenerCitaPorId(id) {
    if (!id || typeof id !== 'string') return null;
    return db.prepare('SELECT * FROM citas WHERE id = ?').get(id) || null;
  }

  /**
   * Cierra la conexion a la base de datos.
   */
  function cerrar() {
    try {
      db.close();
    } catch (_) {}
  }

  return {
    consultarDisponibilidad,
    reservarCita,
    cancelarCita,
    listarCitas,
    obtenerCitaPorId,
    cerrar,
    db
  };
}
