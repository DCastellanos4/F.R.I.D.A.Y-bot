export const herramientasJarvis = [
  {
    type: 'function',
    function: {
      name: 'consultar_clima',
      description: 'OBLIGATORIA: Consulta el estado meteorológico actual y la previsión (temperatura, probabilidad de lluvia, viento, estado del cielo) para cualquier ciudad, pueblo o lugar del mundo (ej: Madrid, Barcelona, Valencia, Londres, etc.).',
      parameters: {
        type: 'object',
        properties: {
          ubicacion: {
            type: 'string',
            description: 'Nombre de la ciudad, pueblo o lugar a consultar (ej: Madrid, Barcelona, Valencia, Londres, Buenos Aires, Tokio). Por defecto Madrid.'
          },
          momento: {
            type: 'string',
            enum: ['hoy', 'mañana', 'semana'],
            description: 'Momento de la previsión: "hoy", "mañana" o "semana". Por defecto "hoy".'
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
      description: 'Descarga, lee con navegador Playwright y sintetiza en un resumen ejecutivo táctico de WhatsApp cualquier página web, noticia o vídeo de YouTube proporcionado mediante una URL.',
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
            description: 'Precio en euros al que se desea que FRIDAY avise si baja'
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
      description: 'OBLIGATORIA: Guarda y programa en el sistema un recordatorio, aviso o alarma cuando el usuario dice recuérdame, recuerdame, avísame, ponme una alarma, acuérdate de, etc.',
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
      name: 'consultar_estado_servidor',
      description: 'Devuelve la salud del servidor Oracle (RAM, CPU) y el estado del servidor de Minecraft.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  }
];
