export const herramientasJarvis = [
  {
    type: 'function',
    function: {
      name: 'planificar_estudio',
      description: 'Crea un plan de estudio para una asignatura: reparte los temas entre los dias que quedan hasta el examen (ultimo dia de repaso) y programa un recordatorio por sesion.',
      parameters: {
        type: 'object',
        properties: {
          asignatura: { type: 'string', description: 'Nombre de la asignatura o examen.' },
          fechaExamen: { type: 'string', description: 'Fecha del examen en formato AAAA-MM-DD.' },
          temas: { type: 'array', items: { type: 'string' }, description: 'Lista de temas a repartir.' },
          horaEstudio: { type: 'string', description: 'Hora diaria del recordatorio, formato HH:MM. Sin hora no se programan recordatorios; el bot la pide despues.' }
        },
        required: ['asignatura', 'fechaExamen', 'temas']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_planes_estudio',
      description: 'Lista los planes de estudio activos con su progreso (sesiones completadas y pendientes).',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'registrar_avance_estudio',
      description: 'Marca como completada una sesion de estudio de un plan (la primera pendiente, o la de una fecha concreta).',
      parameters: {
        type: 'object',
        properties: {
          criterio: { type: 'string', description: 'ID del plan o texto de la asignatura.' },
          fecha: { type: 'string', description: 'Fecha de la sesion (AAAA-MM-DD). Sin fecha, la primera pendiente.' }
        },
        required: ['criterio']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'programar_recordatorios_estudio',
      description: 'Programa los recordatorios de un plan de estudio ya creado, a la hora elegida por David. Solo una vez por plan.',
      parameters: {
        type: 'object',
        properties: {
          criterio: { type: 'string', description: 'ID del plan o texto de la asignatura.' },
          hora: { type: 'string', description: 'Hora diaria elegida por David, formato HH:MM (ej: 17:30).' }
        },
        required: ['criterio', 'hora']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'crear_flashcard',
      description: 'Crea una tarjeta de repaso espaciado (pregunta y respuesta) para una asignatura. Entra en repaso inmediatamente.',
      parameters: {
        type: 'object',
        properties: {
          asignatura: { type: 'string', description: 'Asignatura o mazo. Por defecto "general".' },
          pregunta: { type: 'string', description: 'Pregunta de la tarjeta.' },
          respuesta: { type: 'string', description: 'Respuesta correcta.' }
        },
        required: ['pregunta', 'respuesta']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'repasar_flashcards',
      description: 'Muestra las tarjetas que tocan repasar ahora (repaso espaciado), con su ID para responder.',
      parameters: {
        type: 'object',
        properties: {
          limite: { type: 'number', description: 'Maximo de tarjetas a mostrar. Por defecto 3.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'configurar_repaso_flashcards',
      description: 'Configura las rondas proactivas de repaso de flashcards: cadencia, horario de silencio y activacion. activo=true solo si David lo pidio textualmente en su mensaje.',
      parameters: {
        type: 'object',
        properties: {
          activo: { type: 'boolean', description: 'true solo si David pidio activar las rondas textualmente.' },
          cadenciaHoras: { type: 'number', description: 'Horas minimas entre rondas (1-24). Por defecto 4.' },
          silencioDesde: { type: 'number', description: 'Hora (0-23) desde la que no se envian repasos. Por defecto 22.' },
          silencioHasta: { type: 'number', description: 'Hora (0-23) hasta la que no se envian repasos. Por defecto 8.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'responder_flashcard',
      description: 'Registra como de bien recordaste una tarjeta (calidad 0-5). Acierto (>=3): el repaso se espacia; fallo: vuelve pronto.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID de la tarjeta.' },
          calidad: { type: 'number', description: 'Nota del 0 al 5 sobre como de bien la recordaste.' }
        },
        required: ['id', 'calidad']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'registrar_candidatura',
      description: 'Registra una candidatura de practicas o empleo en el CRM personal: empresa, puesto y estado, con recordatorio de seguimiento opcional para no dejar morir el proceso.',
      parameters: {
        type: 'object',
        properties: {
          empresa: { type: 'string', description: 'Nombre de la empresa.' },
          puesto: { type: 'string', description: 'Puesto o rol al que se aplica.' },
          url: { type: 'string', description: 'Enlace de la oferta, si existe.' },
          estado: { type: 'string', enum: ['registrada', 'enviada', 'entrevista', 'oferta', 'descartada'], description: 'Estado actual del proceso. Por defecto "registrada".' },
          notas: { type: 'string', description: 'Notas libres (contacto, salario, stack...).' },
          seguimientoDias: { type: 'number', description: 'Dias hasta el recordatorio de seguimiento (ej: 5). Sin valor no se crea recordatorio.' }
        },
        required: ['empresa', 'puesto']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_candidaturas',
      description: 'Lista las candidaturas registradas, con filtro opcional por estado, o el resumen del pipeline si no hay ninguna.',
      parameters: {
        type: 'object',
        properties: {
          estado: { type: 'string', enum: ['registrada', 'enviada', 'entrevista', 'oferta', 'descartada'], description: 'Filtro opcional por estado.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'actualizar_candidatura',
      description: 'Actualiza el estado o las notas de una candidatura existente, localizada por id o por texto de empresa/puesto.',
      parameters: {
        type: 'object',
        properties: {
          criterio: { type: 'string', description: 'Id de la candidatura o texto de empresa/puesto que la identifique.' },
          estado: { type: 'string', enum: ['registrada', 'enviada', 'entrevista', 'oferta', 'descartada'], description: 'Nuevo estado del proceso.' },
          notas: { type: 'string', description: 'Nota a anadir al historial de notas.' }
        },
        required: ['criterio']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'escanear_ofertas_empleo',
      description: 'Ejecuta ahora una ronda del radar de ofertas de practicas/empleo con la configuracion guardada. Informa del estado real de cada fuente; si falta configuracion o credenciales lo dice en lugar de inventar ofertas.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'configurar_radar_ofertas',
      description: 'Configura el radar de ofertas: palabras clave, ubicacion, remoto y activacion. Necesario antes del primer escaneo util.',
      parameters: {
        type: 'object',
        properties: {
          palabrasClave: { type: 'array', items: { type: 'string' }, description: 'Terminos de busqueda (ej: ["full stack", "practicas"]).' },
          ubicacion: { type: 'string', description: 'Provincia o ciudad objetivo (ej: Madrid).' },
          remoto: { type: 'boolean', description: 'true para priorizar remoto.' },
          activo: { type: 'boolean', description: 'true solo si David pidio activar el radar textualmente en su mensaje; la activacion sin peticion explicita se rechaza.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'consultar_clima',
      description: 'OBLIGATORIA: Consulta el estado meteorológico actual y la previsión (temperatura, probabilidad de lluvia, viento, estado del cielo) para cualquier ciudad, pueblo o lugar del mundo tanto de hoy como de mañana, incluyendo horas específicas si se solicitan (ej: Madrid, Barcelona, Valencia, Londres).',
      parameters: {
        type: 'object',
        properties: {
          ubicacion: {
            type: 'string',
            description: 'Nombre de la ciudad, pueblo o lugar a consultar (ej: Madrid, Barcelona, Valencia). Por defecto Madrid.'
          },
          momento: {
            type: 'string',
            enum: ['hoy', 'mañana', 'semana'],
            description: 'Momento de la previsión: "hoy", "mañana" o "semana". Por defecto "hoy".'
          },
          hora: {
            type: 'string',
            description: 'Hora específica opcional si el usuario menciona una hora (ej: "7", "07:00", "7 de la mañana", "15:00", "tarde", "noche").'
          }
        },
        required: ['ubicacion']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'obtener_noticias_actuales',
      description: 'Obtiene las noticias y titulares reales y de última hora con enlace directo a la noticia para leerla completa.',
      parameters: {
        type: 'object',
        properties: {
          categoria: {
            type: 'string',
            enum: ['politica', 'tecnologia', 'economia', 'deportes', 'mundo'],
            description: 'Rama o categoría de noticias deseada.'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'navegar_y_leer_noticia',
      description: 'OBLIGATORIA: Abre y navega en vivo con un navegador real (Playwright Chromium) a cualquier noticia, artículo periodístico o enlace web (URL) para leer su contenido completo, verificar la noticia antes de informar a David y extraer detalles profundos superando muros de cookies o JavaScript.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'La URL completa de la noticia o página web a abrir con el navegador Chromium de Playwright'
          }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'resumir_enlace',
      description: 'Descarga, lee con navegador Playwright y sintetiza en un resumen ejecutivo táctico cualquier página web, noticia o vídeo de YouTube proporcionado mediante una URL.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'La URL completa del artículo web o vídeo de YouTube a resumir'
          }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'guardar_memoria',
      description: 'OBLIGATORIA: Guarda permanentemente en el Second Brain un dato personal de David, hecho, preferencia, familiar, cumpleaños, medida, talla, calzado, contraseña, código, clave, wifi o email para recordarlo siempre.',
      parameters: {
        type: 'object',
        properties: {
          sujeto: {
            type: 'string',
            description: 'Sujeto o persona principal (ej: David, hermano, madre, alarma, wifi, correo, Fran)'
          },
          dato: {
            type: 'string',
            description: 'El hecho o detalle exacto y completo (ej: su cumpleaños es el 15 de agosto, calza un 43 de zapatillas, clave es 9876, correo es davidllanos2005@gmail.com)'
          },
          categoria: {
            type: 'string',
            enum: ['persona', 'clave', 'contacto', 'preferencia', 'trabajo', 'general'],
            description: 'Categoría para clasificar el recuerdo'
          }
        },
        required: ['sujeto', 'dato']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'buscar_memoria',
      description: 'OBLIGATORIA: Consulta y recupera del Second Brain cualquier dato, recuerdo, cumpleaños, calzado, clave, contraseña, código, pin, correo o hecho del pasado que David pregunte.',
      parameters: {
        type: 'object',
        properties: {
          consulta: {
            type: 'string',
            description: 'Término, persona, objeto o concepto que se desea consultar (ej: correo, hermano, calzado, cumpleaños madre, alarma, wifi)'
          }
        },
        required: ['consulta']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_memorias',
      description: 'Devuelve todos los recuerdos o datos personales almacenados actualmente en el Second Brain.',
      parameters: {
        type: 'object',
        properties: {
          categoria: {
            type: 'string',
            description: 'Filtro opcional de categoría'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'olvidar_memoria',
      description: 'Elimina un recuerdo específico o todos los recuerdos del Second Brain cuando David pide borrar o olvidar un dato. El borrado masivo (criterio "*" o "todos") nunca lo confirmas tú: queda pendiente y solo se ejecuta si David responde "confirmar borrado <id>" directamente.',
      parameters: {
        type: 'object',
        properties: {
          criterio: {
            type: 'string',
            description: 'Palabra clave, sujeto o "*" para borrar todas las memorias'
          }
        },
        required: ['criterio']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'vigilar_producto',
      description: 'Activa el Sniper de precios para vigilar un producto en Amazon u otra tienda y avisar si baja a un precio objetivo, o actualiza el precio objetivo de un producto ya vigilado.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Enlace web completo del producto a vigilar (opcional si ya está vigilado)'
          },
          precioObjetivo: {
            type: 'number',
            description: 'Precio en euros al que se desea que J.A.R.V.I.S. avise si baja'
          },
          nombre: {
            type: 'string',
            description: 'Nombre descriptivo del artículo'
          }
        },
        required: ['precioObjetivo']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_productos_vigilados',
      description: 'Devuelve todos los artículos que el Sniper está vigilando actualmente y sus precios objetivo.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cancelar_vigilancia',
      description: 'Detiene el seguimiento de un producto en el Sniper (o "*" para cancelar todas).',
      parameters: {
        type: 'object',
        properties: {
          criterio: {
            type: 'string',
            description: 'Nombre, ID del producto o "*" para todas'
          }
        },
        required: ['criterio']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'crear_recordatorio',
      description: 'OBLIGATORIA: Guarda y programa en el sistema un recordatorio, aviso o alarma personal cuando el usuario dice recuérdame, recuerdame, avísame, ponme una alarma, acuérdate de, etc.',
      parameters: {
        type: 'object',
        properties: {
          mensaje: {
            type: 'string',
            description: 'El contenido exacto del recordatorio (ej: Apagar el horno, llamar a Simyo)'
          },
          minutosEnElFuturo: {
            type: 'number',
            description: 'Número de minutos si el usuario dice en X minutos (o 60 si dice en 1 hora)'
          },
          hora: {
            type: 'string',
            description: 'Hora en formato HH:MM o H (ej: "21:30", "08:00", "9", "21")'
          }
        },
        required: ['mensaje']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_recordatorios',
      description: 'Consulta y devuelve todos los recordatorios pendientes programados en el sistema.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cancelar_recordatorio',
      description: 'Elimina o cancela un recordatorio programado (o "*" para cancelar todos).',
      parameters: {
        type: 'object',
        properties: {
          criterio: {
            type: 'string',
            description: 'ID del recordatorio, texto clave o "*"'
          }
        },
        required: ['criterio']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'programar_mensaje_whatsapp',
      description: 'OBLIGATORIA: Envía o programa un mensaje de WhatsApp a un número de teléfono de destino (o contacto), ya sea INMEDIATAMENTE (ahora / ya) o a una hora/fecha específica futura.',
      parameters: {
        type: 'object',
        properties: {
          numero: {
            type: 'string',
            description: 'Número de teléfono de destino (ej: 612345678, +34612345678, 34612345678). Si no incluye código internacional, se aplicará por defecto el prefijo de España (+34).'
          },
          mensaje: {
            type: 'string',
            description: 'El texto exacto que se desea enviar al destinatario.'
          },
          inmediato: {
            type: 'boolean',
            description: 'Establecer en true si el usuario solicita enviar el mensaje AHORA, ya o inmediatamente (o si no especificó ninguna hora futura).'
          },
          minutosEnElFuturo: {
            type: 'number',
            description: 'Minutos en el futuro para realizar el envío (0 si es ahora, 10 si dice en 10 minutos).'
          },
          hora: {
            type: 'string',
            description: 'Hora del día en formato HH:MM o H (ej: "18:00", "18", "08:30"). Omitir si es para enviar ahora.'
          },
          fecha: {
            type: 'string',
            description: 'Fecha específica opcional si el envío no es hoy (ej: "mañana", "2026-10-28", "28/10/2026").'
          }
        },
        required: ['numero', 'mensaje']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_mensajes_programados',
      description: 'Consulta todos los mensajes de WhatsApp programados pendientes de ser enviados a números de teléfono.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cancelar_mensaje_programado',
      description: 'Cancela un mensaje de WhatsApp programado antes de su envío (o "*" para cancelar todos los pendientes).',
      parameters: {
        type: 'object',
        properties: {
          criterio: {
            type: 'string',
            description: 'ID del mensaje programado, número de teléfono de destino o "*" para cancelar todos.'
          }
        },
        required: ['criterio']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'consultar_estado_servidor',
      description: 'Devuelve la salud del servidor Oracle (RAM, CPU) y el estado del servidor de Minecraft.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'activar_modo_vip',
      description: 'Activa o desactiva el Modo Filtro VIP / No molestar de David, restringiendo llamadas y mensajes de personas externas salvo emergencias.',
      parameters: {
        type: 'object',
        properties: {
          activar: {
            type: 'boolean',
            description: 'true para activar el Modo VIP, false para desactivarlo.'
          },
          contacto_vip: {
            type: 'string',
            description: 'Opcional: Número de teléfono para añadir simultáneamente a la lista blanca autorizada.'
          }
        },
        required: ['activar']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'estado_modo_vip',
      description: 'Consulta el estado actual del Modo Filtro VIP y la lista de contactos en la lista blanca.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'agregar_contacto_vip',
      description: 'Añade un número telefónico a la lista blanca del Filtro VIP para permitir que sus mensajes lleguen a David sin bloqueo.',
      parameters: {
        type: 'object',
        properties: {
          contacto: {
            type: 'string',
            description: 'Número de teléfono o identificador del contacto autorizar.'
          }
        },
        required: ['contacto']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'resumir_grupo',
      description: 'Genera un resumen inteligente y estructurado de los mensajes acumulados en un grupo de WhatsApp, destacando menciones a David y tareas pendientes.',
      parameters: {
        type: 'object',
        properties: {
          id_grupo: {
            type: 'string',
            description: 'Identificador del grupo de WhatsApp (ej: 123456@g.us o nombre del grupo si está en memoria).'
          },
          horas_atras: {
            type: 'number',
            description: 'Ventana de tiempo en horas a analizar (por defecto 24).'
          },
          max_mensajes: {
            type: 'number',
            description: 'Número máximo de mensajes a analizar (por defecto 50).'
          }
        },
        required: ['id_grupo']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'descargar_multimedia',
      description: 'Descarga contenido multimedia de un enlace (YouTube, Instagram Reels, TikTok) y devuelve los datos del archivo descargado.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Enlace web del vídeo o audio a descargar.'
          },
          formato: {
            type: 'string',
            enum: ['video', 'audio'],
            description: 'Formato de entrega: "video" (MP4 optimizado) o "audio" (MP3). Por defecto "video".'
          }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'guardar_nota_personal',
      description: 'Guarda una nota, reflexión o apunte de David en formato Markdown en el almacenamiento local del sistema.',
      parameters: {
        type: 'object',
        properties: {
          texto: {
            type: 'string',
            description: 'Contenido completo de la nota o reflexión a archivar.'
          },
          categoria: {
            type: 'string',
            enum: ['ideas', 'tareas', 'personal', 'proyectos', 'general'],
            description: 'Categoría para organizar la nota en el Second Brain.'
          },
          etiquetas: {
            type: 'array',
            items: { type: 'string' },
            description: 'Etiquetas temáticas opcionales (tags).'
          }
        },
        required: ['texto']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_notas_recientes',
      description: 'Consulta las últimas notas personales archivadas en el Second Brain local.',
      parameters: {
        type: 'object',
        properties: {
          categoria: {
            type: 'string',
            description: 'Filtrar notas por categoría opcional.'
          },
          limite: {
            type: 'number',
            description: 'Número máximo de notas a devolver (por defecto 10).'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'enviar_contacto_vcard',
      description: 'Genera y envía una tarjeta digital de contacto vCard (.vcf) nativa a través de WhatsApp.',
      parameters: {
        type: 'object',
        properties: {
          nombre: {
            type: 'string',
            description: 'Nombre y apellidos del contacto.'
          },
          telefono: {
            type: 'string',
            description: 'Número de teléfono con prefijo internacional (ej: +34612345678).'
          },
          organizacion: {
            type: 'string',
            description: 'Empresa u organización opcional.'
          }
        },
        required: ['nombre', 'telefono']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'crear_encuesta_whatsapp',
      description: 'Publica una encuesta interactiva nativa de WhatsApp con pregunta y opciones de respuesta.',
      parameters: {
        type: 'object',
        properties: {
          pregunta: {
            type: 'string',
            description: 'La pregunta o título de la encuesta.'
          },
          opciones: {
            type: 'array',
            items: { type: 'string' },
            description: 'Lista de opciones de votación (mínimo 2, máximo 12).'
          },
          multiple: {
            type: 'boolean',
            description: 'Permitir selección múltiple de opciones (por defecto false).'
          }
        },
        required: ['pregunta', 'opciones']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'execute_bash_command',
      description: 'Ejecuta de forma controlada comandos de consola bash en el sistema. Los comandos de lectura se ejecutan de inmediato; los comandos criticos o de impacto generan un codigo OTP efimero de 6 digitos (validez 120 segundos) para autorizacion previa.',
      parameters: {
        type: 'object',
        properties: {
          comando: {
            type: 'string',
            description: 'El comando de terminal bash a ejecutar (ej: "uptime", "free -m", "df -h", "pm2 restart jarvis-api").'
          }
        },
        required: ['comando']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generate_crypto_credential',
      description: 'Genera credenciales criptograficas seguras mediante CSPRNG (contraseñas de alta entropia, PINs numericos, tokens aleatorios o claves simetricas AES) con opcion de guardado permanente en el Second Brain.',
      parameters: {
        type: 'object',
        properties: {
          tipo: {
            type: 'string',
            enum: ['password', 'pin', 'token', 'key'],
            description: 'Tipo de credencial a generar: "password", "pin", "token" o "key".'
          },
          longitud: {
            type: 'number',
            description: 'Longitud deseada en caracteres o digitos (por defecto 16 para passwords, 6 para PIN, 32 para token).'
          },
          algoritmo: {
            type: 'string',
            enum: ['aes-256', 'aes-512', 'aes-128'],
            description: 'Algoritmo para clave criptografica (por defecto "aes-256").'
          },
          guardar_en_memoria: {
            type: 'boolean',
            description: 'Indica si la credencial generada debe persistirse de forma segura en el Second Brain bajo la categoria "clave".'
          },
          nombre_clave: {
            type: 'string',
            description: 'Nombre o sujeto descriptivo para archivar la credencial en el Second Brain (ej: "Servidor VPS Root", "Token API Prod").'
          },
          notas: {
            type: 'string',
            description: 'Notas adicionales o contexto asociadas al registro en el Second Brain.'
          }
        },
        required: ['tipo']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_infrastructure_status',
      description: 'Obtiene el estado integral de la infraestructura del sistema: salud de contenedores Docker, almacenamiento en disco con deteccion de umbrales, rendimiento y tasa de transferencia de red, y caducidad de certificados SSL.',
      parameters: {
        type: 'object',
        properties: {
          incluir_docker: {
            type: 'boolean',
            description: 'Inspeccionar estado de contenedores Docker (por defecto true).'
          },
          incluir_disco: {
            type: 'boolean',
            description: 'Inspeccionar espacio libre y ocupado en disco (por defecto true).'
          },
          incluir_red: {
            type: 'boolean',
            description: 'Calcular tasa de transferencia y consumo de red en MB/s (por defecto true).'
          },
          dominio_ssl: {
            type: 'string',
            description: 'Nombre de dominio opcional para verificar caducidad del certificado SSL (ej: "jarvis.davidcastellanos.es" o "google.com").'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'manage_tunnel',
      description: 'Consulta el estado operativo o gestiona el arranque y detencion de tuneles seguros de comunicacion (Cloudflare Tunnel o Tailscale).',
      parameters: {
        type: 'object',
        properties: {
          tipo_tunel: {
            type: 'string',
            enum: ['cloudflare', 'tailscale'],
            description: 'El tipo de tunel a gestionar: "cloudflare" o "tailscale".'
          },
          accion: {
            type: 'string',
            enum: ['status', 'start', 'stop'],
            description: 'Accion a realizar: "status" para consultar estado, "start" para iniciar tunel, "stop" para detener tunel.'
          },
          nombre_tunel: {
            type: 'string',
            description: 'Nombre de configuracion del tunel Cloudflare (por defecto "jarvis-vps").'
          }
        },
        required: ['tipo_tunel', 'accion']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'trigger_encrypted_backup',
      description: 'Genera una copia de seguridad inmediata, comprimida y cifrada simetricamente con AES-256-GCM (contenedor DAVBAK01) que incluye el directorio data/ y configuraciones criticas del sistema.',
      parameters: {
        type: 'object',
        properties: {
          passphrase: {
            type: 'string',
            description: 'Clave o frase maestra de cifrado. Si se omite, se utiliza la configurada en el entorno del sistema.'
          },
          comentario: {
            type: 'string',
            description: 'Nota descriptiva u origen del backup manual.'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'registrar_gasto',
      description: 'Anota un gasto que David dicta por chat (importe, comercio, categoria opcional, fecha opcional AAAA-MM-DD). Avisa si parece duplicado del mismo dia.',
      parameters: {
        type: 'object',
        properties: {
          importe: { type: 'number', description: 'Importe del gasto en euros.' },
          comercio: { type: 'string', description: 'Comercio o concepto del gasto.' },
          categoria: { type: 'string', description: 'Categoria opcional (comida, transporte, ocio...).' },
          fecha: { type: 'string', description: 'Fecha del gasto AAAA-MM-DD; por defecto hoy.' },
          notas: { type: 'string', description: 'Notas opcionales.' }
        },
        required: ['importe', 'comercio']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_gastos',
      description: 'Lista los gastos registrados, con filtro opcional por mes (AAAA-MM) o categoria.',
      parameters: {
        type: 'object',
        properties: {
          mes: { type: 'string', description: 'Mes a listar, AAAA-MM.' },
          categoria: { type: 'string', description: 'Categoria a filtrar.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'resumen_gastos_mes',
      description: 'Resumen del gasto de un mes con comparativa frente al mes anterior por categoria.',
      parameters: {
        type: 'object',
        properties: { mes: { type: 'string', description: 'Mes a resumir, AAAA-MM; por defecto el actual.' } }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'registrar_suscripcion',
      description: 'Registra una suscripcion (nombre, importe, dia de renovacion del mes) para que el vigilante avise 3 dias antes de cada renovacion.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre del servicio (Netflix, gimnasio...).' },
          importe: { type: 'number', description: 'Importe de cada renovacion en euros.' },
          diaRenovacion: { type: 'number', description: 'Dia del mes en que renueva (1-31).' },
          categoria: { type: 'string', description: 'Categoria opcional.' }
        },
        required: ['nombre', 'importe', 'diaRenovacion']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_suscripciones',
      description: 'Lista las suscripciones registradas con su importe y dia de renovacion.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'configurar_presupuesto',
      description: 'Fija el presupuesto mensual de una categoria; el estado de presupuestos alerta al superar el 80%.',
      parameters: {
        type: 'object',
        properties: {
          categoria: { type: 'string', description: 'Categoria a presupuestar.' },
          limite: { type: 'number', description: 'Limite mensual en euros.' }
        },
        required: ['categoria', 'limite']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'configurar_avisos_suscripciones',
      description: 'Activa o desactiva los avisos proactivos de renovacion de suscripciones. Solo se activan si David lo pide textualmente en su mensaje.',
      parameters: {
        type: 'object',
        properties: { activo: { type: 'boolean', description: 'true para activar los avisos, false para desactivarlos.' } },
        required: ['activo']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'estado_presupuestos',
      description: 'Muestra como va cada presupuesto del mes (gastado frente a limite y porcentaje).',
      parameters: {
        type: 'object',
        properties: { mes: { type: 'string', description: 'Mes a consultar, AAAA-MM; por defecto el actual.' } }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'vigilar_proceso',
      description: 'Registra un proceso del VPS para vigilarlo (caidas y consumo). El nombre sirve de patron por defecto; limites de CPU/memoria opcionales en porcentaje.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre del proceso (node, java, minecraft...).' },
          patron: { type: 'string', description: 'Patron de comando a buscar con pgrep -f; por defecto el nombre.' },
          cpuLimite: { type: 'number', description: 'Avisar si supera este porcentaje de CPU (1-100).' },
          memLimite: { type: 'number', description: 'Avisar si supera este porcentaje de memoria (1-100).' }
        },
        required: ['nombre']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_procesos_vigilados',
      description: 'Lista los procesos vigilados con su estado y limites configurados.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'dejar_vigilar_proceso',
      description: 'Deja de vigilar un proceso por nombre o patron.',
      parameters: {
        type: 'object',
        properties: { criterio: { type: 'string', description: 'Nombre o patron del proceso a quitar.' } },
        required: ['criterio']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'configurar_vigilante_procesos',
      description: 'Activa o desactiva la vigilancia proactiva de procesos. Solo se activa si David lo pide textualmente.',
      parameters: {
        type: 'object',
        properties: { activo: { type: 'boolean', description: 'true para activar, false para desactivar.' } },
        required: ['activo']
      }
    }
  }
];

/**
 * Mapa intencion -> herramientas, usado por el enrutador hibrido
 * (regex primero, clasificador por modelo como respaldo).
 * Las claves coinciden con las etiquetas que devuelve el clasificador.
 */
export const MAPA_INTENCION_HERRAMIENTAS = {
  clima: ['consultar_clima'],
  memoria: ['guardar_memoria', 'buscar_memoria', 'listar_memorias', 'olvidar_memoria'],
  mensajeProgramado: ['programar_mensaje_whatsapp', 'listar_mensajes_programados', 'cancelar_mensaje_programado'],
  recordatorio: ['crear_recordatorio', 'listar_recordatorios', 'cancelar_recordatorio'],
  sniper: ['vigilar_producto', 'listar_productos_vigilados', 'cancelar_vigilancia'],
  noticias: ['obtener_noticias_actuales', 'navegar_y_leer_noticia'],
  navegacion: ['navegar_y_leer_noticia', 'resumir_enlace'],
  servidor: ['consultar_estado_servidor'],
  vip: ['activar_modo_vip', 'estado_modo_vip', 'agregar_contacto_vip'],
  grupo: ['resumir_grupo'],
  multimedia: ['descargar_multimedia'],
  notas: ['guardar_nota_personal', 'listar_notas_recientes'],
  vcard: ['enviar_contacto_vcard'],
  encuestas: ['crear_encuesta_whatsapp'],
  bash: ['execute_bash_command'],
  crypto: ['generate_crypto_credential'],
  docker: ['get_infrastructure_status'],
  disco: ['get_infrastructure_status'],
  infraestructura: ['get_infrastructure_status'],
  tuneles: ['manage_tunnel'],
  backup: ['trigger_encrypted_backup'],
  empleo: ['registrar_candidatura', 'listar_candidaturas', 'actualizar_candidatura', 'escanear_ofertas_empleo', 'configurar_radar_ofertas'],
  estudio: ['planificar_estudio', 'listar_planes_estudio', 'registrar_avance_estudio', 'programar_recordatorios_estudio', 'crear_flashcard', 'repasar_flashcards', 'responder_flashcard', 'configurar_repaso_flashcards'],
  procesos: ['vigilar_proceso', 'listar_procesos_vigilados', 'dejar_vigilar_proceso', 'configurar_vigilante_procesos'],
  finanzas: ['registrar_gasto', 'listar_gastos', 'resumen_gastos_mes', 'registrar_suscripcion', 'listar_suscripciones', 'configurar_presupuesto', 'estado_presupuestos', 'configurar_avisos_suscripciones'],
  conversacion: []
};

/**
 * Devuelve las herramientas asociadas a una lista de etiquetas de intencion,
 * sin duplicados y en el orden original de herramientasJarvis.
 */
export function herramientasParaIntenciones(intenciones) {
  const nombres = new Set();
  for (const intencion of intenciones || []) {
    for (const nombre of MAPA_INTENCION_HERRAMIENTAS[intencion] || []) {
      nombres.add(nombre);
    }
  }
  return herramientasJarvis.filter(h => nombres.has(h.function.name));
}
