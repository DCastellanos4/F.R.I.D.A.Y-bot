# Datos y persistencia

Todo el estado vive en `data/` (`DAVIS_DATA_DIR` para tests y aislamiento;
en produccion es el estado compartido del despliegue, fuera de git). Zona
horaria de referencia en todo el sistema: Europe/Madrid.

## Modelo de persistencia

- Por defecto: ficheros JSON/JSONL con escritura atomica, uno por dominio
  (`brain_memory.json`, `reminders.json`, `scheduled_messages.json`,
  `compra.json`, `habitos.json`, `entregas.json`, `flashcards.json`,
  `applications.json`, `ideas.json`, `quedadas.json`, `menus.json`,
  `traductor.json`, `recomendador.json`, `snoozes.json`,
  `avisos_llegada.json`, `viajes_vigilados.json`, `fechas_senaladas.json`,
  `modo_nocturno.json`, `tracked_items.json`, `alerts_queue.json`,
  `contactos.json`, `transporte.json`, `entrevistas.json`,
  `digest_cerebro.json`, `skills.json`, `calendar_events.json`,
  `ops_config.json`, `procesos_vigilados.json`, `watchdog_state.json`...).
- Alternativa: SQLite embebido (`DAVIS_PERSISTENCE=sqlite`,
  better-sqlite3, WAL, foreign keys, migraciones versionadas 001-005,
  importacion JSON inicial todo-o-nada y exportacion verificada). Detalle
  en [persistencia-sqlite.md](persistencia-sqlite.md).
- Historial de conversacion: un fichero por chat en `data/historial/`
  (ventana 12, maximo 40, condensacion).
- Memoria episodica: JSONL por chat con lo que sale de la ventana.
- Notas: markdown en `data/notes/AAAA-MM-DD/*.md`; diario en
  `data/diario/AAAA-MM-DD.md`.
- Indices: `knowledge_vectors.json` (indice TF-IDF local de la busqueda
  semantica; las categorias sensibles nunca entran) y `knowledge_graph.json`
  (grafo de entidades y relaciones para enriquecer el contexto).

## Memoria del segundo cerebro

`memoryService`: hechos con sujeto, dato, categoria y tags; deduplicacion,
expansion de tags y, para la categoria `clave`, cifrado en reposo
AES-256-GCM (fail-closed sin `MEMORY_ENCRYPTION_KEY`). El borrado masivo
exige confirmacion humana. Los servicios que leen o escriben rutas de
tenant pasan por `tenantFileSystem` (O_NOFOLLOW).

## Metricas y trazas

- `metricas_clasificador.jsonl`: aciertos y fallos del enrutador.
- `usageLedger` / `uso_tokens`: tokens reales por dia y modelo (solo
  medicion, sin precios).
- Trazas por chat (recorrido de cada mensaje, sin argumentos).
- Logs append-only con rotacion acotada (envios programados, alertas).

## Backups

- Manual: `crear_backup_sesion` genera un contenedor cifrado (formato
  DAVBAK) del estado; `verificar_backup_sesion` lo comprueba. Clave por
  entorno. La subida a Object Storage es config-required.
- De despliegue: snapshot cifrado DBK1 del estado completo con writers
  detenidos, previo a cada corte de release. Ver [Despliegue](despliegue.md).
- Limite honesto: la copia manual lee ficheros en instantes distintos; la
  consistencia con escritores concurrentes solo la garantiza el snapshot de
  despliegue con los procesos parados.

## Lo que nunca toca el disco en claro

Codigos OTP, credenciales con formato conocido (redactadas antes de
persistir), secretos del entorno (nunca se escriben en datos) y contenido
de mensajes en metricas o spans de observabilidad.
