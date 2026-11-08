/**
 * Adaptador de salida: UserRepositoryPort sobre SQLite.
 *
 * Registra el contacto de usuarios YA autenticados por la lista blanca
 * (upsert de primer_contacto/ultimo_acceso). No crea cuentas, no cambia
 * permisos y no se consulta para autorizar: la autorizacion sigue
 * siendo exclusiva del allowlist historico.
 *
 * Strict Policy: Zero Emojis.
 */
import { afirmarUserRepository } from '../../../../ports/outbound/UserRepositoryPort.js';

function filaAUsuario(f) {
  return { telefono: f.telefono, primerContacto: f.primer_contacto, ultimoAcceso: f.ultimo_acceso };
}

export function crearSqliteUserRepository(db, deps = {}) {
  const ahora = deps.ahora || (() => new Date().toISOString());
  const upsert = db.prepare(`
    INSERT INTO usuarios (telefono, primer_contacto, ultimo_acceso)
    VALUES (@telefono, @ahora, @ahora)
    ON CONFLICT(telefono) DO UPDATE SET ultimo_acceso = @ahora
  `);
  const porTelefono = db.prepare('SELECT * FROM usuarios WHERE telefono = ?');
  const todos = db.prepare('SELECT * FROM usuarios ORDER BY primer_contacto');

  return afirmarUserRepository(Object.freeze({
    registrarContacto(telefono) {
      if (!telefono || typeof telefono !== 'string') return { ok: false, error: 'Telefono requerido.' };
      upsert.run({ telefono, ahora: ahora() });
      return { ok: true };
    },
    obtener(telefono) {
      const fila = porTelefono.get(telefono);
      return fila ? filaAUsuario(fila) : null;
    },
    listar() {
      return todos.all().map(filaAUsuario);
    }
  }));
}
