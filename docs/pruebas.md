# Pruebas

Suite nativa de Node (`node:test`), 119 ficheros de test organizados en:

| Carpeta | Cobertura |
| --- | --- |
| `tests/sector1/` | Flujos de WhatsApp: audio PTT, filtro VIP, efimeros, interactivos, resumidor de grupos, clasificador de estres, captura de notas, vCards, encuestas, descarga de media. |
| `tests/sector2/` | Fundaciones, integracion y sistema: consola bash con OTP, webhook de GitHub, backups, cifrado de memorias, Docker, disco, fail2ban, SSL, red, tuneles, cripto, aislamiento de despliegue. |
| `tests/sector3/` | Eficiencia de IA, pureza del core, CI/CD, tenancy (catalogo E2E, aislamiento, cuotas, multiproceso, puente WhatsApp), briefings, entrypoints. |
| `tests/cognitive/` | Cobertura por tiers (funcional, bordes, cruzada, mundo real, adversarial), grafo de conocimiento, idempotencia. |
| `tests/harness/` | Utilidades: socket falso de Baileys, fixtures, validadores (incluida la regex de emojis), concurrencia, harness del snapshot de despliegue. |

## Runner (`tests/run_all.js`)

- Auditoria de cero emojis sobre todo el arbol (`.js`, `.cjs`, `.md`)
  antes de lanzar nada; una violacion falla la suite.
- Aislamiento duro: fija y valida `DAVIS_DATA_DIR`/`DAVIS_HISTORY_DIR`
  fuera del repo y aborta si resuelven al `data/` de produccion. Ninguna
  test escribe en datos reales salvo ruta inyectada.
- Conjunto critico (foundations, challenge, integracion, bash, webhook,
  backup, cifrado de memorias, aislamiento, safeFetch, watchdog): debe
  pasar entero, sin omitidas.
- Suite completa: la puerta exige >= 95 % de tests ejecutadas pasando
  (ver [Despliegue](despliegue.md)).
- Concurrencia: por defecto la historica (CI y VPS); `DAVIS_TEST_CONCURRENCY`
  (entero 1-128) permite un modo concurrente local opcional sin cambiar el
  comportamiento de CI ni de la puerta.

## Convenciones de las pruebas

- Dependencias inyectables en casi todo (fetch, reloj, rutas, modelo), con
  stubs de LLM para los E2E del agente.
- Las pruebas de tenancy usan mutaciones reales: quitar una proteccion debe
  hacer fallar la prueba.
- Ninguna test consume cuota real del proveedor ni toca el VPS.
