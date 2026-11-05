# Roadmap: 50 funciones para F.R.I.D.A.Y.

Fuente del alcance: las 50 funcionalidades acordadas con David (documento "50 funciones para tu F.R.I.D.A.Y.", version corregida). Este archivo es el registro durable del estado de cada una: lo implementado, lo que requiere configuracion del propietario y lo pendiente.

## Leyenda de estados

- **Implementada**: herramientas cableadas al agente, con pruebas unitarias y de entrada.
- **Implementada, requiere config**: el codigo funciona, pero necesita credenciales o datos del propietario para dar resultados reales; sin ellos informa del estado, nunca simula.
- **Pendiente**: sin implementar. El bloque asignado es una propuesta de orden, no un compromiso cerrado.

## Resumen

- Implementadas: 40 de 50 operativas (nº 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 25, 26, 27, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50) + 4 pendientes de config del propietario (nº 1 radar; nº 16 backup: cifrado local operativo, subida externa pendiente de URL PAR; nº 23 watchdog externo: necesita host/servicio aparte; nº 24 gastos por foto: via de texto operativa, lectura de imagen pendiente de configurar el adaptador). La nº 36 lleva una dependencia externa relevante, ver su entrada.
- Pendientes: 6 de 50 (50 - 40 operativas - 4 config-required).

## Detalle por funcion

### Carrera y prácticas

- **1. Radar de ofertas de prácticas y empleo** - Adaptadores implementados, requiere config (bloque 1). Ninguna fuente real verificada todavia: el radar NO esta operativo hasta que David aporte credenciales o una fuente HTML. Dos adaptadores listos: InfoJobs (requiere credenciales INFOJOBS_CLIENT_ID e INFOJOBS_CLIENT_SECRET) y html-generico (requiere url y selectores CSS de la fuente). Sin configuracion lista informa del estado sin simular resultados. Monitor periodico cada 6 h (DAVIS_RADAR_INTERVALO_MS), alertas por la cola proactiva. Herramientas: escanear_ofertas_empleo, configurar_radar_ofertas.

- **2. CRM de candidaturas** - Implementada (bloque 1). CRM completo: registrar_candidatura (con dedupe y recordatorio de seguimiento automatico), listar_candidaturas, actualizar_candidatura. Estados: registrada, enviada, entrevista, oferta, descartada.

- **3. Simulador de entrevistas técnicas por voz o texto** - Implementada (bloque 10). Simulacro por chat de 5 preguntas con evaluacion de cada respuesta (VEREDICTO/COMENTARIO/SIGUIENTE) y cierre con nota. Las notas de voz llegan transcritas por el flujo de audio, asi que hablar o escribir es el mismo camino. Mientras hay simulacro activo, cada mensaje se evalua por un interceptor; la salida es determinista ("terminar entrevista"), anterior al modo. Sin el modelo no hay simulacro y lo dice. Herramienta: iniciar_simulacro_entrevista.

- **4. Analizador de CV contra oferta** - Implementada (bloque 10). Compara el CV con la oferta pegada (encaje, puntos fuertes, lagunas, consejo). El CV se pega como texto o se busca en las notas del segundo cerebro (titulo/tag "cv"), declarando la fuente; sin CV o sin modelo no inventa encaje. Herramienta: analizar_cv_oferta.

- **5. Planificador de estudio** - Implementada (bloque 2). Reparte el temario entre los dias hasta el examen (ultimo dia de repaso, calendario Europe/Madrid). Los recordatorios solo se programan con la hora elegida por David, nunca inventada; sin hora el plan se crea sin ellos y se piden despues. Herramientas: planificar_estudio, listar_planes_estudio, registrar_avance_estudio, programar_recordatorios_estudio.

- **6. Flashcards de repaso espaciado** - Implementada (bloque 2). Repeticion espaciada ligera (acierto espacia, fallo vuelve en 12h; la misma revision no se califica dos veces). Rondas proactivas DESACTIVADAS por defecto: solo con opt-in explicito de David, con cadencia minima, maximo 3 tarjetas por ronda y horario de silencio (22:00-8:00 por defecto). Herramientas: crear_flashcard, repasar_flashcards, responder_flashcard, configurar_repaso_flashcards.

- **7. Resumidor de apuntes** - Implementada (bloque 10). Resume un texto pegado o las notas del segundo cerebro que encajen con un criterio (titulo, categoria, tags o contenido), citando las notas usadas y sin mezclar las que no encajan. Sin modelo o sin coincidencias lo dice. Herramienta: resumir_apuntes.

- **8. Calendario de entregas y exámenes** - Implementada (bloque 10). Registro con dedupe por titulo+fecha, listado ordenado con dias restantes (Europe/Madrid) y borrado. Los avisos puntuales los cubre el sistema de recordatorios (nº 2) cuando David los pide; no hay monitor proactivo propio. La captura de notas personales excluye las frases de registro para que lleguen a JARVIS. Herramientas: registrar_entrega, listar_entregas, eliminar_entrega.

### Desarrollo y DevOps

- **9. Revisor de tus propias PRs** - Implementada (bloque 12). Lee la PR y su diff por la API publica de GitHub (repos publicos sin clave, 60 pet./h; DAVIS_GITHUB_TOKEN por entorno para privados o mas cuota, nunca por chat) y devuelve resena de seguridad y estilo (veredicto apto/apto con comentarios/necesita cambios) AQUI por WhatsApp. NUNCA publica comentarios en GitHub. Herramienta: revisar_pr.

- **10. Vigilante de dependencias** - Implementada (bloque 13). npm audit bajo demanda con resumen por severidad y propuesta de actualizacion (las de cambio mayor marcadas para revision manual; NUNCA auto-fix). Vigilancia programada con aviso solo de vulnerabilidades graves, SOLO con opt-in textual de David (el guard rechaza activacion solo por el modelo). Herramientas: auditar_dependencias, configurar_vigilancia_dependencias.

- **11. Panel de métricas del bot** - Implementada (bloque 13). Registro local JSONL de comandos/errores/tiempos (instrumentado en el flujo de entrada, incluido el error de JARVIS). Informe bajo demanda: comandos mas usados con media y p95, errores recientes. Informe semanal proactivo solo con opt-in textual y cadencia semanal real. Herramientas: informe_metricas, configurar_informe_metricas.

- **12. Alertas de actividad en tus repos** - Implementada (bloque 13). Instantanea publica bajo demanda (estrellas, forks, issues abiertas por la API publica de GitHub, sin clave). Avisos de cambios SOLO con opt-in textual: primera lectura guarda referencia, avisa de deltas y no repite sin cambios. Las menciones requieren DAVIS_GITHUB_TOKEN: declarado, no incluidas. Herramientas: actividad_repos, configurar_alertas_repos.

- **13. Generador de CHANGELOG** - Implementada (bloque 12). Redacta la entrada (Keep a Changelog, Anadido/Cambiado/Corregido) desde el git log del repo local (tag..HEAD o ultimos N commits), fiel a los mensajes. Propone texto: no toca CHANGELOG.md ni hace commits. Herramienta: generar_changelog.

- **14. Modo pair programming por voz** - Implementada (bloque 12). Guia la depuracion paso a paso (una hipotesis por turno, pide la salida concreta para seguir); las notas de voz llegan transcritas por el flujo de audio, asi que hablar o escribir es el mismo camino, y el historial mantiene el hilo. Sin modelo no hay guia y lo dice. Herramienta: guiar_depuracion.

- **15. Gestor de ideas y feature requests** - Implementada (bloque 12). Anota propuestas en local (data/ideas.json, fuera de git), las lista y propone prioridades con motivos SOLO bajo demanda (la propuesta no cambia nada). La revision semanal proactiva queda sin activar a proposito: requiere opt-in explicito. La captura de notas personales excluye las frases de registro de ideas para que lleguen a JARVIS. Herramientas: anotar_idea, listar_ideas, priorizar_ideas.

- **16. Backup externo de la sesión del bot** - Implementada parcialmente, requiere config (bloque 13). Copia CIFRADA local (tar + openssl AES-256-PBKDF2) de auth_info_baileys con clave por entorno (DAVIS_BACKUP_KEY, nunca por chat; sin ella, config-required honesto). La subida a Oracle Object Storage NO esta implementada: falta URL de subida (PAR) configurada en el servidor; sin ella se declara pendiente en vez de simularse. Herramienta: crear_backup_sesion.

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

- **29. Traductor en modo conversación** - Operativa (Bloque 5): modo traductor por chat ("activa el traductor a ingles"); cada mensaje de David se traduce al idioma elegido y "desactiva el traductor" lo apaga de forma determinista (la frase de apagado nunca se traduce). Usa el modelo de lenguaje ya configurado.

- **30. Respuestas sugeridas** - Operativa (Bloque 5): herramienta sugerir_respuestas (mensaje recibido + tono opcional) propone 3 respuestas; nunca las envia, David elige.

- **31. Buscador del historial** - Operativa (Bloque 5): herramienta buscar_en_historial busca un termino en el historial del chat (solo lectura, coincidencias mas recientes primero).

- **32. Cumpleaños y fechas señaladas** - Operativa (Bloque 6): registrar_fecha_senalada (dia y mes, anio opcional), listar y eliminar. Avisos proactivos solo con opt-in explicito (configurar_avisos_fechas con guard de intencion; registrar no implica opt-in): aviso el dia anterior y el mismo dia, una sola vez por fecha y anio, calendario Europe/Madrid.

- **33. Resumen automático de enlaces** - Operativa (ya existia): herramienta resumir_enlace (y navegar_y_leer_noticia) resume enlaces con el modelo configurado.

- **34. Snooze de conversaciones** - Operativa (Bloque 6): programar_snooze en el chat actual ("recuerdame este chat a las 18:00" o "en 2 horas"). Cada snooze es una peticion puntual de David: un solo aviso al llegar la hora, sin monitor permanente, y se puede cancelar.

- **35. Estadísticas de grupos** - Operativa (Bloque 6): estadisticas_grupo cuenta mensajes, reparto por rol, actividad por dia y hora punta del historial que el bot ha visto de ese chat. Limitacion declarada: solo cubre lo que el bot ha procesado, no todo el historial de WhatsApp.

- **36. Aviso de llegada** - Implementada (Bloque 6), con dependencia externa declarada: registrar_aviso_llegada con coordenadas del destino (si faltan, el bot pide el pin por WhatsApp). Vigila las ubicaciones (pin o en vivo) que llegan al chat; al entrar en el radio avisa una vez y se completa; caduca a las 12 h. DEPENDENCIA: el bot no tiene GPS propio; solo ve las ubicaciones que WhatsApp entrega al chat. Si la ubicacion en vivo se pausa, queda desactualizada o no se comparte, el aviso puede no dispararse. Probada con ubicaciones simuladas en la entrada real; el comportamiento con comparticion en vivo real queda por verificar en uso.

### Segundo cerebro

- **37. Memoria de contactos** - Operativa (Bloque 8): fichas de contacto (nombre, telefono, relacion, email, notas) con registro incremental, busqueda y listado. Datos introducidos por David.

- **38. Búsqueda semántica en memorias** - Operativa (Bloque 8): buscar_recuerdo_semantico junta candidatos por palabras clave en memorias y notas y el modelo elige por significado; sin modelo responde por palabras clave y lo declara.

- **39. Digest semanal del segundo cerebro** - Operativa (Bloque 8): generar_digest_cerebro bajo demanda (resumen con modelo o lista plana declarada). El envio proactivo semanal solo con opt-in explicito (configurar_digest_semanal con guard), los lunes, una vez por semana y solo si hay novedades.

- **40. Wiki personal navegable** - Operativa (Bloque 8): generar_wiki regenera data/notes/INDICE.md agrupado por categoria con enlaces relativos a cada nota y sus tags.

- **41. Captura desde el navegador** - Operativa (Bloque 8): capturar_pagina extrae el articulo con el navegador existente y lo archiva como nota con su fuente. Solo http/https.

- **42. Preguntas sobre tus documentos** - Operativa (Bloque 8): preguntar_documentos localiza las notas relevantes y el modelo responde citando fuentes; sin modelo devuelve los fragmentos y declara la falta de sintesis.

### Bienestar y ocio

- **43. Diario personal por voz o texto** - Implementada (bloque 9). Entradas por dia en data/diario/AAAA-MM-DD.md (append con hora, calendario Europe/Madrid). La voz llega transcrita por el flujo de audio existente, asi que es el mismo camino que el texto. La captura automatica de notas personales excluye las frases de diario para que lleguen al diario y no al Second Brain. Herramientas: escribir_diario, leer_diario.

- **44. Seguimiento de hábitos** - Implementada (bloque 9). Habitos con marcado diario y racha de dias seguidos (calendario Europe/Madrid; hoy o ayer sostienen la racha). Sin avisos proactivos: seguimiento bajo demanda de David. Herramientas: registrar_habito, marcar_habito, listar_habitos.

- **45. Planificador de menús semanal** - Implementada (bloque 9). Comida y cena por dia (lunes a domingo, semana anclada al lunes). sugerir_menu solo PROPONE con el modelo: la propuesta nunca se persiste sola; se guarda lo que David confirme con poner_menu. Herramientas: poner_menu, ver_menu, sugerir_menu.

- **46. Lista de la compra por voz o texto** - Implementada (bloque 9). Anadir (uno o varios, sin duplicados), listar, tachar y vaciar; vaciar solo con peticion textual de David. Herramientas: anadir_compra, listar_compra, tachar_compra, vaciar_compra.

- **47. Recomendador de series y pelis** - Implementada (bloque 9). Recomienda con el modelo usando los gustos guardados en memoria y sin repetir titulos ya recomendados (historial persistente). Sin el modelo no inventa recomendaciones. Herramienta: recomendar_serie_pelicula.

- **48. Planificador de quedadas** - Implementada (bloque 9). Registra quedadas (titulo, fecha, hora, lugar, participantes). redactar_invitacion devuelve SOLO un borrador para que David lo revise y lo envie el: el bot nunca lo manda a terceros. Herramientas: crear_quedada, listar_quedadas, redactar_invitacion.

- **49. Resumen deportivo** - Implementada (bloque 9). Usa las fuentes RSS reales ya curadas en newsService (rama deportes: El Confidencial, El Periodico, Marca). Resume solo lo que traen los titulares; si los feeds no responden o no hay titulares, lo dice y no inventa marcadores. Herramienta: resumen_deportivo.

- **50. Modo desconexión nocturno** - Implementada (bloque 9). Activo y dentro de la franja (por defecto 23:00-08:00, Europe/Madrid, cruza medianoche), drenarColaAlertas retiene las alertas no urgentes en cola hasta que acabe la franja; nada se descarta. Los recordatorios puntuales que David programa suenan igual. No lleva guardia de opt-in porque la direccion segura es silenciar, y la activacion la pide el propio David por chat. Herramienta: configurar_modo_nocturno.

## Orden de trabajo propuesto

1. **Bloque 1 - Empleo y practicas (nº 1 y 2)**: implementado en esta rama. Priorizado por la busqueda de practicas activa de David.
2. **Bloque 2 - Estudio (nº 5 y 6)**: implementado en esta rama (planificador + flashcards sobre el sistema de recordatorios existente).
3. **Bloque 3 - Finanzas (nº 24 a 27)**: registro de gastos, resumen mensual, suscripciones y presupuesto.
4. **Bloque 4 - Servidor (nº 17 y 23)**: vigilante de CPU y watchdog externo del bot.
5. **Bloque 5 - Comunicacion (nº 29 a 31, 33)**: traductor por chat, respuestas sugeridas, buscador de historial; resumen de enlaces ya existia.
6. **Bloque 6 - Comunicacion (nº 32, 34, 35, 36)**: fechas senaladas, snooze de chats, estadisticas de grupos y aviso de llegada.
7. **Bloque 8 - Segundo cerebro (nº 37 a 42)**: contactos, busqueda semantica, digest, wiki, captura web y preguntas a documentos.
8. **Resto**: se prioriza con David segun utilidad inmediata.

## Bloques extra aprobados (fuera de las 50)

- **Buscador de productos bajo demanda** (aprobado por David el 5 nov 2026, WhatsApp "implementalo" en respuesta al diseno entregado; alcance fijado por el enrutador: busqueda y verificacion bajo demanda, SIN compras, SIN vigilancia automatica, SIN altas ni APIs de pago; etapas 2 y 3 del diseno NO activadas): OPERATIVA a nivel de servicio y cableada a la entrada real (intent compras, herramientas buscar_producto y verificar_oferta, deps en whatsappBot, pruebas de entrada). Verificacion de ofertas: funciona ya sobre cualquier pagina con JSON-LD (lee precio/stock de la propia ficha y declara la hora de comprobacion; lo no legible es no-verificable, nunca inventado). Busqueda: OPERATIVA con el comparador PriceRadars integrado (API JSON publica, gratuita, sin alta ni clave, cobertura ES; verificada en vivo el 5 nov 2026; DAVIS_COMPRAS_FUENTE=priceradars por defecto). Limites declarados: cobertura desigual (pueden dominar accesorios de marketplaces) y precios de feeds que el comercio confirma en su web. APIs oficiales (eBay Browse: alta gratuita en developer.ebay.com; Amazon Creators/PA-API: cuenta Associates) quedan config-required como mejora opcional. Endurecimiento de verificacion: apertura anti-SSRF (safeFetch: solo http(s), puertos 80/443, rechazo de IPs privadas/reservadas, redirecciones revalidadas, tope de tamano y tiempo), vinculacion oferta-producto (si la pagina no es del producto pedido, el precio NO se confirma) y validacion de moneda ISO 4217. Sin compras, sin vigilancia, sin altas ni APIs de pago. No cuenta para el total de las 50.


- **Transporte publico de Madrid** (aprobado por David el 5 nov 2026, WhatsApp "sip metelas" en respuesta a la propuesta con alcance EMT + Cercanias, favoritos y consulta bajo demanda, sin avisos automaticos): paradas favoritas EMT y estaciones de Cercanias con consulta de llegadas cuando David pregunta. EMT: adaptador MobilityLabs config-required (alta gratuita; credenciales DAVIS_EMT_CLIENT_ID y DAVIS_EMT_PASS_KEY en el entorno, nunca por chat). Cercanias: feed GTFS-RT publico de Renfe, operativo sin credenciales; solo muestra servicios con informacion en vivo y lo declara. Metro: sin fuente publica verificada de llegadas en vivo; no se ofrece. Sin avisos automaticos ni monitores. No cuenta para el total de las 50.

## Configuracion que necesita David para el bloque 1

- **Radar con InfoJobs**: variables INFOJOBS_CLIENT_ID e INFOJOBS_CLIENT_SECRET en el entorno del bot.
- **Radar con fuente HTML propia**: url del portal y selectores CSS (item, titulo, enlace; empresa y ubicacion opcionales) en data/job_radar.json o via configurar_radar_ofertas.
- Sin esa configuracion el radar responde con el estado config-required de cada fuente, sin inventar ofertas.
