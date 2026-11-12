/**
 * Outbox transaccional sobre SQLite (RF-01 del ERS de proximo nivel).
 *
 * Cada mensaje aceptado por un canal se persiste aqui, en la misma
 * transaccion que el resto de su registro de entrada, ANTES de cualquier
 * procesamiento: una caida del proceso Node, un reinicio de pm2 o del
 * propio servidor nunca pierde un mensaje ya aceptado. Los workers
 * reclaman trabajos de forma atomica (BEGIN IMMEDIATE), guardan
 * checkpoints por ronda y encolan la respuesta de salida con un id
 * determinista por trabajo, de modo que reejecutar un trabajo no duplica
 * la entrega al canal.
 *
 * Estados de outbox_events:
 *   pendiente -> en_curso -> completado
 *     ^            |
 *     |            v (error con reintento: vuelve a pendiente con backoff)
 *     |         fallido (sin mas reintentos)
 *     +--- recuperacion de trabajos en_curso cuyo reclamo expiro
 *          (el worker que los tomo murio antes de terminar).
 *
 * Strict Policy: Zero Emojis.
 */
import crypto from 'node:crypto';
import { TENANT_PROPIETARIO, afirmarTenantId } from '../../../../core/tenancy.js';

const ESTADOS = new Set(['pendiente', 'en_curso', 'completado', 'fallido']);

function aIso(fecha) {
  return (fecha instanceof Date ? fecha : new Date(fecha ?? Date.now())).toISOString();
}

export function crearSqliteOutboxStore(db) {
  if (!db || typeof db.prepare !== 'function') {
    throw new TypeError('crearSqliteOutboxStore requiere una base better-sqlite3 abierta.');
  }

  const insEvento = db.prepare(`
    INSERT INTO outbox_events (id, tenant_id, canal, tipo, payload, estado, intentos, creado_en, disponible_en, transporte)
    VALUES (@id, @tenant_id, @canal, @tipo, @payload, 'pendiente', 0, @ahora, @disponible_en, @transporte)
  `);
  const selPendientes = db.prepare(`
    SELECT id FROM outbox_events
    WHERE estado = 'pendiente' AND claim_token IS NULL AND transporte='sqlite' AND disponible_en <= @ahora
    ORDER BY creado_en, id
    LIMIT @limite
  `);
  const updReclamar = db.prepare(`
    UPDATE outbox_events SET estado = 'en_curso', reclamado_en = @ahora
    WHERE id = @id AND estado = 'pendiente' AND claim_token IS NULL AND transporte='sqlite'
  `);
  const selTrabajo = db.prepare('SELECT * FROM outbox_events WHERE id = ?');
  const updCompletado = db.prepare(`
    UPDATE outbox_events SET estado = 'completado', procesado_en = @ahora, ultimo_error = NULL
    WHERE id = @id AND claim_token IS NULL AND transporte='sqlite'
  `);
  const updFalloReintentable = db.prepare(`
    UPDATE outbox_events
    SET estado = 'pendiente', intentos = intentos + 1, disponible_en = @disponible_en,
        reclamado_en = NULL, ultimo_error = @error
    WHERE id = @id AND claim_token IS NULL AND transporte='sqlite'
  `);
  const updFalloDefinitivo = db.prepare(`
    UPDATE outbox_events
    SET estado = 'fallido', intentos = intentos + 1, procesado_en = @ahora, ultimo_error = @error
    WHERE id = @id AND claim_token IS NULL AND transporte='sqlite'
  `);
  const updRecuperar = db.prepare(`
    UPDATE outbox_events SET estado = 'pendiente', reclamado_en = NULL
    WHERE estado = 'en_curso' AND claim_token IS NULL AND transporte='sqlite' AND reclamado_en < @limiteExpiracion
  `);
  const insCheckpoint = db.prepare(`
    INSERT INTO job_checkpoints (job_id, ronda, estado, creado_en)
    VALUES (@job_id, @ronda, @estado, @ahora)
    ON CONFLICT(job_id, ronda) DO UPDATE SET estado = @estado, creado_en = @ahora
  `);
  const selUltimoCheckpoint = db.prepare(`
    SELECT ronda, estado FROM job_checkpoints WHERE job_id = ? ORDER BY ronda DESC LIMIT 1
  `);
  const selCheckpoints = db.prepare(`
    SELECT ronda, estado, creado_en FROM job_checkpoints WHERE job_id = ? ORDER BY ronda
  `);
  const insRespuesta = db.prepare(`
    INSERT OR IGNORE INTO channel_responses (id, job_id, canal, destinatario, payload, estado, creado_en)
    VALUES (@id, @job_id, @canal, @destinatario, @payload, 'pendiente', @ahora)
  `);
  const selRespuestasPendientes = db.prepare(`
    SELECT * FROM channel_responses
    WHERE estado = 'pendiente' AND (@canal IS NULL OR canal = @canal)
    ORDER BY creado_en, id
    LIMIT @limite
  `);
  const updRespuestaEntregada = db.prepare(`
    UPDATE channel_responses SET estado = 'entregada', entregado_en = @ahora WHERE id = @id
  `);
  const updRespuestaEnviando = db.prepare(`
    UPDATE channel_responses SET estado = 'enviando', enviando_en = @ahora
    WHERE id = @id AND estado = 'pendiente'
  `);
  const updRespuestaVolverPendiente = db.prepare(`
    UPDATE channel_responses SET estado = 'pendiente', enviando_en = NULL
    WHERE id = @id AND estado = 'enviando'
  `);
  const updRespuestaIncerta = db.prepare(`
    UPDATE channel_responses SET estado = 'incierto', enviando_en = NULL
    WHERE id = @id AND estado = 'enviando'
  `);
  const updEnviosIncertos = db.prepare(`
    UPDATE channel_responses SET estado = 'incierto'
    WHERE estado = 'enviando' AND enviando_en < @corte
  `);
  const selRespuestasIncertas = db.prepare(`
    SELECT * FROM channel_responses WHERE estado = 'incierto' ORDER BY creado_en, id LIMIT @limite
  `);
  const selContadores = db.prepare('SELECT estado, COUNT(*) n FROM outbox_events GROUP BY estado');

  function aTrabajo(fila) {
    if (!fila) return null;
    let payload;
    try {
      payload = JSON.parse(fila.payload);
    } catch {
      payload = null;
    }
    return Object.freeze({
      id: fila.id,
      tenantId: fila.tenant_id,
      canal: fila.canal,
      tipo: fila.tipo,
      payload,
      estado: fila.estado,
      intentos: fila.intentos,
      creadoEn: fila.creado_en,
      disponibleEn: fila.disponible_en,
      ultimoError: fila.ultimo_error
    });
  }

  return Object.freeze({
    /**
     * Publica un evento en el outbox. Pensado para ir DENTRO de la misma
     * transaccion del registro de entrada (ver transaccion()): la escritura
     * es una unica INSERT preparada, muy por debajo del presupuesto de 3 ms
     * del ERS en una DB local WAL.
     */
    publicar({ id = null, tenantId = TENANT_PROPIETARIO, canal, tipo, payload, disponibleEn = null, transporte = 'sqlite' } = {}) {
      afirmarTenantId(tenantId);
      if (!['sqlite','redis'].includes(transporte)) throw new TypeError('RF01_TRANSPORT_UNSUPPORTED');
      if (typeof canal !== 'string' || !canal.trim()) throw new TypeError('outbox.publicar: canal obligatorio.');
      if (typeof tipo !== 'string' || !tipo.trim()) throw new TypeError('outbox.publicar: tipo obligatorio.');
      const ahora = aIso();
      const eventoId = id || `evt_${crypto.randomUUID()}`;
      insEvento.run({
        transporte,
        id: eventoId,
        tenant_id: tenantId,
        canal: canal.trim().toLowerCase(),
        tipo: tipo.trim(),
        payload: JSON.stringify(payload ?? {}),
        ahora,
        disponible_en: disponibleEn ? aIso(disponibleEn) : ahora
      });
      return eventoId;
    },

    /** Transaccion IMMEDIATE para agrupar registro de entrada + outbox de forma atomica. */
    transaccion(fn) {
      return db.transaction(fn).immediate();
    },

    /**
     * Reclamo atomico: selecciona pendientes ya disponibles y los marca
     * en_curso dentro de UNA transaccion inmediata; dos workers nunca se
     * llevan el mismo trabajo.
     */
    reclamarPendientes({ limite = 4, ahora = null } = {}) {
      const instante = aIso(ahora);
      return db.transaction(() => {
        const ids = selPendientes.all({ ahora: instante, limite: Math.max(1, Math.trunc(limite)) });
        const reclamados = [];
        for (const { id } of ids) {
          if (updReclamar.run({ id, ahora: instante }).changes === 1) {
            reclamados.push(aTrabajo(selTrabajo.get(id)));
          }
        }
        return reclamados;
      }).immediate();
    },

    /**
     * Devuelve a pendiente los trabajos en_curso cuyo reclamo expiro:
     * el worker que los tenia murio antes de terminar (caida, reinicio).
     */
    recuperarExpirados({ ahora = null, expiracionMs = 60000 } = {}) {
      const corte = new Date(new Date(aIso(ahora)).getTime() - expiracionMs).toISOString();
      return updRecuperar.run({ limiteExpiracion: corte }).changes;
    },

    marcarCompletado(id, { ahora = null } = {}) {
      updCompletado.run({ id, ahora: aIso(ahora) });
    },

    /**
     * Error de procesamiento: reintenta con backoff lineal hasta
     * maxIntentos; a partir de ahi el trabajo queda fallido (visible para
     * operacion, nunca reejecutado en silencio).
     */
    marcarFallido(id, error, { ahora = null, maxIntentos = 5, backoffMs = 1000 } = {}) {
      const instante = aIso(ahora);
      const fila = selTrabajo.get(id);
      if (!fila) return;
      const intentos = fila.intentos + 1;
      const mensaje = String((error && error.message) || error || 'error desconocido').slice(0, 500);
      if (intentos >= maxIntentos) {
        updFalloDefinitivo.run({ id, ahora: instante, error: mensaje });
      } else {
        const disponible = new Date(new Date(instante).getTime() + backoffMs * intentos).toISOString();
        updFalloReintentable.run({ id, disponible_en: disponible, error: mensaje });
      }
    },

    guardarCheckpoint(jobId, ronda, estado) {
      return db.transaction(() => {
      if (selTrabajo.get(String(jobId))?.transporte === 'redis') throw new Error('RF01_CLAIM_TOKEN_REQUIRED');
      insCheckpoint.run({
        job_id: String(jobId),
        ronda: Math.max(0, Math.trunc(Number(ronda) || 0)),
        estado: JSON.stringify(estado ?? {}),
        ahora: aIso()
      });
      }).immediate();
    },

    ultimoCheckpoint(jobId) {
      const fila = selUltimoCheckpoint.get(String(jobId));
      if (!fila) return null;
      let estado;
      try {
        estado = JSON.parse(fila.estado);
      } catch {
        estado = null;
      }
      return Object.freeze({ ronda: fila.ronda, estado });
    },

    checkpoints(jobId) {
      return selCheckpoints.all(String(jobId)).map((f) => {
        let estado;
        try {
          estado = JSON.parse(f.estado);
        } catch {
          estado = null;
        }
        return Object.freeze({ ronda: f.ronda, estado, creadoEn: f.creado_en });
      });
    },

    /**
     * Encola la respuesta de salida. El id por defecto es DETERMINISTA por
     * trabajo: reejecutar el mismo trabajo no duplica la entrega al canal
     * (INSERT OR IGNORE). Devuelve true si la respuesta quedo encolada.
     */
    encolarRespuesta({ id = null, jobId, canal, destinatario, payload } = {}) {
      return db.transaction(() => {
      if (!jobId) throw new TypeError('outbox.encolarRespuesta: jobId obligatorio.');
      if (selTrabajo.get(String(jobId))?.transporte === 'redis') throw new Error('RF01_CLAIM_TOKEN_REQUIRED');
      const respuestaId = id || `resp_${jobId}`;
      const r = insRespuesta.run({
        id: respuestaId,
        job_id: String(jobId),
        canal: String(canal || '').trim().toLowerCase(),
        destinatario: String(destinatario || ''),
        payload: JSON.stringify(payload ?? {}),
        ahora: aIso()
      });
      return r.changes === 1;
      }).immediate();
    },

    respuestasPendientes({ canal = null, limite = 20 } = {}) {
      return selRespuestasPendientes.all({ canal, limite: Math.max(1, Math.trunc(limite)) }).map((f) => {
        let payload;
        try {
          payload = JSON.parse(f.payload);
        } catch {
          payload = null;
        }
        return Object.freeze({
          id: f.id,
          jobId: f.job_id,
          canal: f.canal,
          destinatario: f.destinatario,
          payload,
          creadoEn: f.creado_en
        });
      });
    },

    marcarRespuestaEntregada(id, { ahora = null } = {}) {
      updRespuestaEntregada.run({ id, ahora: aIso(ahora) });
    },

    /**
     * Marca 'enviando' ANTES de llamar al canal (compare-and-set desde
     * 'pendiente'). Devuelve true si este proceso tomo la respuesta; si
     * otro la tomo o ya no esta pendiente, false y no se toca.
     */
    marcarRespuestaEnviando(id, { ahora = null } = {}) {
      return updRespuestaEnviando.run({ id, ahora: aIso(ahora) }).changes === 1;
    },

    /** Fallo pre-envio verificado (el mensaje NO salio): vuelve a pendiente y se reintenta. */
    volverRespuestaAPendiente(id) {
      updRespuestaVolverPendiente.run({ id });
    },

    /**
     * El intento de envio pudo haber llegado al proveedor (timeout, corte
     * de socket, rechazo del SDK tras intentar): se cierra a 'incierto'
     * de inmediato y NUNCA se reenvia automaticamente.
     */
    marcarRespuestaIncerta(id) {
      updRespuestaIncerta.run({ id });
    },

    /**
     * Una respuesta en 'enviando' mas alla de la expiracion es INCIERTA:
     * el envio pudo resolverse antes de la caida. Se cierra a 'incierto'
     * (visible para reconciliacion) y NUNCA se reenvia automaticamente.
     */
    recuperarEnviosIncertos({ ahora = null, expiracionMs = 120000 } = {}) {
      const corte = new Date(new Date(aIso(ahora)).getTime() - expiracionMs).toISOString();
      return updEnviosIncertos.run({ corte }).changes;
    },

    respuestasIncertas({ limite = 50 } = {}) {
      return selRespuestasIncertas.all({ limite: Math.max(1, Math.trunc(limite)) }).map((f) => Object.freeze({
        id: f.id, jobId: f.job_id, canal: f.canal, destinatario: f.destinatario, creadoEn: f.creado_en
      }));
    },

    contadores() {
      const out = { pendiente: 0, en_curso: 0, completado: 0, fallido: 0 };
      for (const f of selContadores.all()) {
        if (ESTADOS.has(f.estado)) out[f.estado] = f.n;
      }
      return out;
    }
  });
}
