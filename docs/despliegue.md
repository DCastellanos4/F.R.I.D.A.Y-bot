# Infraestructura del VPS y Pipeline de Despliegue CI/CD

Especificacion tecnica completa del servidor en produccion y de la cadena de despliegue continuo de D.A.V.I.S.

## 1. Topologia de Infraestructura en el VPS (Oracle Cloud Infrastructure)

El sistema opera en una instancia Always Free de OCI con arquitectura ARM64:
- **Hardware**: Oracle Ampere A1 Compute (4 vCPU Neoverse-N1, 24 GB RAM LPDDR4, 100+ GB NVMe SSD).
- **Sistema Operativo**: Ubuntu 22.04 LTS (Kernel Linux aarch64).
- **Red**: Loopback restringido (`127.0.0.1`). Ningun micro-servicio interno expone puertos a Internet; el trafico externo entra exclusivamente por WhatsApp WebSocket saliente y túneles seguros.

### Componentes de Infraestructura en Produccion:

1. **Gestor de Procesos (PM2 v5.x)**:
   - `jarvis-api` (PID fork, puerto loopback `127.0.0.1:3000`): API REST autenticada por token y webhook de GitHub.
   - `jarvis-whatsapp` (PID fork): Cliente multi-dispositivo Baileys, emision de estado typing nativo (`composing`), monitores en segundo plano (Vigilante, Sniper Watchdog, Daily Briefing 06:55).
   - Configuracion: `ecosystem.config.cjs` con secretos aislados en `~/jarvis-estado/secrets/runtime-env.json` (permisos 0600).

2. **Motor Vectorial Industrial (Qdrant v1.20)**:
   - Ejecutado en contenedor Docker: `qdrant/qdrant:v1.20.0` en loopback `127.0.0.1:6333`.
   - Persistencia: Volumen en disco SSD para vectores e indice HNSW.
   - Coleccion: `davis_memorias_propietario` (vectores de 1024 dimensiones, metrica Coseno).

3. **Motor Local de Inferencia y Embeddings (Ollama v0.5+)**:
   - Servicio local en loopback `http://127.0.0.1:11434`.
   - Modelo de embeddings: `bge-m3:latest` (1024 dimensiones, multilingue espanol/ingles).
   - Modelos SLM de contingencia: `qwen2.5:3b`, `qwen2.5:1.5b`.

4. **Subsistema de Voz y Audio Nativo**:
   - Transcripcion: `whisper.cpp` compilado nativamente para ARM64 NEON, procesa notas de voz PTT de WhatsApp localmente sin enviar audio a APIs de terceros.
   - Sintesis: `edge-tts` (generacion de notas de voz nativas OGG Opus PTT en espanol).
   - Transcodificacion: `ffmpeg` optimizado para conversion de audio/video y limitacion de bitrates.

5. **Subsistema de Descargas y Scraping**:
   - `yt-dlp`: Descarga y compresion de videos/audios con escalon de bitrate (ladder) de 16 MB para compatibilidad directa con WhatsApp.
   - Playwright Chromium Headless: Captura web, navegacion determinista y lectura de noticias sin JavaScript en cliente.

6. **Base de Datos y Colas (SQLite WAL & Redis)**:
   - Base de datos relacional: `/home/ubuntu/jarvis-estado/data/jarvis.db` (SQLite 3 con WAL activo y transacciones ACID).
   - Cola de mensajes y outbox: Redis en loopback `127.0.0.1:6389` con autenticacion estricta y base SQLite `ers_pipeline.db`.

7. **Almacenamiento Cifrado y Backups**:
   - Directorio: `/home/ubuntu/backups/`.
   - Formato DBK1: Archivos tar cifrados con AES-256-GCM y permisos forzados a `0600`. Se generan automaticamente antes de cada corte de despliegue.

---

## 2. Pipeline de Despliegue CI/CD (`deploy/deploy.sh`)

Push a `main` dispara el workflow de GitHub Actions (`.github/workflows/ci-cd.yml`):

### Fases de la Puerta de Calidad:
1. **Auditoria Estatica**: Auditoria estricta de cero emojis en codigo, tests y documentacion.
2. **Bateria Critica**: 100% de tests criticos ejecutados con 0 fallos y 0 omitidos.
3. **Suite Completa**: Al menos el 95% de las 145 suites de prueba superadas.
4. **Despliegue Atómico por SSH**:
   - Bloqueo exclusivo: `flock -w 300 /home/ubuntu/.deploy.lock` (espera ordenada de hasta 5 minutos, eliminando condiciones de carrera).
   - Sanitizacion CRLF: Eliminacion automatica de saltos de linea Windows antes de ejecutar bash.
   - Release Aislada: Worktree de Git en `~/releases/<timestamp>-<sha>` enlazando el estado compartido `~/jarvis-estado`.
   - Snapshot Pre-Corte: Writers detenidos acotadamente (`quiesce`), snapshot DBK1 verificado.
   - Corte Controlado: Conmutacion atomica del symlink `~/jarvis`.
   - Ventana de Estabilidad: Verificacion de 75 segundos en PM2 (restarts inmoviles, WhatsApp conectado sin pedir QR, API /api/salud 200).
   - Limpieza: Retencion estricta de las 3 releases mas recientes.
