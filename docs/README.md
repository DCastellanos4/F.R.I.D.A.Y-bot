# Documentacion de D.A.V.I.S.

Documentacion tecnica del proyecto D.A.V.I.S., escrita contra el codigo fuente en produccion. Cada documento describe la realidad arquitectonica y operativa del sistema.

## Documentos

### Vision y Arquitectura
- [Vision general](vision-general.md): Principios de diseno, procesos y descomposicion funcional.
- [Arquitectura hexagonal](arquitectura-hexagonal.md): Puertos de entrada/salida, adaptadores desacoplados y raiz de composicion.
- [Agente y LLM](agente-y-llm.md): Bucle reactivo, seleccion dinamica de herramientas, enrutamiento especialista y guardarrailes.
- [Arquitectura MCP Modular](ers-arquitectura-mcp.md): Micro-servidores MCP desacoplados via JSON-RPC 2.0 stdio (Booking, DevOps, Finance, Lifestyle, Media).

### Recuperacion y Memoria (RAG Industrial)
- [RAG Hibrido y Second Brain en Qdrant (RF-03)](rf03-rag-hibrido.md): Indexacion vectorial en Qdrant con embeddings 'bge-m3' (1024d) y fallback graceful.
- [Contexto selectivo y presupuesto preventivo](eficiencia-ia.md): Presupuesto preventivo bajo el limite de 128 herramientas por proveedor.

### Multitenancy y Seguridad SaaS
- [Tenancy: Aislamiento Completo y Cuotas](tenancy.md): Planes (`demo`, `cliente`, `staff`, `propietario`), rate limits por minuto, cuota diaria de tokens y `AISLAMIENTO_COMPLETO = true`.
- [Matriz local del minimo multiusuario](tenancy-auditoria-minima-local.md): Verificacion de aislamiento y pruebas de no regresion.
- [Seguridad](seguridad.md): Control de acceso, guardarrailes, aislamiento de red (anti-SSRF safeFetch con pinning DNS) y cifrado GCM.

### Canales, Operacion y Monitores
- [Canales](canales.md): Multi-dispositivo WhatsApp (Baileys) con typing continuo reactivo y API REST autenticada.
- [Monitores y alertas](monitores.md): Monitoreo proactivo en segundo plano (Vigilante, Sniper Watchdog, Daily Briefing 06:55).
- [Integraciones externas](integraciones.md): Google Calendar oficial, EMT Madrid MobilityLabs, Renfe Cercanias, Open-Meteo.
- [Persistencia SQLite](persistencia-sqlite.md): Esquema relacional, migraciones aditivas y transacciones ACID WAL.
- [Observabilidad](observabilidad.md): Trazas distribuidas OpenTelemetry OTLP y metricas nativas Prometheus `/metrics`.
- [Despliegue y CI/CD](despliegue.md): Pipeline con `flock -w 300`, snapshots cifrados DBK1 y compuerta de calidad automatizada.
- [Pruebas](pruebas.md): 145 suites de test automatizadas con politica estricta de cero emojis.

## Convenciones

- Espanol, sin emojis en ningun fichero (auditado por la suite de pruebas).
- "Operativo" significa que funciona en produccion en el despliegue actual.
- Cero exposicion de secretos: La documentacion publica contiene unicamente arquitectura, diagramas, contratos y decisiones de diseno.
