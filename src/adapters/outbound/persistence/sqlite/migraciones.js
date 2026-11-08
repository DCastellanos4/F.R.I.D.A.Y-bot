/**
 * Migraciones versionadas en SQL crudo.
 *
 * Cada migracion se aplica dentro de su propia transaccion y queda
 * registrada en schema_migrations; las ya aplicadas se saltan, asi que
 * ejecutarMigraciones es idempotente. Para cambiar el esquema se anade
 * una migracion NUEVA al final; las aplicadas no se editan jamas.
 *
 * Strict Policy: Zero Emojis.
 */
export const MIGRACIONES = [
  {
    version: 1,
    nombre: '001_esquema_inicial',
    sql: `
      CREATE TABLE meta (
        clave TEXT PRIMARY KEY,
        valor TEXT NOT NULL
      );

      CREATE TABLE memorias (
        id TEXT PRIMARY KEY,
        sujeto TEXT NOT NULL,
        dato TEXT NOT NULL,
        categoria TEXT NOT NULL DEFAULT 'general',
        tags TEXT NOT NULL DEFAULT '[]',
        fecha_registro TEXT NOT NULL,
        fecha_local TEXT,
        cifrado TEXT,
        salt TEXT,
        iv TEXT,
        tag TEXT
      );
      CREATE INDEX idx_memorias_categoria ON memorias(categoria);
      CREATE INDEX idx_memorias_sujeto ON memorias(sujeto);

      CREATE TABLE usuarios (
        telefono TEXT PRIMARY KEY,
        primer_contacto TEXT NOT NULL,
        ultimo_acceso TEXT NOT NULL
      );

      CREATE TABLE finanzas_gastos (
        id TEXT PRIMARY KEY,
        importe REAL NOT NULL CHECK (importe > 0),
        comercio TEXT NOT NULL,
        categoria TEXT NOT NULL,
        fecha TEXT NOT NULL,
        notas TEXT,
        origen TEXT NOT NULL DEFAULT 'manual',
        creado_en TEXT NOT NULL
      );
      CREATE INDEX idx_gastos_fecha ON finanzas_gastos(fecha);
      CREATE INDEX idx_gastos_categoria ON finanzas_gastos(categoria);

      CREATE TABLE finanzas_suscripciones (
        id TEXT PRIMARY KEY,
        nombre TEXT NOT NULL,
        importe REAL NOT NULL CHECK (importe > 0),
        dia_renovacion INTEGER NOT NULL CHECK (dia_renovacion BETWEEN 1 AND 31),
        categoria TEXT NOT NULL,
        ultimo_aviso_para TEXT,
        creada_en TEXT NOT NULL
      );

      CREATE TABLE finanzas_presupuestos (
        categoria TEXT PRIMARY KEY,
        limite REAL NOT NULL CHECK (limite > 0)
      );

      CREATE TABLE finanzas_borradores (
        id TEXT PRIMARY KEY,
        estado TEXT NOT NULL DEFAULT 'pendiente',
        chat_id TEXT,
        datos TEXT NOT NULL,
        dudas TEXT NOT NULL DEFAULT '[]',
        gasto_id TEXT REFERENCES finanzas_gastos(id),
        creado_en TEXT NOT NULL
      );

      CREATE TABLE finanzas_config (
        clave TEXT PRIMARY KEY,
        valor TEXT NOT NULL
      );
    `
  },
  {
    // Fundamentos de tenancy, ADITIVOS: todo dato existente queda en el tenant
    // 'propietario' (DEFAULT). Presupuestos y config cambian de clave primaria
    // (categoria/clave -> tenant+categoria/clave): SQLite no altera PK, asi que
    // se reconstruyen copiando TODAS las filas en la misma transaccion.
    // No se habilita ningun usuario: solo existe el tenant propietario.
    version: 2,
    nombre: '002_tenancy_fundamentos',
    sql: `
      CREATE TABLE tenants (
        id TEXT PRIMARY KEY,
        nombre TEXT NOT NULL,
        rol TEXT NOT NULL DEFAULT 'usuario',
        estado TEXT NOT NULL DEFAULT 'activo',
        creado_en TEXT NOT NULL
      );
      INSERT INTO tenants (id, nombre, rol, estado, creado_en)
        VALUES ('propietario', 'Propietario', 'propietario', 'activo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

      CREATE TABLE identidades (
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        canal TEXT NOT NULL,
        identificador TEXT NOT NULL,
        creada_en TEXT NOT NULL,
        PRIMARY KEY (canal, identificador)
      );

      ALTER TABLE memorias ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'propietario';
      ALTER TABLE finanzas_gastos ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'propietario';
      ALTER TABLE finanzas_suscripciones ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'propietario';
      ALTER TABLE finanzas_borradores ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'propietario';
      CREATE INDEX idx_memorias_tenant ON memorias(tenant_id);
      CREATE INDEX idx_gastos_tenant ON finanzas_gastos(tenant_id);
      CREATE INDEX idx_subs_tenant ON finanzas_suscripciones(tenant_id);
      CREATE INDEX idx_borr_tenant ON finanzas_borradores(tenant_id);

      CREATE TABLE finanzas_presupuestos_t (
        tenant_id TEXT NOT NULL DEFAULT 'propietario',
        categoria TEXT NOT NULL,
        limite REAL NOT NULL CHECK (limite > 0),
        PRIMARY KEY (tenant_id, categoria)
      );
      INSERT INTO finanzas_presupuestos_t (categoria, limite)
        SELECT categoria, limite FROM finanzas_presupuestos ORDER BY rowid;
      DROP TABLE finanzas_presupuestos;
      ALTER TABLE finanzas_presupuestos_t RENAME TO finanzas_presupuestos;

      CREATE TABLE finanzas_config_t (
        tenant_id TEXT NOT NULL DEFAULT 'propietario',
        clave TEXT NOT NULL,
        valor TEXT NOT NULL,
        PRIMARY KEY (tenant_id, clave)
      );
      INSERT INTO finanzas_config_t (clave, valor)
        SELECT clave, valor FROM finanzas_config ORDER BY rowid;
      DROP TABLE finanzas_config;
      ALTER TABLE finanzas_config_t RENAME TO finanzas_config;

      -- Libro persistente de TOKENS reales (no coste). Sin precios aqui.
      CREATE TABLE uso_tokens (
        tenant_id TEXT NOT NULL,
        dia TEXT NOT NULL,
        modelo TEXT NOT NULL,
        entrada INTEGER NOT NULL DEFAULT 0,
        salida INTEGER NOT NULL DEFAULT 0,
        llamadas INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (tenant_id, dia, modelo)
      );
    `
  }
];

export function ejecutarMigraciones(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      nombre TEXT NOT NULL,
      aplicada_en TEXT NOT NULL
    )
  `);
  const aplicadas = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version)
  );
  const aplicadasAhora = [];
  for (const migracion of MIGRACIONES) {
    if (aplicadas.has(migracion.version)) continue;
    db.transaction(() => {
      db.exec(migracion.sql);
      db.prepare(
        'INSERT INTO schema_migrations (version, nombre, aplicada_en) VALUES (?, ?, ?)'
      ).run(migracion.version, migracion.nombre, new Date().toISOString());
    })();
    aplicadasAhora.push(migracion.version);
  }
  return { aplicadasAhora, total: MIGRACIONES.length };
}
