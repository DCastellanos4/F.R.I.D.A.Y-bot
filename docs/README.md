# Documentacion de D.A.V.I.S.

Documentacion tecnica del proyecto, escrita contra el codigo fuente. Cada
documento describe lo que el sistema hace de verdad en la revision actual;
lo que requiere configuracion adicional o aun no esta activo se marca como
tal en el propio texto.

## Documentos

### Vision y arquitectura
- [Vision general](vision-general.md): que es D.A.V.I.S., procesos, piezas y principios de diseno.
- [Arquitectura hexagonal](arquitectura-hexagonal.md): puertos, adaptadores y raiz de composicion.
- [Agente y LLM](agente-y-llm.md): bucle del agente, proveedores de modelo, contexto selectivo, presupuesto y guardarrailes.

### Funcionalidad
- [Capacidades](capacidades.md): catalogo funcional agrupado por area, con los requisitos de configuracion de cada pieza.
- [Canales](canales.md): bot de WhatsApp y API REST, flujos y puntos de entrada.
- [Monitores y alertas](monitores.md): vigilancia proactiva, cola de alertas y avisos programados.
- [Integraciones externas](integraciones.md): servicios de terceros, credenciales necesarias y estado de cada una.

### Datos y operacion
- [Datos y persistencia](datos.md): ficheros de datos, memoria, historial, SQLite opcional y backups.
- [Seguridad](seguridad.md): control de acceso, confirmaciones humanas, cifrado y defensas de red.
- [Despliegue y CI/CD](despliegue.md): pipeline, puerta de calidad, releases y arranque en el VPS.
- [Pruebas](pruebas.md): estructura de la suite, aislamiento y criterios de la puerta.
- [Limitaciones conocidas](limitaciones.md): lo que no esta activo, lo que depende de configuracion y las brechas declaradas.

### Eficiencia, observabilidad y persistencia
- [Contexto selectivo y presupuesto preventivo](eficiencia-ia.md)
- [Observabilidad: OpenTelemetry + Prometheus + Grafana](observabilidad.md)
- [Persistencia SQLite](persistencia-sqlite.md)
- [Arquitectura MCP Modular](ers-arquitectura-mcp.md): cliente MCP JSON-RPC 2.0 stdio, micro-servidores booking y devops desacoplados.

### Multiusuario (preparacion, gates cerrados)
- [Tenancy: fundamentos locales](tenancy.md)
- [Matriz local del minimo multiusuario](tenancy-auditoria-minima-local.md)

### Hoja de ruta y evolucion
- [Roadmap: 50 funciones](roadmap-50-funciones.md): plan de trabajo. Es una
  hoja de ruta, no un catalogo de capacidades entregadas; el estado real de
  cada funcion esta en [Capacidades](capacidades.md).
- [ERS: Arquitectura proximo nivel](ers-arquitectura-proximo-nivel.md): especificacion de requisitos del sistema para evolucion a arquitectura distribuida asincrona, inferencia especulativa hibrida, base de datos vectorial industrial y Model Context Protocol (MCP).
- [ERS: Desacoplamiento MCP y Carga Dinamica](ers-arquitectura-mcp.md): especificacion para fragmentar el monolito de 140 herramientas en micro-servidores MCP aislados, con RAG de herramientas y perfiles para comercios locales.
- [Guia Maestra de Estudio de Arquitectura](guia-estudio-arquitectura.md): guia exhaustiva de 5 sesiones con preguntas y respuestas modelo para entrevistas tecnicas.

## Convenciones

- Espanol, sin emojis en ningun fichero (la suite de pruebas lo audita).
- "Operativo" significa que funciona sin configuracion adicional en el
  despliegue actual. "Config-required" significa que la pieza existe pero
  queda desactivada hasta que el propietario defina credenciales o ajustes
  por entorno; el bot lo declara y nunca simula la funcion.
- Nada de lo documentado expone secretos, datos personales ni contenido de
  los ficheros de datos.
