export const herramientasJarvis = [
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
      description: 'Elimina un recuerdo específico o todos los recuerdos del Second Brain cuando David pide borrar o olvidar un dato.',
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
  }
];
