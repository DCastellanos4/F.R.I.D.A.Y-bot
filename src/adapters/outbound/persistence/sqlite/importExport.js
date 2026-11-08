/**
 * Importacion JSON -> SQLite y exportacion SQLite -> JSON.
 *
 * Importar: todo-o-nada dentro de UNA transaccion; solo sobre tablas
 * vacias (idempotente: una segunda llamada no duplica). Los ficheros
 * JSON de origen NO se tocan: quedan como punto de partida previo a la
 * migracion. Al terminar se marca meta.origen='importada' y se guardan
 * los conteos esperados; un arranque posterior que encuentre datos sin
 * marca de origen se considera estado inconsistente (fallo cerrado en
 * la factoria).
 *
 * Exportar: vuelca el contenido ACTUAL de la base (incluidas las
 * escrituras posteriores a la migracion) a un directorio nuevo con
 * escritura atomica, verificando integridad (conteos y sha256 del
 * volcado). Nunca sobrescribe los JSON activos: el procedimiento de
 * recuperacion documentado es parar el bot, exportar, verificar,
 * colocar manualmente los JSON verificados como ficheros activos y
 * volver a DAVIS_PERSISTENCE=json.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function leerJsonSiExiste(ruta, valorDefecto) {
  try {
    return JSON.parse(fs.readFileSync(ruta, 'utf-8'));
  } catch {
    return valorDefecto;
  }
}

function exigirStoresPropietario(memoryStore, financeStore) {
  if (memoryStore?.tenantId !== 'propietario' || financeStore?.tenantId !== 'propietario') {
    throw new Error('Import/export historico requiere stores del propietario; ambito de tenant rechazado.');
  }
}

function estadoTablas(db) {
  // Solo filas del PROPIETARIO: la importacion JSON historica es del
  // propietario; las filas de otros tenants ni la bloquean ni cuentan en su
  // verificacion de integridad. Tablas sin columna tenant_id: conteo total.
  const contar = (tabla) => {
    const conTenant = db.prepare(`PRAGMA table_info(${tabla})`).all().some((c) => c.name === 'tenant_id');
    return conTenant
      ? db.prepare(`SELECT COUNT(*) AS n FROM ${tabla} WHERE tenant_id = ?`).get('propietario').n
      : db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get().n;
  };
  return {
    memorias: contar('memorias'),
    gastos: contar('finanzas_gastos'),
    suscripciones: contar('finanzas_suscripciones'),
    presupuestos: contar('finanzas_presupuestos'),
    borradores: contar('finanzas_borradores'),
    config: contar('finanzas_config'),
    usuarios: contar('usuarios')
  };
}

function hayDatos(conteos) {
  return Object.values(conteos).some((n) => n > 0);
}

/**
 * @param {Database} db  Base ya migrada.
 * @param {{rutaMemorias?: string, rutaFinanzas?: string,
 *          leerMemoriasJson?: () => Array, leerFinanzasJson?: () => Object,
 *          escribirMemoria?: (lista) => void, escribirFinanzas?: (estado) => void}} fuentes
 *        Inyectables para pruebas; por defecto lee/escribe via los stores.
 */
export function importarJsonASqlite(db, { rutaMemorias, rutaFinanzas, rutaUsuarios = null, memoryStore, financeStore } = {}) {
  exigirStoresPropietario(memoryStore, financeStore);
  const origen = db.prepare("SELECT valor FROM meta WHERE clave = 'origen'").get();
  if (origen) {
    return { ok: true, yaImportado: true, origen: origen.valor, importados: null };
  }
  const conteos = estadoTablas(db);
  if (hayDatos(conteos)) {
    // Datos sin marca de origen: proveniencia desconocida. Fallo cerrado:
    // no se importa encima ni se sirve este estado como valido.
    return {
      ok: false,
      error: 'Estado inconsistente: la base tiene datos pero ninguna marca de origen en meta. No se importa ni se activa.',
      conteos
    };
  }

  const memorias = rutaMemorias ? leerJsonSiExiste(rutaMemorias, []) : [];
  const finanzas = rutaFinanzas ? leerJsonSiExiste(rutaFinanzas, null) : null;
  const usuarios = rutaUsuarios ? leerJsonSiExiste(rutaUsuarios, []) : [];

  const esperados = {
    memorias: Array.isArray(memorias) ? memorias.length : 0,
    gastos: finanzas && Array.isArray(finanzas.gastos) ? finanzas.gastos.length : 0,
    suscripciones: finanzas && Array.isArray(finanzas.suscripciones) ? finanzas.suscripciones.length : 0,
    usuarios: Array.isArray(usuarios) ? usuarios.length : 0
  };

  db.transaction(() => {
    if (esperados.memorias > 0) memoryStore.guardar(memorias);
    if (finanzas) {
      financeStore.guardar({
        gastos: finanzas.gastos || [],
        suscripciones: finanzas.suscripciones || [],
        presupuestos: finanzas.presupuestos || {},
        config: finanzas.config || {},
        borradores: Array.isArray(finanzas.borradores) ? finanzas.borradores : []
      });
    }
    if (esperados.usuarios > 0) {
      const insUsuario = db.prepare(
        'INSERT INTO usuarios (telefono, primer_contacto, ultimo_acceso) VALUES (?, ?, ?)'
      );
      for (const u of usuarios) {
        insUsuario.run(u.telefono, u.primerContacto, u.ultimoAcceso);
      }
    }
    // Verificacion de integridad DENTRO de la transaccion: si los
    // conteos no coinciden con la fuente, se hace rollback y no queda
    // importacion parcial ni marca.
    const reales = estadoTablas(db);
    for (const [tabla, n] of Object.entries(esperados)) {
      if (reales[tabla] !== n) {
        throw new Error(`Importacion incompleta en ${tabla}: esperados ${n}, escritos ${reales[tabla]}. Rollback.`);
      }
    }
    db.prepare("INSERT INTO meta (clave, valor) VALUES ('origen', ?)").run(
      esperados.memorias + esperados.gastos + esperados.suscripciones + esperados.usuarios > 0 ? 'importada' : 'nueva'
    );
    db.prepare("INSERT INTO meta (clave, valor) VALUES ('importada_en', ?)").run(new Date().toISOString());
    db.prepare("INSERT INTO meta (clave, valor) VALUES ('conteos_importacion', ?)").run(JSON.stringify(esperados));
  })();

  return { ok: true, yaImportado: false, importados: esperados };
}

/** Marca una base creada desde cero (sin JSON previo) como origen 'nueva'. */
export function marcarOrigenNueva(db) {
  const origen = db.prepare("SELECT valor FROM meta WHERE clave = 'origen'").get();
  if (origen) return origen.valor;
  const conteos = estadoTablas(db);
  if (hayDatos(conteos)) return null; // inconsistente: que decida la factoria
  db.prepare("INSERT INTO meta (clave, valor) VALUES ('origen', 'nueva')").run();
  return 'nueva';
}

/** null si el estado es consistente; descripcion del problema si no. */
export function comprobarEstadoConsistente(db) {
  const origen = db.prepare("SELECT valor FROM meta WHERE clave = 'origen'").get();
  const conteos = estadoTablas(db);
  if (!origen && hayDatos(conteos)) {
    return `Base SQLite con datos (${JSON.stringify(conteos)}) pero sin marca de origen en meta: proveniencia desconocida.`;
  }
  return null;
}

function escribirAtomico(ruta, contenido) {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.tmp`;
  fs.writeFileSync(tmp, contenido, 'utf-8');
  fs.renameSync(tmp, ruta);
}

/**
 * Vuelca la base actual a JSON verificados en dirDestino (un directorio
 * NUEVO por exportacion). Devuelve rutas, conteos y hashes para que el
 * operador verifique antes de colocarlos como ficheros activos.
 */
export function exportarSqliteAJson(db, { dirDestino, memoryStore, financeStore } = {}) {
  exigirStoresPropietario(memoryStore, financeStore);
  if (!dirDestino) throw new Error('exportarSqliteAJson requiere dirDestino.');
  if (fs.existsSync(dirDestino)) {
    throw new Error(`El directorio de exportacion ya existe: ${dirDestino}. No se sobrescribe una exportacion previa.`);
  }
  const memorias = memoryStore.leer();
  const finanzas = financeStore.leer();
  const usuarios = db.prepare('SELECT telefono, primer_contacto AS primerContacto, ultimo_acceso AS ultimoAcceso FROM usuarios ORDER BY primer_contacto').all();

  const jsonMemorias = JSON.stringify(memorias, null, 2);
  const jsonFinanzas = JSON.stringify(finanzas, null, 2);
  const jsonUsuarios = JSON.stringify(usuarios, null, 2);
  const rutaMemorias = path.join(dirDestino, 'brain_memory.json');
  const rutaFinanzas = path.join(dirDestino, 'finanzas.json');
  const rutaUsuarios = path.join(dirDestino, 'usuarios.json');
  escribirAtomico(rutaMemorias, jsonMemorias);
  escribirAtomico(rutaFinanzas, jsonFinanzas);
  escribirAtomico(rutaUsuarios, jsonUsuarios);

  const manifiesto = {
    exportadoEn: new Date().toISOString(),
    conteos: {
      memorias: memorias.length,
      gastos: finanzas.gastos.length,
      suscripciones: finanzas.suscripciones.length,
      presupuestos: Object.keys(finanzas.presupuestos).length,
      borradores: finanzas.borradores.length,
      usuarios: usuarios.length
    },
    sha256: {
      'brain_memory.json': crypto.createHash('sha256').update(jsonMemorias).digest('hex'),
      'finanzas.json': crypto.createHash('sha256').update(jsonFinanzas).digest('hex'),
      'usuarios.json': crypto.createHash('sha256').update(jsonUsuarios).digest('hex')
    }
  };
  escribirAtomico(path.join(dirDestino, 'manifiesto.json'), JSON.stringify(manifiesto, null, 2));
  return { ok: true, rutaMemorias, rutaFinanzas, rutaUsuarios, manifiesto };
}
