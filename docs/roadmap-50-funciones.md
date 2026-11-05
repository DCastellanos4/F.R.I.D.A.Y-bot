# Roadmap: 50 funciones para F.R.I.D.A.Y.

Fuente del alcance: las 50 funcionalidades acordadas con David (documento "50 funciones para tu F.R.I.D.A.Y.", version corregida). Este archivo es el registro durable del estado de cada una: lo implementado, lo que requiere configuracion del propietario y lo pendiente.

## Leyenda de estados

- **Implementada**: herramientas cableadas al agente, con pruebas unitarias y de entrada.
- **Implementada, requiere config**: el codigo funciona, pero necesita credenciales o datos del propietario para dar resultados reales; sin ellos informa del estado, nunca simula.
- **Pendiente**: sin implementar. El bloque asignado es una propuesta de orden, no un compromiso cerrado.

## Resumen

- Implementadas: 7 de 50 operativas (nº 2 CRM, nº 5 planificador, nº 6 flashcards, nº 17 vigilante de procesos/recursos, nº 25 resumen mensual, nº 26 suscripciones, nº 27 presupuestos) + 3 pendientes de config del propietario (nº 1 radar; nº 23 watchdog externo: necesita host/servicio aparte; nº 24 gastos por foto: la via de texto es operativa, la lectura de imagen no es operativa hasta configurar el adaptador).
- Pendientes: 46 de 50.

## Detalle por funcion

### Carrera y prácticas

- **1. Radar de ofertas de prácticas y empleo** - Adaptadores implementados, requiere config (bloque 1). Ninguna fuente real verificada todavia: el radar NO esta operativo hasta que David aporte credenciales o una fuente HTML. Dos adaptadores listos: InfoJobs (requiere credenciales INFOJOBS_CLIENT_ID e INFOJOBS_CLIENT_SECRET) y html-generico (requiere url y selectores CSS de la fuente). Sin configuracion lista informa del estado sin simular resultados. Monitor periodico cada 6 h (DAVIS_RADAR_INTERVALO_MS), alertas por la cola proactiva. Herramientas: escanear_ofertas_empleo, configurar_radar_ofertas.

- **2. CRM de candidaturas** - Implementada (bloque 1). CRM completo: registrar_candidatura (con dedupe y recordatorio de seguimiento automatico), listar_candidaturas, actualizar_candidatura. Estados: registrada, enviada, entrevista, oferta, descartada.

- **3. Simulador de entrevistas técnicas por voz** - Pendiente. Bloque por priorizar.

- **4. Analizador de CV contra oferta** - Pendiente. Bloque por priorizar.

- **5. Planificador de estudio** - Implementada (bloque 2). Reparte el temario entre los dias hasta el examen (ultimo dia de repaso, calendario Europe/Madrid). Los recordatorios solo se programan con la hora elegida por David, nunca inventada; sin hora el plan se crea sin ellos y se piden despues. Herramientas: planificar_estudio, listar_planes_estudio, registrar_avance_estudio, programar_recordatorios_estudio.

- **6. Flashcards de repaso espaciado** - Implementada (bloque 2). Repeticion espaciada ligera (acierto espacia, fallo vuelve en 12h; la misma revision no se califica dos veces). Rondas proactivas DESACTIVADAS por defecto: solo con opt-in explicito de David, con cadencia minima, maximo 3 tarjetas por ronda y horario de silencio (22:00-8:00 por defecto). Herramientas: crear_flashcard, repasar_flashcards, responder_flashcard, configurar_repaso_flashcards.

- **7. Resumidor de apuntes** - Pendiente. Bloque por priorizar.

- **8. Calendario de entregas y exámenes** - Pendiente. Bloque por priorizar.

### Desarrollo y DevOps

- **9. Revisor de tus propias PRs** - Pendiente. Bloque por priorizar.

- **10. Vigilante de dependencias** - Pendiente. Bloque por priorizar.

- **11. Panel de métricas del bot** - Pendiente. Bloque por priorizar.

- **12. Alertas de actividad en tus repos** - Pendiente. Bloque por priorizar.

- **13. Generador de CHANGELOG** - Pendiente. Bloque por priorizar.

- **14. Modo pair programming por voz** - Pendiente. Bloque por priorizar.

- **15. Gestor de ideas y feature requests** - Pendiente. Bloque por priorizar.

- **16. Backup externo de la sesión del bot** - Pendiente. Bloque por priorizar.

### Servidor y hogar

- **17. Vigilante de CPU y procesos del VPS** - Operativa (Bloque 4): la saturacion global de CPU/RAM con diagnostico de procesos ya la cubria el vigilante proactivo; se suma el registro de procesos concretos con limites de CPU/memoria, aviso una vez por caida/recuperacion y enfriamiento de 30 minutos por limite. La vigilancia proactiva solo arranca con opt-in explicito del propietario; solo mide y avisa, nunca reinicia procesos.

- **18. Wake-on-LAN** - Pendiente. Bloque por priorizar.

- **19. Monitor de red doméstica** - Pendiente. Bloque por priorizar.

- **20. Control de domótica** - Pendiente. Bloque por priorizar.

- **21. Panel de descargas** - Pendiente. Bloque por priorizar.

- **22. Termómetro de la factura de Oracle** - Pendiente. Bloque por priorizar.

- **23. Watchdog externo del bot** - Pendiente de configuracion (Bloque 4): scripts/watchdog.js comprueba la URL publica de salud del bot (/api/salud) y avisa por webhook si cae. Requiere que David lo ejecute en un host o servicio EXTERNO al VPS (un vigilante en el mismo host no cubre la caida del host) y defina DAVIS_HEALTHCHECK_URL (+ DAVIS_WATCHDOG_WEBHOOK opcional). Sin esa configuracion no es operativo.

### Finanzas personales

- **24. Registro de gastos por foto** - Adaptador pendiente de configuracion (Bloque 3): pipeline foto -> borrador -> confirmacion implementado y cableado en la entrada de WhatsApp (aislado por chat, caduca a los 30 min, un solo uso; nada se registra sin el "si" de David). La lectura de la imagen la hace un adaptador real (src/services/ticketVisionAdapter.js): se activa configurando DAVIS_TICKET_VISION_MODEL con un modelo con vision del proveedor ya configurado (por ejemplo gpt-4o-mini); el adaptador envia la foto a ese modelo con un prompt estricto y devuelve solo datos estructurados, y David confirma antes de que se registre nada. Sin esa variable NO es operativo y el bot lo dice claramente. La via de texto ("registra un gasto de 12,50 en Mercadona") es operativa desde ya.

- **25. Resumen mensual de gasto** - Operativa (Bloque 3): herramienta resumen_gastos_mes con comparativa por categoria frente al mes anterior.

- **26. Vigilante de suscripciones** - Operativa (Bloque 3): suscripciones registradas por el propietario con aviso 3 dias antes de cada renovacion, una sola vez por renovacion. Los avisos proactivos solo se activan si el propietario lo pide textualmente ("activa los avisos de suscripciones", herramienta configurar_avisos_suscripciones con guard de intencion); registrar una suscripcion no implica opt-in.

- **27. Presupuesto mensual con alertas** - Operativa (Bloque 3): presupuesto por categoria con alerta al superar el 80% del limite (configurar_presupuesto / estado_presupuestos).

- **28. Seguimiento de vuelos y trenes** - Pendiente. Bloque por priorizar.

### Comunicación y WhatsApp

- **29. Traductor en modo conversación** - Pendiente. Bloque por priorizar.

- **30. Respuestas sugeridas** - Pendiente. Bloque por priorizar.

- **31. Buscador del historial** - Pendiente. Bloque por priorizar.

- **32. Cumpleaños y fechas señaladas** - Pendiente. Bloque por priorizar.

- **33. Resumen automático de enlaces** - Pendiente. Bloque por priorizar.

- **34. Snooze de conversaciones** - Pendiente. Bloque por priorizar.

- **35. Estadísticas de grupos** - Pendiente. Bloque por priorizar.

- **36. Aviso de llegada** - Pendiente. Bloque por priorizar.

### Segundo cerebro

- **37. Memoria de contactos** - Pendiente. Bloque por priorizar.

- **38. Búsqueda semántica en memorias** - Pendiente. Bloque por priorizar.

- **39. Digest semanal del segundo cerebro** - Pendiente. Bloque por priorizar.

- **40. Wiki personal navegable** - Pendiente. Bloque por priorizar.

- **41. Captura desde el navegador** - Pendiente. Bloque por priorizar.

- **42. Preguntas sobre tus documentos** - Pendiente. Bloque por priorizar.

### Bienestar y ocio

- **43. Diario personal por voz** - Pendiente. Bloque por priorizar.

- **44. Seguimiento de hábitos** - Pendiente. Bloque por priorizar.

- **45. Planificador de menús semanal** - Pendiente. Bloque por priorizar.

- **46. Lista de la compra por voz** - Pendiente. Bloque por priorizar.

- **47. Recomendador de series y pelis** - Pendiente. Bloque por priorizar.

- **48. Planificador de quedadas** - Pendiente. Bloque por priorizar.

- **49. Resumen deportivo** - Pendiente. Bloque por priorizar.

- **50. Modo desconexión nocturno** - Pendiente. Bloque por priorizar.

## Orden de trabajo propuesto

1. **Bloque 1 - Empleo y practicas (nº 1 y 2)**: implementado en esta rama. Priorizado por la busqueda de practicas activa de David.
2. **Bloque 2 - Estudio (nº 5 y 6)**: implementado en esta rama (planificador + flashcards sobre el sistema de recordatorios existente).
3. **Bloque 3 - Finanzas (nº 24 a 27)**: registro de gastos, resumen mensual, suscripciones y presupuesto.
4. **Bloque 4 - Servidor (nº 17 y 23)**: vigilante de CPU y watchdog externo del bot.
5. **Resto**: se prioriza con David segun utilidad inmediata.

## Configuracion que necesita David para el bloque 1

- **Radar con InfoJobs**: variables INFOJOBS_CLIENT_ID e INFOJOBS_CLIENT_SECRET en el entorno del bot.
- **Radar con fuente HTML propia**: url del portal y selectores CSS (item, titulo, enlace; empresa y ubicacion opcionales) en data/job_radar.json o via configurar_radar_ofertas.
- Sin esa configuracion el radar responde con el estado config-required de cada fuente, sin inventar ofertas.
