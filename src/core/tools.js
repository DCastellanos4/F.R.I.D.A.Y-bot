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
      description: 'OBLIGATORIA: Abre y navega en vivo con un navegador real (Playwright Chromium) a cualquier noticia, artículo periodístico o enlace web (URL) para leer su contenido completo, verificar la noticia antes de informar a David y extraer detalles profundos superando muros de cookies o JavaScript. '
        + 'REGLA: requiere una URL completa presente en la conversación (por ejemplo, de una llamada previa a obtener_noticias_actuales o un enlace de David). Si David pide resumir "la primera noticia" o similar y NO hay URL en el contexto, NO inventes ni adivines la URL: usa obtener_noticias_actuales primero o pide el enlace.',
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
      description: 'Genera una copia de seguridad inmediata, comprimida y cifrada simetricamente con AES-256-GCM (contenedor DAVBAK01) que incluye el directorio data/ y configuraciones criticas del sistema. La clave sale SOLO del entorno del servidor (BACKUP_PASSPHRASE/DAVIS_BACKUP_KEY), nunca del chat.',
      parameters: {
        type: 'object',
        properties: {
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
  },
  {
    type: 'function',
    function: {
      name: 'activar_traductor',
      description: 'Activa el modo traductor en este chat: cada mensaje de David se traduce al idioma indicado hasta que lo desactive.',
      parameters: {
        type: 'object',
        properties: { idioma: { type: 'string', description: 'Idioma de destino (ingles, frances, aleman...).' } },
        required: ['idioma']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'desactivar_traductor',
      description: 'Desactiva el modo traductor de este chat.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'sugerir_respuestas',
      description: 'Propone 3 posibles respuestas a un mensaje que le han enviado a David, con el tono indicado.',
      parameters: {
        type: 'object',
        properties: {
          mensaje: { type: 'string', description: 'El mensaje recibido al que hay que responder.' },
          tono: { type: 'string', description: 'Tono deseado (cercano, formal, breve...). Opcional.' }
        },
        required: ['mensaje']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'buscar_en_historial',
      description: 'Busca un termino en el historial de mensajes de este chat y devuelve las coincidencias mas recientes.',
      parameters: {
        type: 'object',
        properties: {
          termino: { type: 'string', description: 'Texto a buscar.' },
          limite: { type: 'number', description: 'Maximo de coincidencias (1-10, por defecto 5).' }
        },
        required: ['termino']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'registrar_fecha_senalada',
      description: 'Apunta un cumpleanos o fecha senalada (dia y mes; anio opcional). Registrarla NO activa avisos proactivos: eso es aparte con configurar_avisos_fechas.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'De quien o de que es la fecha (ej: "cumple de Ana").' },
          dia: { type: 'number', description: 'Dia del mes (1-31).' },
          mes: { type: 'number', description: 'Mes (1-12).' },
          anio: { type: 'number', description: 'Anio opcional (ej: ano de nacimiento).' },
          descripcion: { type: 'string', description: 'Detalle opcional.' }
        },
        required: ['nombre', 'dia', 'mes']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_fechas_senaladas',
      description: 'Lista las fechas senaladas registradas, ordenadas por proximidad en el calendario.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'eliminar_fecha_senalada',
      description: 'Borra una fecha senalada por nombre o id.',
      parameters: {
        type: 'object',
        properties: {
          criterio: { type: 'string', description: 'Nombre o id de la fecha.' }
        },
        required: ['criterio']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'configurar_avisos_fechas',
      description: 'Activa o desactiva los avisos proactivos de fechas senaladas (aviso el dia anterior y el mismo dia). Solo el propietario puede activarlos pidiendolo textualmente.',
      parameters: {
        type: 'object',
        properties: {
          activo: { type: 'boolean', description: 'true para activar, false para desactivar.' }
        },
        required: ['activo']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'programar_snooze',
      description: 'Recuerda a David volver a este chat mas tarde ("recuerdame este chat a las 18:00" o "en 2 horas"). Un solo aviso, a la hora pedida.',
      parameters: {
        type: 'object',
        properties: {
          minutos: { type: 'number', description: 'Minutos en el futuro (alternativa a hora).' },
          hora: { type: 'string', description: 'Hora concreta HH:MM en horario de Madrid (alternativa a minutos).' },
          nota: { type: 'string', description: 'Nota opcional sobre de que iba el chat.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_snoozes',
      description: 'Lista los recordatorios de chats pendientes.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cancelar_snooze',
      description: 'Cancela el recordatorio pendiente de este chat (o por id).',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Id del snooze; sin id, el de este chat.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'estadisticas_grupo',
      description: 'Estadisticas del historial que el bot ha visto de este chat o grupo: total de mensajes, reparto por rol, actividad por dia y hora punta. Solo cubre lo que el bot ha procesado, no todo WhatsApp.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'registrar_aviso_llegada',
      description: 'Avisa cuando la ubicacion de este chat entre en el radio de un destino ("avisame cuando llegue a casa"). Necesita coordenadas (latitud/longitud); si faltan, pide a David que comparta el pin del destino. Un solo aviso; caduca a las 12 horas.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre del destino (ej: "casa").' },
          latitud: { type: 'number', description: 'Latitud del destino.' },
          longitud: { type: 'number', description: 'Longitud del destino.' },
          radioMetros: { type: 'number', description: 'Radio en metros (50-5000, por defecto 200).' }
        },
        required: ['nombre', 'latitud', 'longitud']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_avisos_llegada',
      description: 'Lista los avisos de llegada activos.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cancelar_aviso_llegada',
      description: 'Cancela un aviso de llegada activo por nombre o id.',
      parameters: {
        type: 'object',
        properties: {
          criterio: { type: 'string', description: 'Nombre o id del aviso.' }
        },
        required: ['criterio']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'registrar_parada_favorita',
      description: 'Guarda una parada de bus EMT o una estacion de tren (Cercanias o AVE/LD/MD) como favorita (ej: "mi parada de casa es la EMT 1234"). El Metro no tiene fuente publica de llegadas en vivo.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre de la parada (ej: "casa").' },
          tipo: { type: 'string', enum: ['emt', 'cercanias', 'tren'], description: 'emt (bus), cercanias o tren (AVE/LD/MD).' },
          codigo: { type: 'string', description: 'Numero de parada EMT (marquesina) o codigo de estacion de Cercanias.' }
        },
        required: ['nombre', 'tipo', 'codigo']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_paradas_favoritas',
      description: 'Lista las paradas y estaciones favoritas de transporte.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'eliminar_parada_favorita',
      description: 'Borra una parada favorita por nombre o id.',
      parameters: {
        type: 'object',
        properties: {
          criterio: { type: 'string', description: 'Nombre o id de la parada.' }
        },
        required: ['criterio']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'proximas_llegadas_transporte',
      description: 'Consulta bajo demanda las proximas llegadas de una parada favorita, de una estacion por su nombre (Cercanias o AVE/LD/MD, se resuelve con el indice oficial de Renfe) o de un codigo con tipo. Sin avisos automaticos: solo responde cuando David pregunta.',
      parameters: {
        type: 'object',
        properties: {
          parada: { type: 'string', description: 'Nombre o id de la parada favorita.' },
          tipo: { type: 'string', enum: ['emt', 'cercanias', 'tren'], description: 'Tipo si se pasa un codigo directo.' },
          codigo: { type: 'string', description: 'Codigo directo si no es favorita.' },
          destino: { type: 'string', description: 'Filtra por destino cuando David pide trenes "hacia" un sitio concreto (ej: "hacia Madrid").' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'registrar_contacto',
      description: 'Guarda o actualiza la ficha de un contacto (nombre obligatorio; telefono, relacion, email, notas opcionales).',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre del contacto.' },
          telefono: { type: 'string', description: 'Telefono (opcional).' },
          relacion: { type: 'string', description: 'Relacion (ej: "amigo de la uni").' },
          email: { type: 'string', description: 'Email (opcional).' },
          notas: { type: 'string', description: 'Notas libres (opcional).' }
        },
        required: ['nombre']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'buscar_contacto',
      description: 'Busca contactos por nombre, relacion o notas.',
      parameters: {
        type: 'object',
        properties: {
          criterio: { type: 'string', description: 'Texto a buscar.' }
        },
        required: ['criterio']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_contactos',
      description: 'Lista todos los contactos guardados, por orden alfabetico.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'buscar_recuerdo_semantico',
      description: 'Busca en memorias y notas por significado, no solo por palabras exactas ("que se yo de la tia Pili").',
      parameters: {
        type: 'object',
        properties: {
          consulta: { type: 'string', description: 'Lo que David quiere encontrar.' }
        },
        required: ['consulta']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generar_digest_cerebro',
      description: 'Genera el resumen de lo guardado en el segundo cerebro en los ultimos dias (por defecto 7).',
      parameters: {
        type: 'object',
        properties: {
          dias: { type: 'number', description: 'Dias a cubrir (1-31, por defecto 7).' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'configurar_digest_semanal',
      description: 'Activa o desactiva el envio proactivo del digest semanal. Solo con peticion textual del propietario.',
      parameters: {
        type: 'object',
        properties: {
          activo: { type: 'boolean', description: 'true para activar, false para desactivar.' }
        },
        required: ['activo']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generar_wiki',
      description: 'Regenera el indice navegable (wiki) del segundo cerebro, agrupado por categoria con enlaces a las notas.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'capturar_pagina',
      description: 'Captura una pagina web (http/https) y la archiva como nota del segundo cerebro con su fuente.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL de la pagina.' },
          titulo: { type: 'string', description: 'Titulo opcional.' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'preguntar_documentos',
      description: 'Responde preguntas usando las notas y documentos guardados, citando las fuentes. Nunca inventa contenido.',
      parameters: {
        type: 'object',
        properties: {
          pregunta: { type: 'string', description: 'La pregunta sobre los documentos.' }
        },
        required: ['pregunta']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'escribir_diario',
      description: 'Apunta una entrada en el diario personal de David (texto o voz ya transcrita). Append por dia.',
      parameters: {
        type: 'object',
        properties: {
          texto: { type: 'string', description: 'Lo que quiere apuntar.' },
          fecha: { type: 'string', description: 'Dia AAAA-MM-DD (por defecto hoy, hora de Madrid).' }
        },
        required: ['texto']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'leer_diario',
      description: 'Lee la entrada del diario de un dia (por defecto hoy).',
      parameters: {
        type: 'object',
        properties: {
          fecha: { type: 'string', description: 'Dia AAAA-MM-DD.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'registrar_habito',
      description: 'Empieza a seguir un habito (ej: "leer 20 minutos"). Sin avisos proactivos: seguimiento bajo demanda.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre del habito.' }
        },
        required: ['nombre']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'marcar_habito',
      description: 'Marca un habito como hecho (por defecto hoy).',
      parameters: {
        type: 'object',
        properties: {
          criterio: { type: 'string', description: 'Nombre o parte del nombre del habito.' },
          fecha: { type: 'string', description: 'Dia AAAA-MM-DD (por defecto hoy).' }
        },
        required: ['criterio']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_habitos',
      description: 'Lista los habitos con racha de dias y si estan hechos hoy.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'poner_menu',
      description: 'Guarda la comida y/o la cena de un dia en el menu semanal.',
      parameters: {
        type: 'object',
        properties: {
          dia: { type: 'string', description: 'Dia de la semana (lunes a domingo).' },
          comida: { type: 'string', description: 'Plato de la comida.' },
          cena: { type: 'string', description: 'Plato de la cena.' }
        },
        required: ['dia']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ver_menu',
      description: 'Muestra el menu de la semana (por defecto la actual).',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'sugerir_menu',
      description: 'Propone un menu semanal con el modelo. Es solo una propuesta: se guarda lo que David confirme con poner_menu.',
      parameters: {
        type: 'object',
        properties: {
          preferencias: { type: 'string', description: 'Preferencias o restricciones (ej: "sin carne", "barato").' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'anadir_compra',
      description: 'Anade uno o varios articulos a la lista de la compra.',
      parameters: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { type: 'string' }, description: 'Articulos a anadir.' }
        },
        required: ['items']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_compra',
      description: 'Muestra la lista de la compra.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'tachar_compra',
      description: 'Quita un articulo de la lista de la compra.',
      parameters: {
        type: 'object',
        properties: {
          criterio: { type: 'string', description: 'Nombre o parte del articulo.' }
        },
        required: ['criterio']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'vaciar_compra',
      description: 'Vacia por completo la lista de la compra. Solo si David lo pide expresamente.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'recomendar_serie_pelicula',
      description: 'Recomienda series o peliculas segun los gustos guardados de David, sin repetir recomendaciones anteriores.',
      parameters: {
        type: 'object',
        properties: {
          genero: { type: 'string', description: 'Genero o antojo (ej: "thriller", "algo corto").' },
          tipo: { type: 'string', enum: ['pelicula', 'serie'], description: 'Limitar a peliculas o series.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'crear_quedada',
      description: 'Registra una quedada (titulo, fecha, hora, lugar, participantes). No invita a nadie por si misma.',
      parameters: {
        type: 'object',
        properties: {
          titulo: { type: 'string', description: 'Que quedada es (ej: "cena con la uni").' },
          fecha: { type: 'string', description: 'Dia AAAA-MM-DD.' },
          hora: { type: 'string', description: 'Hora HH:MM.' },
          lugar: { type: 'string', description: 'Sitio.' },
          participantes: { type: 'array', items: { type: 'string' }, description: 'Quien va.' }
        },
        required: ['titulo']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_quedadas',
      description: 'Lista las quedadas registradas (las 10 mas recientes).',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'redactar_invitacion',
      description: 'Redacta el BORRADOR de la invitacion a una quedada para que David lo revise y lo envie el mismo. NUNCA lo envia a terceros.',
      parameters: {
        type: 'object',
        properties: {
          criterio: { type: 'string', description: 'Titulo o id de la quedada.' }
        },
        required: ['criterio']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'resumen_deportivo',
      description: 'Resume la actualidad deportiva con fuentes RSS reales ya curadas (Marca, El Periodico, El Confidencial). Nunca inventa marcadores.',
      parameters: {
        type: 'object',
        properties: {
          limite: { type: 'number', description: 'Numero de titulares (por defecto 5).' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'configurar_modo_nocturno',
      description: 'Activa o desactiva el modo desconexion nocturno: silencia los avisos proactivos no urgentes dentro de la franja (por defecto 23:00-08:00, hora de Madrid). Los recordatorios puntuales que David programa no se tocan.',
      parameters: {
        type: 'object',
        properties: {
          activo: { type: 'boolean', description: 'true para activar, false para desactivar.' },
          desde: { type: 'string', description: 'Inicio de la franja HH:MM.' },
          hasta: { type: 'string', description: 'Fin de la franja HH:MM.' }
        },
        required: ['activo']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'iniciar_simulacro_entrevista',
      description: 'Abre un simulacro de entrevista tecnica en este chat (por voz o texto): 5 preguntas, evaluacion de cada respuesta y cierre con nota. Se sale con "terminar entrevista".',
      parameters: {
        type: 'object',
        properties: {
          rol: { type: 'string', description: 'Puesto (ej: "backend junior").' },
          nivel: { type: 'string', description: 'Nivel (junior, mid...).' }
        },
        required: ['rol']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'analizar_cv_oferta',
      description: 'Analiza el encaje entre el CV de David y una oferta concreta. El CV se pega como texto o se busca en sus notas (titulo/tag "cv").',
      parameters: {
        type: 'object',
        properties: {
          oferta: { type: 'string', description: 'Texto de la oferta (o descripcion pegada).' },
          cvTexto: { type: 'string', description: 'Texto del CV si David lo pega ahora.' }
        },
        required: ['oferta']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'resumir_apuntes',
      description: 'Resume apuntes: un texto pegado o las notas del segundo cerebro que encajen con un criterio. Cita las notas usadas.',
      parameters: {
        type: 'object',
        properties: {
          criterio: { type: 'string', description: 'Tema o asignatura a resumir de las notas.' },
          texto: { type: 'string', description: 'Texto pegado directamente.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'registrar_entrega',
      description: 'Apunta una entrega o examen con su fecha (AAAA-MM-DD).',
      parameters: {
        type: 'object',
        properties: {
          titulo: { type: 'string', description: 'Que se entrega o que examen es.' },
          fecha: { type: 'string', description: 'Fecha AAAA-MM-DD.' },
          tipo: { type: 'string', enum: ['entrega', 'examen'], description: 'Tipo (por defecto entrega).' }
        },
        required: ['titulo', 'fecha']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_entregas',
      description: 'Lista entregas y examenes ordenados por fecha con los dias que quedan.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'eliminar_entrega',
      description: 'Borra una entrega o examen por titulo o id.',
      parameters: {
        type: 'object',
        properties: {
          criterio: { type: 'string', description: 'Titulo o id.' }
        },
        required: ['criterio']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'buscar_producto',
      description: 'Busca ofertas de un producto bajo demanda (sin compras ni vigilancia automatica). Si no hay fuente configurada, informa del estado config-required y ofrece verificar un enlace concreto.',
      parameters: {
        type: 'object',
        properties: {
          consulta: { type: 'string', description: 'Producto a buscar (modelo exacto si se sabe).' }
        },
        required: ['consulta']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'verificar_oferta',
      description: 'Verifica AHORA una oferta concreta: abre la ficha y lee precio, stock y disponibilidad publicados (JSON-LD), declarando la hora de la comprobacion. Lo no legible es no-verificable, nunca inventado.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL http(s) de la ficha del producto.' },
          producto: { type: 'string', description: 'Producto/variante que David dice estar comprando (para vincular la oferta leida con lo pedido; si la pagina es de otra cosa, el precio no se da por confirmado).' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'anotar_idea',
      description: 'Anota una idea o propuesta de mejora (feature request) para revisarla luego.',
      parameters: {
        type: 'object',
        properties: {
          titulo: { type: 'string', description: 'La idea en una frase corta.' },
          detalle: { type: 'string', description: 'Detalle opcional: para que, contexto, enlaces.' }
        },
        required: ['titulo']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_ideas',
      description: 'Lista las ideas/propuestas anotadas.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'priorizar_ideas',
      description: 'Propone (sin cambiar nada) un orden de prioridad para las ideas pendientes, con motivos.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generar_changelog',
      description: 'Redacta una propuesta de entrada de CHANGELOG desde el historial git (no toca archivos ni hace commit).',
      parameters: {
        type: 'object',
        properties: {
          desde: { type: 'string', description: 'Tag o commit desde el que contar (por ejemplo v1.2.0). Si falta, ultimos N commits.' },
          limite: { type: 'number', description: 'Numero de commits si no hay "desde" (por defecto 15).' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'guiar_depuracion',
      description: 'Modo pair programming: guia la depuracion de un fallo paso a paso, una hipotesis cada vez.',
      parameters: {
        type: 'object',
        properties: {
          fallo: { type: 'string', description: 'Descripcion del fallo: que esperabas, que pasa, mensaje de error.' },
          contexto: { type: 'string', description: 'Contexto opcional: trozo de codigo, log, comando usado.' }
        },
        required: ['fallo']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'revisar_pr',
      description: 'Revisa una pull request (seguridad y estilo) y trae la resena aqui por WhatsApp. NUNCA publica comentarios en GitHub.',
      parameters: {
        type: 'object',
        properties: {
          numero: { type: 'number', description: 'Numero de la PR.' },
          repo: { type: 'string', description: 'Repo owner/nombre; por defecto el del bot.' }
        },
        required: ['numero']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'auditar_dependencias',
      description: 'Ejecuta npm audit y resume vulnerabilidades con propuesta de actualizacion. NUNCA actualiza nada por si solo.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'configurar_vigilancia_dependencias',
      description: 'Activa o desactiva la vigilancia programada de dependencias. activo=true SOLO si David lo pide textualmente en su mensaje.',
      parameters: {
        type: 'object',
        properties: { activo: { type: 'boolean' } },
        required: ['activo']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'informe_metricas',
      description: 'Informe de metricas del bot: comandos mas usados, errores y tiempos de respuesta (ultimos N dias).',
      parameters: {
        type: 'object',
        properties: { dias: { type: 'number', description: 'Dias a cubrir (por defecto 7).' } }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'configurar_informe_metricas',
      description: 'Activa o desactiva el informe semanal proactivo de metricas. activo=true SOLO si David lo pide textualmente.',
      parameters: {
        type: 'object',
        properties: { activo: { type: 'boolean' } },
        required: ['activo']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'actividad_repos',
      description: 'Instantanea de stars, forks e issues abiertas de los repos de David (API publica de GitHub).',
      parameters: {
        type: 'object',
        properties: { repos: { type: 'array', items: { type: 'string' }, description: 'Repos owner/nombre (max 5); por defecto los configurados.' } }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'configurar_alertas_repos',
      description: 'Activa o desactiva los avisos de cambios (stars/forks/issues) en los repos. activo=true SOLO si David lo pide textualmente.',
      parameters: {
        type: 'object',
        properties: {
          activo: { type: 'boolean' },
          repos: { type: 'array', items: { type: 'string' } }
        },
        required: ['activo']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'crear_backup_sesion',
      description: 'Crea una copia CIFRADA local de la sesion del bot (AES-256-GCM; requiere DAVIS_BACKUP_KEY por entorno). La subida externa es config-required.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'verificar_backup_sesion',
      description: 'Verifica que un backup DBK1 descifra con la clave actual y es recuperable (autenticacion GCM + contenido tar.gz).',
      parameters: {
        type: 'object',
        properties: { archivo: { type: 'string', description: 'Ruta del fichero .dbk1 a verificar.' } },
        required: ['archivo']
      }
    }
  },
  
  {
    type: 'function',
    function: {
      name: 'listar_dispositivos_red',
      description: 'Lista los dispositivos vecinos del equipo donde corre el bot (su propia LAN; si el bot esta en el VPS NO es la red de casa).',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'configurar_vigilancia_red',
      description: 'Activa o desactiva el aviso de dispositivos desconocidos en la red del equipo del bot. activo=true SOLO si David lo pide textualmente.',
      parameters: {
        type: 'object',
        properties: {
          activo: { type: 'boolean' },
          conocidos: { type: 'array', items: { type: 'string' }, description: 'MACs conocidas (aa:bb:cc:dd:ee:ff).' }
        },
        required: ['activo']
      }
    }
  },
  
  
  
  
  {
    type: 'function',
    function: {
      name: 'vigilar_ruta',
      description: 'Vigila una ruta de vuelo o tren (origen, destino, fecha) con precio objetivo opcional y aviso de bajadas. La fuente de precios en vivo es config-required; mientras tanto acepta precios manuales.',
      parameters: {
        type: 'object',
        properties: {
          tipo: { type: 'string', enum: ['vuelo', 'tren'] },
          origen: { type: 'string' },
          destino: { type: 'string' },
          fecha: { type: 'string', description: 'Fecha del viaje AAAA-MM-DD.' },
          precioObjetivo: { type: 'number', description: 'Avisar si baja de este precio en EUR (opcional).' }
        },
        required: ['tipo', 'origen', 'destino', 'fecha']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_rutas_vigiladas',
      description: 'Lista las rutas de vuelo/tren vigiladas con su objetivo y ultimo precio conocido.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cancelar_vigilancia_ruta',
      description: 'Deja de vigilar una ruta de vuelo/tren.',
      parameters: {
        type: 'object',
        properties: { criterio: { type: 'string', description: 'Texto que identifica la ruta (destino, fecha...).' } },
        required: ['criterio']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'registrar_precio_ruta',
      description: 'Registra un precio que David ha visto para una ruta vigilada y lo compara con su objetivo e historial.',
      parameters: {
        type: 'object',
        properties: {
          criterio: { type: 'string', description: 'Texto que identifica la ruta.' },
          precio: { type: 'number', description: 'Precio visto en EUR.' }
        },
        required: ['criterio', 'precio']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'explicar_recorrido',
      description: 'Explica en llano como llego D.A.V.I.S. a su respuesta anterior en este chat: via de enrutado (reglas propias o clasificador), areas detectadas, herramientas usadas, rondas y duracion. Usala cuando David pregunte "como has llegado a esa respuesta", "que herramientas has usado" o "explica el recorrido".',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'proponer_skill',
      description: 'Propone un procedimiento reutilizable (skill): una secuencia de pasos que usan herramientas ya existentes. NUNCA se activa sola: David la aprueba o rechaza escribiendo "aprobar skill <nombre>" o "rechazar skill <nombre>". Los pasos no conceden permisos nuevos; cada uno pasa por las guardas habituales.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre unico en minusculas_con_guiones_bajos (3-41 caracteres).' },
          descripcion: { type: 'string', description: 'Que hace el procedimiento y cuando conviene usarlo.' },
          parametros: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                nombre: { type: 'string', description: 'Nombre del parametro (minusculas_con_guiones_bajos).' },
                descripcion: { type: 'string', description: 'Que significa el parametro.' },
                requerido: { type: 'boolean', description: 'Si es obligatorio al ejecutar la skill.' }
              },
              required: ['nombre']
            },
            description: 'Parametros que acepta la skill. En los argumentos de los pasos se referencian como {{nombre}}.'
          },
          pasos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                herramienta: { type: 'string', description: 'Nombre de una herramienta existente (nunca otra skill).' },
                argumentos: { type: 'object', description: 'Argumentos fijos del paso; pueden incluir {{parametro}}.' }
              },
              required: ['herramienta']
            },
            description: 'Secuencia ordenada de llamadas a herramientas existentes.'
          }
        },
        required: ['nombre', 'descripcion', 'pasos']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_skills',
      description: 'Lista los procedimientos reutilizables (skills) con su estado (pendiente, aprobada o rechazada) y sus parametros.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ejecutar_skill',
      description: 'Ejecuta una skill APROBADA por David, paso a paso y con las guardas habituales en cada paso. Si esta pendiente o rechazada, lo dice y no hace nada.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre de la skill aprobada.' },
          argumentos: { type: 'object', description: 'Valores de los parametros declarados en la skill.' }
        },
        required: ['nombre']
      }
    }
  }
];

/** Catalogo CERRADO de nombres de herramientas declaradas. Unico origen
 *  valido para etiquetas de telemetria: un nombre emitido por el LLM que no
 *  este en este set NUNCA llega a un label/span (cardinalidad y secretos:
 *  una regex no basta, un secreto alfanumerico la cumpliria). */
export const NOMBRES_HERRAMIENTAS_JARVIS = new Set(
  herramientasJarvis.map((h) => h && h.function && h.function.name).filter(Boolean)
);

/**
 * Mapa intencion -> herramientas, usado por el enrutador hibrido
 * (regex primero, clasificador por modelo como respaldo).
 * Las claves coinciden con las etiquetas que devuelve el clasificador.
 */
/**
 * Limite de herramientas por peticion del proveedor cloud (Groq/OpenAI
 * compatible devuelve 400 'tools': maximum number of items is 128 por
 * encima). NUNCA se envia un payload por encima de este limite.
 */
export const LIMITE_HERRAMIENTAS_PROVEEDOR = 128;

/**
 * Acota el catalogo a enviar al proveedor sin romper el esquema ni soltar
 * herramientas a mitad de conversacion:
 *  - Si el catalogo cabe, se devuelve intacto.
 *  - Si no cabe, se preservan primero las herramientas ya invocadas en la
 *    conversacion (las rondas siguientes de function calling las necesitan)
 *    y se completa por orden de catalogo hasta el limite, con objetos de
 *    herramienta completos (nunca parciales).
 */
export function limitarHerramientasParaProveedor(tools, mensajes = [], limite = LIMITE_HERRAMIENTAS_PROVEEDOR) {
  if (!Array.isArray(tools)) return [];
  if (tools.length <= limite) return tools;
  const enUso = new Set();
  for (const m of mensajes || []) {
    for (const tc of m?.tool_calls || []) {
      if (tc?.function?.name) enUso.add(tc.function.name);
    }
  }
  const preservadas = tools.filter((t) => enUso.has(t.function.name));
  const restantes = tools.filter((t) => !enUso.has(t.function.name));
  const seleccion = [...preservadas, ...restantes].slice(0, limite);
  console.warn(`[LimiteHerramientas] catalogo de ${tools.length} supera el limite ${limite} del proveedor: se envian ${seleccion.length} (preservadas en uso: ${preservadas.length}; no enviadas: ${tools.length - seleccion.length}).`);
  return seleccion;
}

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
  empleo: ['registrar_candidatura', 'listar_candidaturas', 'actualizar_candidatura'],
  estudio: ['planificar_estudio', 'listar_planes_estudio', 'registrar_avance_estudio', 'programar_recordatorios_estudio', 'crear_flashcard', 'repasar_flashcards', 'responder_flashcard', 'configurar_repaso_flashcards'],
  comunicacion: ['activar_traductor', 'desactivar_traductor', 'sugerir_respuestas', 'buscar_en_historial', 'registrar_fecha_senalada', 'listar_fechas_senaladas', 'eliminar_fecha_senalada', 'configurar_avisos_fechas', 'programar_snooze', 'listar_snoozes', 'cancelar_snooze', 'estadisticas_grupo', 'registrar_aviso_llegada', 'listar_avisos_llegada', 'cancelar_aviso_llegada'],
  transporte: ['registrar_parada_favorita', 'listar_paradas_favoritas', 'eliminar_parada_favorita', 'proximas_llegadas_transporte'],
  cerebro: ['registrar_contacto', 'buscar_contacto', 'listar_contactos', 'buscar_recuerdo_semantico', 'generar_digest_cerebro', 'configurar_digest_semanal', 'generar_wiki', 'capturar_pagina', 'preguntar_documentos'],
  bienestar: ['escribir_diario', 'leer_diario', 'registrar_habito', 'marcar_habito', 'listar_habitos', 'poner_menu', 'ver_menu', 'sugerir_menu', 'anadir_compra', 'listar_compra', 'tachar_compra', 'vaciar_compra', 'recomendar_serie_pelicula', 'crear_quedada', 'listar_quedadas', 'redactar_invitacion', 'resumen_deportivo', 'configurar_modo_nocturno'],
  compras: ['buscar_producto', 'verificar_oferta'],
  devtools: ['anotar_idea', 'listar_ideas', 'priorizar_ideas', 'generar_changelog', 'guiar_depuracion', 'revisar_pr', 'explicar_recorrido'],
  ops: ['auditar_dependencias', 'configurar_vigilancia_dependencias', 'informe_metricas', 'configurar_informe_metricas', 'actividad_repos', 'configurar_alertas_repos', 'crear_backup_sesion'],
  hogar: ['listar_dispositivos_red', 'configurar_vigilancia_red', 'verificar_backup_sesion'],
  viajes: ['vigilar_ruta', 'listar_rutas_vigiladas', 'cancelar_vigilancia_ruta', 'registrar_precio_ruta'],
  carrera: ['iniciar_simulacro_entrevista', 'analizar_cv_oferta', 'resumir_apuntes', 'registrar_entrega', 'listar_entregas', 'eliminar_entrega'],
  procesos: ['vigilar_proceso', 'listar_procesos_vigilados', 'dejar_vigilar_proceso', 'configurar_vigilante_procesos'],
  finanzas: ['registrar_gasto', 'listar_gastos', 'resumen_gastos_mes', 'registrar_suscripcion', 'listar_suscripciones', 'configurar_presupuesto', 'estado_presupuestos', 'configurar_avisos_suscripciones'],
  skills: ['proponer_skill', 'listar_skills', 'ejecutar_skill'],
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
