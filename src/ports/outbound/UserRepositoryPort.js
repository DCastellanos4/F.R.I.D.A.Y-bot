/**
 * Puerto de salida: registro de usuarios conocidos.
 *
 * NO es autorizacion: la lista blanca actual sigue decidiendo quien
 * puede hablar con el bot. Este puerto solo registra contacto ya
 * autenticado (primer contacto / ultimo acceso), base de datos para la
 * futura multi-tenancy sin activarla: un solo usuario sigue siendo el
 * comportamiento por defecto.
 *
 * Strict Policy: Zero Emojis.
 */

const OPERACIONES_REQUERIDAS = ['registrarContacto', 'obtener', 'listar'];

export function afirmarUserRepository(repo) {
  if (!repo || typeof repo !== 'object') {
    throw new Error('UserRepositoryPort: el repositorio debe ser un objeto.');
  }
  for (const op of OPERACIONES_REQUERIDAS) {
    if (typeof repo[op] !== 'function') {
      throw new Error(`UserRepositoryPort: falta la operacion requerida "${op}".`);
    }
  }
  return repo;
}
