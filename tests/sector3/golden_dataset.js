/**
 * golden_dataset.js
 *
 * Bateria dorada de comportamiento del agente D.A.V.I.S.
 *
 * Cada caso describe una entrada de David, el guion que seguira el LLM
 * simulado (clasificaciones, llamadas a herramienta y respuestas) y lo que
 * se espera observar: que herramientas se invocan, cuales no, y que rasgos
 * debe tener la respuesta final.
 *
 * IMPORTANTE: estos casos miden comportamiento deterministico del
 * orquestador (enrutado, bucle acotado, seguridad de reintentos), NO la
 * calidad real del modelo en produccion.
 *
 * Strict Policy: Zero Emojis.
 */

export const casosDorados = [
  // --- Enrutado directo por regex (sin clasificador) ---
  {
    id: 'G01-clima-directo',
    entrada: 'que tiempo hace en Madrid?',
    pasos: [{ llama: 'consultar_clima', args: { ubicacion: 'Madrid' } }, { texto: 'Soleado y 22 grados, senor.' }],
    esperado: { invoca: ['consultar_clima'], clasificador: false, textoContiene: ['22'] }
  },
  {
    id: 'G02-memoria-guardar',
    entrada: 'recuerda que mi matricula es 1234ABC',
    pasos: [{ llama: 'guardar_memoria', args: { contenido: 'matricula 1234ABC' } }, { texto: 'Anotado, senor.' }],
    esperado: { invoca: ['guardar_memoria'], clasificador: false }
  },
  {
    id: 'G03-memoria-buscar',
    entrada: 'que sabes de mi matricula?',
    pasos: [{ llama: 'buscar_memoria', args: { criterio: 'matricula' } }, { texto: 'Su matricula es 1234ABC.' }],
    esperado: { invoca: ['buscar_memoria'], clasificador: false }
  },
  {
    id: 'G04-memoria-olvidar',
    entrada: 'olvida que te dije lo de la matricula',
    pasos: [{ llama: 'olvidar_memoria', args: { criterio: 'matricula' } }, { texto: 'Hecho, senor.' }],
    esperado: { invoca: ['olvidar_memoria'], clasificador: false }
  },
  {
    id: 'G05-mensaje-programado',
    entrada: 'mandale un mensaje a +34600123456 que diga que llego tarde',
    pasos: [{ llama: 'programar_mensaje_whatsapp', args: { numero: '+34600123456' } }, { texto: 'Mensaje preparado.' }],
    esperado: { invoca: ['programar_mensaje_whatsapp'], clasificador: false }
  },
  {
    id: 'G06-recordatorio-hora',
    entrada: 'recuerdame llamar al banco a las 18:00',
    pasos: [{ llama: 'crear_recordatorio', args: { nota: 'llamar al banco' } }, { texto: 'Aviso programado.' }],
    esperado: { invoca: ['crear_recordatorio'], clasificador: false }
  },
  {
    id: 'G07-sniper',
    entrada: 'vigila el precio de este producto https://www.amazon.es/dp/B0TEST',
    pasos: [{ llama: 'vigilar_producto', args: { url: 'https://www.amazon.es/dp/B0TEST' } }, { texto: 'Vigilancia activada.' }],
    esperado: { invoca: ['vigilar_producto'], clasificador: false }
  },
  {
    id: 'G08-noticias',
    entrada: 'dame los titulares de ultima hora',
    pasos: [{ llama: 'obtener_noticias_actuales', args: {} }, { texto: 'Estos son los titulares.' }],
    esperado: { invoca: ['obtener_noticias_actuales'], clasificador: false }
  },
  {
    id: 'G09-leer-noticia',
    entrada: 'lee la noticia de portada del periodico',
    pasos: [{ llama: 'navegar_y_leer_noticia', args: { seccion: 'portada' } }, { texto: 'Noticia leida.' }],
    esperado: { invoca: ['navegar_y_leer_noticia'], clasificador: false }
  },
  {
    id: 'G10-servidor',
    entrada: 'como esta el servidor de minecraft?',
    pasos: [{ llama: 'consultar_estado_servidor', args: {} }, { texto: 'El servidor responde con normalidad.' }],
    esperado: { invoca: ['consultar_estado_servidor'], clasificador: false }
  },
  {
    id: 'G11-vip',
    entrada: 'activa el modo vip',
    pasos: [{ llama: 'activar_modo_vip', args: {} }, { texto: 'Modo VIP activo.' }],
    esperado: { invoca: ['activar_modo_vip'], clasificador: false }
  },
  {
    id: 'G12-grupo',
    entrada: 'que ha pasado en el grupo de la uni?',
    pasos: [{ llama: 'resumir_grupo', args: {} }, { texto: 'Resumen del grupo.' }],
    esperado: { invoca: ['resumir_grupo'], clasificador: false }
  },
  {
    id: 'G13-multimedia',
    entrada: 'descarga el video de este reel https://www.instagram.com/reel/xyz',
    pasos: [{ llama: 'descargar_multimedia', args: { url: 'https://www.instagram.com/reel/xyz' } }, { texto: 'Descarga en curso.' }],
    esperado: { invoca: ['descargar_multimedia'], clasificador: false }
  },
  {
    id: 'G14-nota',
    entrada: 'guarda una nota: comprar leche y huevos',
    pasos: [{ llama: 'guardar_nota_personal', args: { nota: 'comprar leche y huevos' } }, { texto: 'Nota guardada.' }],
    esperado: { invoca: ['guardar_nota_personal'], clasificador: false }
  },
  {
    id: 'G15-vcard',
    entrada: 'manda el contacto de Juan Perez',
    pasos: [{ llama: 'enviar_contacto_vcard', args: { nombre: 'Juan Perez' } }, { texto: 'Contacto enviado.' }],
    esperado: { invoca: ['enviar_contacto_vcard'], clasificador: false }
  },
  {
    id: 'G16-encuesta',
    entrada: 'crea una encuesta que diga: pizza o sushi?',
    pasos: [{ llama: 'crear_encuesta_whatsapp', args: { pregunta: 'pizza o sushi?' } }, { texto: 'Encuesta creada.' }],
    esperado: { invoca: ['crear_encuesta_whatsapp'], clasificador: false }
  },
  {
    id: 'G17-bash',
    entrada: 'ejecuta el comando df -h en el servidor',
    pasos: [{ llama: 'execute_bash_command', args: { command: 'df -h' } }, { texto: 'Discos al 40 por ciento.' }],
    esperado: { invoca: ['execute_bash_command'], clasificador: false }
  },
  {
    id: 'G18-infra',
    entrada: 'como esta la infraestructura docker?',
    pasos: [{ llama: 'get_infrastructure_status', args: {} }, { texto: 'Todos los contenedores operativos.' }],
    esperado: { invoca: ['get_infrastructure_status'], clasificador: false }
  },
  {
    id: 'G19-crypto',
    entrada: 'genera una credencial segura para la vpn',
    pasos: [{ llama: 'generate_crypto_credential', args: {} }, { texto: 'Credencial generada.' }],
    esperado: { invoca: ['generate_crypto_credential'], clasificador: false }
  },
  {
    id: 'G20-backup',
    entrada: 'lanza un backup cifrado ahora',
    pasos: [{ llama: 'trigger_encrypted_backup', args: {} }, { texto: 'Copia de seguridad iniciada.' }],
    esperado: { invoca: ['trigger_encrypted_backup'], clasificador: false }
  },

  // --- Charla sin herramientas ---
  {
    id: 'G21-chitchat-saludo',
    entrada: 'hola jarvis, que tal estas?',
    pasos: [{ texto: 'Operativo al cien por cien, senor.' }],
    esperado: { sinHerramientas: true, clasificador: false }
  },
  {
    id: 'G22-chitchat-gracias',
    entrada: 'muchas gracias por todo',
    pasos: [{ texto: 'A su servicio, senor.' }],
    esperado: { sinHerramientas: true, clasificador: false }
  },

  // --- Respaldo por modelo (el regex no reconoce la intencion) ---
  {
    id: 'G23-modelo-noticias',
    entrada: 'que se cuece en el mundo de la tecnologia hoy en dia?',
    pasos: [
      { clasifica: { intencion: 'noticias', confianza: 0.9 } },
      { llama: 'obtener_noticias_actuales', args: {} },
      { texto: 'Titulares de tecnologia listos.' }
    ],
    esperado: { invoca: ['obtener_noticias_actuales'], clasificador: true }
  },
  {
    id: 'G24-modelo-recordatorio',
    entrada: 'echame un capacon suave a media tarde para lo del dentista',
    pasos: [
      { clasifica: { intencion: 'recordatorio', confianza: 0.8 } },
      { llama: 'crear_recordatorio', args: { nota: 'dentista' } },
      { texto: 'Aviso preparado para media tarde.' }
    ],
    esperado: { invoca: ['crear_recordatorio'], clasificador: true }
  },
  {
    id: 'G25-modelo-baja-confianza',
    entrada: 'hazme eso que te comente el otro dia por la manana',
    pasos: [
      { clasifica: { intencion: 'memoria', confianza: 0.3 } },
      { texto: 'Podria concretar un poco mas, senor?' }
    ],
    esperado: { sinHerramientas: true, clasificador: true, directivaDesambiguacion: true, responde: true }
  },
  {
    id: 'G26-modelo-conversacion',
    entrada: 'cual crees que es el sentido de la vida, universo y todo lo demas?',
    pasos: [
      { clasifica: { intencion: 'conversacion', confianza: 0.95 } },
      { texto: 'Cuarenta y dos, senor.' }
    ],
    esperado: { sinHerramientas: true, clasificador: true }
  },
  {
    id: 'G27-modelo-error-clasificador',
    entrada: 'ponme al tanto del estado de aquello que estuvimos mirando el jueves',
    pasos: [
      { clasifica: 'ERROR' },
      { texto: 'No termino de entenderlo, senor.' }
    ],
    esperado: { sinHerramientas: true, clasificador: true, directivaDesambiguacion: true, ofrecidasCero: true, responde: true }
  },
  {
    id: 'G28-cache-clasificador',
    entrada: 'que se cuece en el mundo del motor esta semana?',
    repeticiones: 2,
    pasos: [
      { clasifica: { intencion: 'noticias', confianza: 0.88 } },
      { llama: 'obtener_noticias_actuales', args: {} },
      { texto: 'Titulares del motor.' }
    ],
    esperado: { invoca: ['obtener_noticias_actuales'], clasificador: true, llamadasClasificadorTotal: 1 }
  },

  // --- Orquestacion del bucle ---
  {
    id: 'G29-encadenamiento',
    entrada: 'mira como esta el servidor y luego revisa el espacio en disco',
    pasos: [
      { llama: 'consultar_estado_servidor', args: {} },
      { llama: 'execute_bash_command', args: { command: 'df -h' } },
      { texto: 'Servidor estable y disco al 40 por ciento.' }
    ],
    esperado: { invoca: ['consultar_estado_servidor', 'execute_bash_command'], clasificador: false, llamadasLlmTotal: 3 }
  },
  {
    id: 'G30-limite-rondas',
    entrada: 'que tiempo hace?',
    pasos: [{ llama: 'consultar_clima', args: {}, repite: true }],
    esperado: { invoca: ['consultar_clima'], clasificador: false, llamadasLlmTotal: 4 }
  },
  {
    id: 'G31-error-idempotente',
    entrada: 'que tiempo hace en Sevilla?',
    ejecutores: { consultar_clima: () => { throw new Error('timeout de red'); } },
    pasos: [
      { llama: 'consultar_clima', args: { ubicacion: 'Sevilla' } },
      { texto: 'El servicio de clima no responde ahora mismo.' }
    ],
    esperado: { invoca: ['consultar_clima'], clasificador: false, mensajeToolContiene: ['reintentala'], mensajeToolNoContiene: ['NO la reintentes'] }
  },
  {
    id: 'G32-error-no-idempotente',
    entrada: 'recuerda que la clave del wifi es casa2024',
    ejecutores: { guardar_memoria: () => { throw new Error('disco lleno'); } },
    pasos: [
      { llama: 'guardar_memoria', args: { contenido: 'wifi casa2024' } },
      { texto: 'No he podido guardarlo, senor.' }
    ],
    esperado: { invoca: ['guardar_memoria'], clasificador: false, mensajeToolContiene: ['NO la reintentes'] }
  },
  {
    id: 'G33-continuacion-truncada',
    entrada: 'cuentame un resumen largo del dia',
    pasos: [
      { texto: 'Primera parte del resumen del dia, con mucho detalle', finish: 'length' },
      { texto: 'y aqui continua la segunda parte.' }
    ],
    esperado: { sinHerramientas: true, clasificador: false, textoContiene: ['Primera parte', 'segunda parte'] }
  },
  {
    id: 'G34-historial-presente',
    entrada: 'y sobre lo que te decia antes?',
    historial: [
      { role: 'user', content: 'estoy preparando la mudanza a Getafe' },
      { role: 'assistant', content: 'Tomo nota de la mudanza a Getafe.' }
    ],
    pasos: [{ texto: 'Si, sobre la mudanza a Getafe.' }],
    esperado: { sinHerramientas: true, historialInyectado: true }
  },
  {
    id: 'G35-borrado-masivo-pide-confirmacion',
    entrada: 'borra de tu memoria todo lo que sabes de mi',
    usaEjecutorReal: ['olvidar_memoria'],
    pasos: [
      { llama: 'olvidar_memoria', args: { criterio: '*' } },
      { texto: 'Es un borrado masivo: confirme que desea eliminar todos los recuerdos.' }
    ],
    esperado: {
      clasificador: false,
      mensajeToolContiene: ['ATENCION', 'confirmacion humana', 'confirmar borrado'],
      textoContiene: ['confirm']
    }
  },
  {
    id: 'G37-borrado-falsificado-por-modelo',
    entrada: 'borra de tu memoria todo lo que sabes de mi',
    usaEjecutorReal: ['olvidar_memoria'],
    pasos: [
      { llama: 'olvidar_memoria', args: { criterio: '*', confirmado: true } },
      { texto: 'Necesito que confirme usted directamente, senor.' }
    ],
    esperado: {
      clasificador: false,
      mensajeToolContiene: ['ATENCION', 'Tu no puedes confirmarlo'],
      mensajeToolNoContiene: ['Se han eliminado todos los recuerdos']
    }
  },
  {
    id: 'G38-duplicado-bloqueado',
    entrada: 'recuerda que la clave del garaje es 4482',
    pasos: [
      { llama: 'guardar_memoria', args: { contenido: 'clave garaje 4482' } },
      { llama: 'guardar_memoria', args: { contenido: 'clave garaje 4482' } },
      { texto: 'Ya lo tenia guardado, senor.' }
    ],
    esperado: {
      invoca: ['guardar_memoria'],
      clasificador: false,
      invocaVeces: { guardar_memoria: 1 },
      mensajeToolContiene: ['NO se duplica']
    }
  },
  {
    id: 'G36-precio-consulta',
    entrada: 'cuanto cuesta ahora el articulo que vigilamos?',
    pasos: [
      { llama: 'listar_productos_vigilados', args: {} },
      { texto: 'El articulo sigue a 89 euros.' }
    ],
    esperado: { invoca: ['listar_productos_vigilados'], clasificador: false }
  }
];
