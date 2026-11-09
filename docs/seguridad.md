# Seguridad

Modelo de actor: un unico propietario. Todo lo que no sea el propietario se
trata como no autorizado por defecto, y toda accion destructiva o con
efectos externos exige aprobacion humana fuera del modelo.

## Control de acceso

- Allowlist del canal por telefono/LID del propietario; la autorizacion
  nunca se infiere de texto, nombres o metadata del mensaje.
- RBAC de herramientas (`rbacService`): catalogo clasificado por impacto,
  denegado por defecto para cualquier tenant que no sea el propietario;
  herramienta sin clasificar, denegada. La lista blanca de usuarios no
  propietarios esta vacia.
- API REST cerrada de fabrica: sin `API_TOKEN` responde 503 en todo.
- Webhook de GitHub: verificacion HMAC-SHA256 en tiempo constante sobre el
  cuerpo crudo; firma invalida, 401 inmediato.

## Aprobacion humana fuera del modelo

El LLM puede solicitar acciones, jamas confirmarlas:

- **Consola bash** (`bashConsoleService`): clasificacion de riesgo en dos
  niveles; los comandos criticos exigen un OTP efimero de 6 digitos (TTL
  120 s, 3 intentos) que el bot envia por WhatsApp y el propietario
  devuelve. La salida se limpia de secretos antes de mostrarse.
- **Borrado masivo del segundo cerebro** (`destructiveActionService`):
  peticion pendiente ligada al chat, al criterio exacto y a un id
  aleatorio, TTL de 5 minutos y un solo uso; solo "confirmar borrado \<id\>"
  en ese chat lo ejecuta.
- **Skills** (`skillsService`): el modelo propone, el propietario aprueba o
  rechaza por su chat; cada paso de una skill aprobada pasa por las mismas
  guardas que una llamada manual.
- **Voz** (`voiceConfirmationService`): acciones criticas dictadas por
  audio requieren un "si" tras repetir lo entendido (la transcripcion puede
  equivocarse).

## Defensas de red y datos

- `safeFetch` anti-SSRF en toda apertura de URLs: solo http(s) en puertos
  80/443, sin credenciales incrustadas, sin hosts locales ni IPs
  privadas/reservadas, validacion DNS en la resolucion del propio socket
  (sin ventana TOCTOU), redirecciones revalidadas (maximo 3), timeout y
  cuerpo limitado. La unica excepcion deliberada es la URL local de Home
  Assistant configurada por el propietario.
- Redaccion de datos sensibles antes de persistir (`redaccionService`):
  OTP y credenciales con formato conocido nunca tocan el disco en claro en
  historiales, memoria episodica ni trazas.
- Sanitizacion de errores hacia el usuario: organizacion, cuotas y cuerpos
  del proveedor quedan en logs; por WhatsApp solo sale el mensaje honesto
  y, cuando existe, el tiempo de reintento real.
- `tenantFileSystem`: escrituras bajo `data/tenants/` con O_NOFOLLOW y
  verificacion de ancestros.

## Cifrado

- Credenciales del segundo cerebro (categoria `clave`): AES-256-GCM con
  clave derivada por scrypt de `MEMORY_ENCRYPTION_KEY`. Sin clave
  configurada no se guarda la credencial (fail-closed); sin clave al leer,
  se declara que no se puede descifrar.
- Backups: formato propio (DAVBAK/DBK1) con AES-256-GCM autenticado y
  scrypt; la passphrase llega por entorno (`BACKUP_PASSPHRASE` /
  `DAVIS_BACKUP_KEY`), nunca por chat, y el cifrado se autoverifica con un
  roundtrip antes de emitir nada.

## Politica de secretos

Toda credencial se define por variables de entorno del servidor, nunca por
chat. El repositorio solo contiene `.env.example` con nombres de variables;
los valores viven fuera de git (`.env` en el estado compartido).

## Guardarrailes de salida

Antes de cada envio: veto de emojis, validacion sintactica de bloques de
codigo, contraste de afirmaciones de acciones contra las trazas reales de
herramientas y validacion de numeros/JIDs. Ver
[Agente y LLM](agente-y-llm.md).

## Preparacion multiusuario

El carril de tenants existe con identidad verificada por el transporte,
RBAC, aislamiento de rutas y cuotas configurables, pero ambas compuertas
estan cerradas y no hay altas. Estado exacto en [tenancy.md](tenancy.md).
