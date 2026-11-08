/**
 * Store SQLite para las memorias del Second Brain.
 *
 * Implementa la misma costura que el almacen JSON historico de
 * memoryService ({ leer, guardar } de la lista completa) mas
 * transaccion(fn): el servicio ejecuta cada operacion de
 * leer-modificar-escribir dentro de una transaccion BEGIN IMMEDIATE, de
 * modo que un segundo escritor espera (busy_timeout) y relee dentro de
 * su propia transaccion los datos ya confirmados; no hay actualizacion
 * perdida entre escritores. Los campos de cifrado en reposo (categoria
 * "clave") viajan en columnas propias y se reconstruyen tal cual.
 *
 * Strict Policy: Zero Emojis.
 */
import { conSpanPosibleSincrono } from '../../../../observability/telemetry.js';

function filaAMemoria(fila) {
  const memoria = {
    id: fila.id,
    sujeto: fila.sujeto,
    dato: fila.dato,
    categoria: fila.categoria,
    tags: JSON.parse(fila.tags || '[]'),
    fechaRegistro: fila.fecha_registro
  };
  if (fila.fecha_local !== null && fila.fecha_local !== undefined) {
    memoria.fechaLocal = fila.fecha_local;
  }
  if (fila.cifrado) {
    memoria.cifrado = fila.cifrado;
    memoria.salt = fila.salt;
    memoria.iv = fila.iv;
    memoria.tag = fila.tag;
  }
  return memoria;
}

export function crearSqliteMemoryStore(db) {
  const stmtTodo = db.prepare(
    'SELECT id, sujeto, dato, categoria, tags, fecha_registro, fecha_local, cifrado, salt, iv, tag FROM memorias ORDER BY rowid'
  );
  const stmtBorrar = db.prepare('DELETE FROM memorias');
  const stmtInsertar = db.prepare(`
    INSERT INTO memorias (id, sujeto, dato, categoria, tags, fecha_registro, fecha_local, cifrado, salt, iv, tag)
    VALUES (@id, @sujeto, @dato, @categoria, @tags, @fecha_registro, @fecha_local, @cifrado, @salt, @iv, @tag)
  `);

  const reemplazarTodo = db.transaction((lista) => {
    stmtBorrar.run();
    for (const m of lista) {
      stmtInsertar.run({
        id: m.id,
        sujeto: m.sujeto,
        dato: m.dato,
        categoria: m.categoria,
        tags: JSON.stringify(Array.isArray(m.tags) ? m.tags : []),
        fecha_registro: m.fechaRegistro,
        fecha_local: m.fechaLocal ?? null,
        cifrado: m.cifrado ?? null,
        salt: m.salt ?? null,
        iv: m.iv ?? null,
        tag: m.tag ?? null
      });
    }
  });

  return Object.freeze({
    leer() {
      return stmtTodo.all().map(filaAMemoria);
    },
    guardar(lista) {
      // Observabilidad: span db_write (solo entidad/operacion, nunca datos).
      return conSpanPosibleSincrono('db_write', { entidad: 'memoria', operacion: 'guardar' }, () => reemplazarTodo(lista));
    },
    /**
     * Ejecuta fn dentro de una transaccion IMMEDIATE: adquiere el
     * candado de escritura ANTES de la primera lectura de fn, asi la
     * secuencia leer-modificar-escribir es atomica entre conexiones.
     */
    transaccion(fn) {
      return conSpanPosibleSincrono('db_write', { entidad: 'memoria', operacion: 'transaccion' }, () => db.transaction(fn).immediate());
    }
  });
}
