# One-shot LOCAL preparado: plan exacto y recorrido completo

2026-11-11. Base preservada7c7ab6a768f1e76b6957d98e78b80173c5e6cc54. Este delta añade solo el invocador externo, plan JSON exacto, pruebas y esta nota. No cambia las fuentes19holder/22executor, sus roots ni código de servicios ya revisado. No hay CLI de arranque ni ejecución al importar, construir o cargar el plan.

## Inputs cerrados

`tests/ers_recovery/fixtures/ensayo-one-shot-plan.json` es el plan propuesto: PENDING_AUTHORITY, productionAdmission=false. Destino ubuntu@51.170.48.166, hostkeyED25519 SHA256:cPziJJ/oUNY7Q/fBXdCPvv0hueD4i1IPbqHKe9DtJuM (original del owner recuperado10nov11:55:57). Epoch87171f42b35cd442, Python3.10 con dev/ino/size/SHA observados en la ventana cerrada, hashes de36materiales públicos, seis binarios exactos y la política de residuos. No contiene secretos, comandos de transporte, UID/GID candidatos o una aprobación. El transporteSSH no está en el invocador: el operador verifica el destino y el pin al establecer el transporte autorizado. No se abre otra ventanaRO antes de decidir. La preflight de la futura intervención compara esos inputs con el estado entonces existente; diferencia o colisión significa HOLD.

El código ofrece `load_prepared(plan_path, material_directory, expected_plan_sha256=...)`, que solo carga y verifica inputs. Devuelve un objeto cuyo `run()` sin más devuelve PENDING_AUTHORITY sin efectos. El hash selecciona bytes, no consentimiento.

La llamada de efectos exige un `authority_check` externo al plan. El operador debe haber recuperado y verificado el mensaje original del owner y el alcance exacto. El checker debe lanzar una excepción si falta o no cubre el plan, y devolver únicamente None tras esa verificación. Booleanos, approved_binding, status APPROVED o un diccionario que alegue permiso se rechazan. Esto es una frontera con el operador de confianza, no un sistema criptográfico de autenticación ni una forma de conseguir permiso con una lambda. El código por sí solo no autentica conversaciones y no autoriza su propio uso. El ejecutor debe cargar el módulo revisado, no código externo sugerido por un archivo.

## Recorrido de un intento

1. Validar plan/materiales y verificar autoridad fuera del archivo. Marcar intento consumido. Sin autoridad no se construye el backend real.
2. Preflight root sin escribir: clave pública local `/etc/ssh/ssh_host_ed25519_key.pub` con el mismo fingerprint del owner (nunca la privada), binarios exactos, roots finales y seed/audit/units ausentes mediante ancestros seguros; shared parents con modos exactos sin repararlos; cuatro units no cargadas; dos nombres de cuenta ausentes; capacidad fresca. Paths nuevos no heredan la ausencia vista para hashes anteriores.
3. Seed originalO_EXCL0600 antes de cuentas; asignación nativa de grupo y usuario, NSS exacto y congelación del manifest. Ningún número escogido por nosotros.
4. Bootstrap usando el mismo objeto/FD original una sola vez. Instala solo bytes públicos fijados, configs y units del ensayo, external executor y canary. No segunda creación de cuenta. Bootstrap cierra seed y devuelve su identidad sellada.
5. Abrir lifecycle original, volver a comprobar binarios/capacidad y arrancar cleanup primero, supervisor después. Reload global1. Los servicios ya revisados gestionan gates y liberación de holders, custodia de los dos scopes y stop de TODOS sus descendientes originales.
6. Esperar cierre como máximo90s con consultas externas cada1s. Exigir ROOT_CONTROL_COMPLETE exacto, ambos custodios originales, misma InvocationID, units inactivas/fallidas sin PIDs y ausencia de los PIDs originales. No confundir reutilización con muerte ni ejecutar cierre sobre un sustituto. No usar un timer tardío para reconstruir FDs perdidos.
7. Cargar retirement desde el executor externo ya instalado tras comprobar sus22hashes/estructura. Preflight global antes de efectos de Finalizer. Finalizer exacto, retirada del original principal sin force/home y reload global2. Sellar lifecycle, congelar ticket propuesto, retener control/seed. Si cualquier acción o comprobación falla: HOLD sin retry, rollback automático, reparación ni borrado por nombre.
8. Devolver `CLOSED_FOLLOWTHROUGH_HANDOFF_REQUIRED_NOT_SCHEDULED`, ticketDigest, epoch y hora de revisión. No llamar Retirement.execute ni aceptar approved_binding, ni programar/borrar nada automáticamente. Main debe registrar y programar el seguimiento tras el resultado real antes de anunciar el cierre como totalmente delegado. Un HOLD también se informa en privado, sin fingir éxito o aplicar una cuenta atrás.

Los handles propios tienen estado de cierre explícito. No hacer fstat sobre un viejo númeroFD para concluir que sigue siendo el original; no cerrar un FD reutilizado. Un error de cierre produce HOLD, no una confirmación verde.

## Presupuestos y tiempo, mismo código y texto

- controller:33554432B(32MiB),16tasks,20%CPU,swap0.
- watchdog:33554432B(32MiB),16tasks,20%CPU,swap0.
- supervisor root:33554432B(32MiB),8tasks,10%CPU,swap0.
- cleanup root:33554432B(32MiB),8tasks,10%CPU,swap0.
- Total4servicios:134217728B(128MiB),48tasks,60%CPU por suma de cuotas. No192MiB/64porservicio.
- Gates10s; holder start12s/runtime30s; supervisor60s/cleanup70s, stop2s. Espera externa90s. Esto no garantiza que la intervención completa termine en70/90s.
- Gate de capacidad≥536870912B MemAvailable y≥128pids libres en ancestros limitados comprobados.

Las utilidades externas de preparación/finalización NO están dentro de esos cuatro cgroups: no tienen un límite independiente de memoria/tasks/CPU. No anunciar128MiB como techo del proceso operador más todas las herramientas del sistema. Caps propios:36materiales públicos, cada uno≤1MiB y total≤12MiB; cinco pasadas de seis binarios, cada binario≤16MiB y cada pasada≤96MiB;≤192comandos manager externos con2s y16KiB cada uno; herramientas de cuenta con2s cada llamada. Las consultas/acciones que hacen los servicios internamente son su propio contrato existente, no se cuentan como si estuvieran en el contador externo192. El kernel puede bloquear una operación: estos son límites de userspace, no una garantía de muerte universal ni deadline de todo el sistema. Los comandos de cuenta pueden escribir su auditoría/cachés/backups normales, que no se purgan.

## Retención y follow-through

Control/seed se retienen≥86400s desde el cierre sellado. Se propone notBefore con margen120s para finalización; si esta se demora más allá de ese margen, HOLD en lugar de declarar que se cumplen24h. No se promete revisión antes de24h. A la hora propuesta, main debe hacer una sola revisión de estado y avisar en privado para decidir el ticket exacto. Sin borrado automático ni reintentos silenciosos. La aprobación de un ensayo no se convierte en aprobación de un ticket todavía inexistente.

Executor, audit ticket/closeout y shared parents quedan indefinidamente hasta petición específica y revisión posterior, sin borrado programado fuera de esa aprobación. Backup cifrado/SQLite y su seguimiento existente permanecen intactos. El retorno del invocador incluye IDs que main necesita para asignar ese seguimiento: crear el plan ahora no lo programa.

## Verificación y límites

Pruebas LOCAL con NSS/IO/manager ficticios ejercitan las funciones reales de asignación, bootstrap, StartController, ExactRemover, PrincipalRetire, Finalizer y Retirement.prepare/freeze. Incluyen el recorrido completo, fallos de cada fase, cuenta incierta, instalación parcial, start ambiguo después de reload, identidad original reutilizada, archivo desconocido antes de finalizer, freeze fallido después de efectos, ticket/retención alterados, cierre de handles y ausencia de efectos por import/construcción/sin autoridad. No se ejecutan cuentas, systemctl, SSH, OS root ni fuentes de producción.

Esto completa el preparativo local de plan e invocador. Sigue pendiente revisión independiente y luego aprobación owner del alcance. No falta que David elija UID/GID. Después de aprobación se verifican los inputs por las fases exactas del intento, no con otro diagnóstico genérico. No hay admisión a producción: sandbox real/mounts/deny/caps/proc, continuidadOFD, cgroupFDs reales, carreras privilegiadas y limpieza con ambos custodios muertos no están probados enHOST. Flake histórico local holder-ready sigue abierto.
