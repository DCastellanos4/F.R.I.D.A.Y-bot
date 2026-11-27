/**
 * opsSecurityHandlers.js - Manejadores de herramientas de Operaciones, Infraestructura y Seguridad.
 *
 * Politica estricta: cero emojis en codigo, comentarios y respuestas.
 */

import { config } from '../../config/config.js';
import { consultarSaludServidor, comprobarPuertoTCP } from '../../monitors/proactiveAlerts.js';
import { requestExecution } from '../../system/bashConsoleService.js';
import { generatePassword, generatePin, generateToken, generateCryptoKey, saveCredentialToMemory } from '../../services/cryptoGeneratorService.js';
import { inspectContainers } from '../../monitors/dockerMonitorService.js';
import { checkDiskUsage } from '../../system/diskStorageService.js';
import { readNetworkBytes } from '../../monitors/networkMonitorService.js';
import { checkCertificateExpiry } from '../../monitors/sslMonitorService.js';
import { getTunnelStatus, startTunnel, stopTunnel } from '../../system/tunnelManagerService.js';
import { createEncryptedBackup } from '../../system/backupService.js';
import { registrarProceso, dejarDeVigilar, listarProcesos, configurarVigilancia } from '../../services/processWatchdogService.js';
import { auditarDependencias, configurarVigilanciaDependencias, informeMetricas, configurarInformeMetricas, actividadRepos, configurarAlertasRepos, crearBackupSesion, verificarBackupSesion } from '../../services/opsService.js';
import { explicarUltimoRecorrido } from '../../services/traceService.js';

export function crearManejadoresOpsYSeguridad() {
  return {
    consultar_estado_servidor: async () => {
      const salud = consultarSaludServidor();
      const mcOnline = await comprobarPuertoTCP(config.minecraft.host, config.minecraft.port, 2000);
      return `Salud del sistema:\n- Memoria RAM: ${salud.libreRamGB} GB libres de ${salud.totalRamGB} GB (${salud.porcentajeUso}% en uso)\n- Procesador: ${salud.cpus} núcleos (Carga media: ${salud.loadAvg})\n- Servidor de Minecraft (${config.minecraft.host}:${config.minecraft.port}): ${mcOnline ? 'ONLINE' : 'CAIDO / APAGADO'}`;
    },
    execute_bash_command: async (args, opciones) => {
      const cmd = args.comando || '';
      const res = await requestExecution(cmd, { otpDelivery: opciones.otpDelivery });
      if (res.status === 'EXECUTED') {
        let out = `Comando ejecutado con exito (Codigo: ${res.exitCode}):\n${res.stdout || res.stderr || 'Comando completado sin salida'}`;
        if (res.verificacion) {
          out += `\nVerificacion posterior (${res.verificacion.comando}): ${res.verificacion.exito ? 'efecto confirmado en el sistema' : 'NO se pudo confirmar el efecto'}.\n${res.verificacion.salida}`;
        }
        return out;
      }
      if (res.status === 'OTP_REQUIRED') {
        return res.otpDelivered
          ? `El comando "${cmd}" es critico (${res.reason}). He enviado un codigo OTP de 6 digitos al canal privado de David (validez: ${res.ttlSeconds} segundos, ID: ${res.commandId}). Indicale que lo confirme respondiendo "confirmar otp CODIGO". Tu no tienes acceso al codigo ni puedes confirmarlo.`
          : `El comando "${cmd}" es critico (${res.reason}) y requiere confirmacion 2FA, pero no hay un canal directo configurado para entregar el codigo OTP (disponible desde WhatsApp o la terminal interactiva). Comando en espera con ID: ${res.commandId}.`;
      }
      if (res.status === 'FORBIDDEN') return `Comando denegado por politica de seguridad: ${res.reason}`;
      return `Fallo en la ejecucion del comando: ${res.error || res.status}`;
    },
    generate_crypto_credential: async (args) => {
      const tipo = (args.tipo || 'password').toLowerCase();
      let valorSecreto = '';
      let info = '';
      if (tipo === 'password') {
        const resPwd = generatePassword(args.longitud || 16, { detailed: true });
        valorSecreto = resPwd.password;
        info = `Password generado (Longitud: ${resPwd.length}, Entropia: ${resPwd.entropy} bits): ${valorSecreto}`;
      } else if (tipo === 'pin') {
        valorSecreto = generatePin(args.longitud || 6);
        info = `PIN numerico generado (${args.longitud || 6} digitos): ${valorSecreto}`;
      } else if (tipo === 'token') {
        valorSecreto = generateToken(args.longitud || 32);
        info = `Token criptografico generado (${args.longitud || 32} bytes): ${valorSecreto}`;
      } else if (tipo === 'key') {
        const algo = args.algoritmo || 'aes-256';
        const resKey = generateCryptoKey(algo, { detailed: true });
        valorSecreto = resKey.key;
        info = `Clave criptografica ${algo.toUpperCase()} (${resKey.bitLength} bits): ${valorSecreto}`;
      } else {
        valorSecreto = generatePassword(16);
        info = `Credencial generada: ${valorSecreto}`;
      }
      if (args.guardar_en_memoria) {
        const nombreClave = args.nombre_clave || `Credencial ${tipo.toUpperCase()}`;
        const resMem = await saveCredentialToMemory(nombreClave, valorSecreto, args.notas || '');
        info += resMem.ok
          ? `\nCredencial archivada de forma segura en el Second Brain bajo la clave "${nombreClave}".`
          : `\nAviso: No se pudo archivar en el Second Brain: ${resMem.error}`;
      }
      return info;
    },
    get_infrastructure_status: async (args) => {
      const lineas = ['[ESTADO DE INFRAESTRUCTURA]'];
      if (args.incluir_docker !== false) {
        try {
          const containers = await inspectContainers();
          lineas.push(`Contenedores Docker (${containers.length}):`);
          for (const c of containers) {
            lineas.push(`- ${c.name} (${c.id.slice(0, 12)}): ${c.status} (Uptime: ${c.uptime || 'N/A'})`);
          }
        } catch (errDock) {
          lineas.push(`Docker: Error al consultar estado (${errDock.message})`);
        }
      }
      if (args.incluir_disco !== false) {
        try {
          const disco = checkDiskUsage('/');
          const libreGB = (disco.freeBytes / (1024 ** 3)).toFixed(2);
          const totalGB = (disco.totalBytes / (1024 ** 3)).toFixed(2);
          lineas.push(`Almacenamiento en disco: ${disco.percentUsed}% en uso (${libreGB} GB libres de ${totalGB} GB)`);
        } catch (errDisk) {
          lineas.push(`Disco: Error al inspeccionar almacenamiento (${errDisk.message})`);
        }
      }
      if (args.incluir_red !== false) {
        try {
          const net = await readNetworkBytes();
          const rxMB = (net.rxBytes / (1024 ** 2)).toFixed(2);
          const txMB = (net.txBytes / (1024 ** 2)).toFixed(2);
          lineas.push(`Trafico de red acumulado (${net.iface}): RX ${rxMB} MB | TX ${txMB} MB`);
        } catch (errNet) {
          lineas.push(`Red: No disponible (${errNet.message})`);
        }
      }
      if (args.dominio_ssl) {
        try {
          const ssl = await checkCertificateExpiry(args.dominio_ssl, 443);
          lineas.push(`Certificado SSL (${ssl.host}): ${ssl.daysRemaining} dias restantes (Caduca: ${ssl.validTo})`);
        } catch (errSsl) {
          lineas.push(`SSL (${args.dominio_ssl}): Error al inspeccionar certificado (${errSsl.message})`);
        }
      }
      return lineas.join('\n');
    },
    manage_tunnel: async (args) => {
      const tipo = args.tipo_tunel;
      const accion = args.accion;
      const nombre = args.nombre_tunel;
      if (!tipo) return 'Debes indicar el tipo de tunel (cloudflare o tailscale).';
      if (accion === 'status') {
        const res = await getTunnelStatus(tipo, { tunnelName: nombre });
        return `Estado del tunel ${tipo?.toUpperCase() || 'DESCONOCIDO'}: ${res.running ? 'ACTIVO Y EN LINEA' : 'DETENIDO'} (Instalado: ${res.installed ? 'SI' : 'NO'})`;
      }
      if (accion === 'start') {
        const res = await startTunnel(tipo, { tunnelName: nombre });
        return res.success ? `Tunel ${tipo} iniciado con exito: ${res.message}` : `Fallo al iniciar tunel ${tipo}: ${res.message}`;
      }
      if (accion === 'stop') {
        const res = await stopTunnel(tipo, { tunnelName: nombre });
        return res.success ? `Tunel ${tipo} detenido con exito: ${res.message}` : `Fallo al detener tunel ${tipo}: ${res.message}`;
      }
      return `Accion de tunel desconocida: ${accion}`;
    },
    trigger_encrypted_backup: async () => {
      const pass = process.env.BACKUP_PASSPHRASE || process.env.DAVIS_BACKUP_KEY || '';
      if (!pass) {
        return 'No se puede generar la copia de seguridad: falta BACKUP_PASSPHRASE en el entorno. Sin passphrase configurada no se cifra nada con valores por defecto.';
      }
      try {
        const res = await createEncryptedBackup({ passphrase: pass });
        const tamanoKB = (res.sizeBytes / 1024).toFixed(2);
        return `Copia de seguridad cifrada completada con exito (AES-256-GCM DAVBAK01).\nArchivo: ${res.backupPath}\nTamano: ${tamanoKB} KB (${res.fileCount} ficheros incluidos)\nSHA256: ${res.sha256}`;
      } catch (errBak) {
        return `Error al generar la copia de seguridad cifrada: ${errBak.message}`;
      }
    },
    vigilar_proceso: (args, opciones) => {
      const res = registrarProceso({ nombre: args.nombre, patron: args.patron, cpuLimite: args.cpuLimite, memLimite: args.memLimite }, { rutaArchivo: opciones.rutaArchivoProcesos });
      return res.ok
        ? `Proceso vigilado, David: ${res.proceso.nombre} (patron "${res.proceso.patron}"${res.proceso.cpuLimite ? `, CPU max ${res.proceso.cpuLimite}%` : ''}${res.proceso.memLimite ? `, memoria max ${res.proceso.memLimite}%` : ''}). Recuerda que la vigilancia proactiva se activa aparte, si tu quieres: "activa la vigilancia de procesos".`
        : `No lo he podido registrar: ${res.error}`;
    },
    listar_procesos_vigilados: (_args, opciones) => {
      const lista = listarProcesos({ rutaArchivo: opciones.rutaArchivoProcesos });
      return lista.length === 0
        ? 'No hay procesos vigilados. Registra uno con "vigila el proceso X".'
        : 'Procesos vigilados:\n' + lista.map((x) => `- ${x.nombre} (patron "${x.patron}", estado ${x.estadoActual}${x.cpuLimite ? `, CPU max ${x.cpuLimite}%` : ''}${x.memLimite ? `, mem max ${x.memLimite}%` : ''})`).join('\n');
    },
    dejar_vigilar_proceso: (args, opciones) => {
      const res = dejarDeVigilar(args.criterio, { rutaArchivo: opciones.rutaArchivoProcesos });
      return res.ok ? `Dejo de vigilar "${res.proceso.nombre}", David.` : res.error;
    },
    configurar_vigilante_procesos: (args, opciones) => {
      const pideActivarProc = /(activa(r|s|do)?|enciend(e|er)|pon\s+en\s+marcha)\s+.{0,30}(vigilancia|proceso)/i.test(opciones.mensajeUsuario || '');
      if (args.activo === true && !pideActivarProc) {
        return 'Para activar la vigilancia de procesos necesito que me lo pidas tu directamente (por ejemplo: "activa la vigilancia de procesos").';
      }
      const res = configurarVigilancia({ activo: args.activo === true }, { rutaArchivo: opciones.rutaArchivoProcesos });
      return res.ok
        ? (res.activo ? 'Vigilancia de procesos activada, David: avisare si alguno cae o se pasa de los limites.' : 'Vigilancia de procesos desactivada, David.')
        : `No he podido cambiar la vigilancia: ${res.error}`;
    },
    auditar_dependencias: async () => {
      const res = await auditarDependencias({});
      return !res.ok ? res.error
        : `npm audit: ${res.totales.critica} critica(s), ${res.totales.alta} alta(s), ${res.totales.moderada} moderada(s), ${res.totales.baja} baja(s).\n` +
          (res.vulnerabilidades.length ? 'Principales:\n' + res.vulnerabilidades.map((v) => `- [${v.severidad}] ${v.nombre}${v.viaDirecta ? ' (directa)' : ''}: ${v.correccion}`).join('\n') + '\n' : 'Sin vulnerabilidades listadas.\n') +
          res.nota;
    },
    configurar_vigilancia_dependencias: (args, opciones) => {
      const quiere = args.activo === true;
      const pideTexto = /(activa(r|s|do)?|enciend(e|er)|pon\s+en\s+marcha)\s+.{0,40}(vigilancia|dependencias|audit)/i.test(opciones.mensajeUsuario || '');
      if (quiere && !pideTexto) {
        return 'No he activado la vigilancia de dependencias porque tu mensaje no lo pedia explicitamente. Si la quieres, dime "activa la vigilancia de dependencias".';
      }
      const res = configurarVigilanciaDependencias({ activo: args.activo }, { rutaConfig: opciones.rutaConfigOps });
      return res.activo ? 'Vigilancia de dependencias ACTIVADA: avisare si npm audit encuentra vulnerabilidades graves (criticas o altas).' : 'Vigilancia de dependencias desactivada.';
    },
    informe_metricas: (args, opciones) => {
      const res = informeMetricas({ dias: args.dias ?? 7 }, { rutaArchivo: opciones.rutaArchivoMetricas });
      return `Metricas del bot (ultimos ${res.periodoDias} dias): ${res.totalComandos} comandos, ${res.totalErrores} errores.\n` +
        (res.comandosMasUsados.length ? 'Mas usados:\n' + res.comandosMasUsados.map((c) => `- ${c.nombre}: ${c.usos} uso(s)${c.mediaMs != null ? `, media ${c.mediaMs} ms, p95 ${c.p95Ms} ms` : ''}`).join('\n') : 'Sin actividad registrada todavia.') +
        (res.erroresRecientes.length ? '\nErrores recientes:\n' + res.erroresRecientes.map((e) => `- ${e}`).join('\n') : '');
    },
    configurar_informe_metricas: (args, opciones) => {
      const quiere = args.activo === true;
      const pideTexto = /(activa(r|s|do)?|enciend(e|er)|pon\s+en\s+marcha|quiero)\s+.{0,40}(informe|metricas)/i.test(opciones.mensajeUsuario || '');
      if (quiere && !pideTexto) {
        return 'No he activado el informe semanal de metricas porque tu mensaje no lo pedia explicitamente. Si lo quieres, dime "activa el informe de metricas".';
      }
      const res = configurarInformeMetricas({ activo: args.activo }, { rutaConfig: opciones.rutaConfigOps });
      return res.activo ? 'Informe semanal de metricas ACTIVADO (te llegara por la cola de avisos).' : 'Informe semanal de metricas desactivado.';
    },
    actividad_repos: async (args, opciones) => {
      const res = await actividadRepos({ repos: args.repos }, { fetchFn: opciones.fetchFnGitHub, rutaConfig: opciones.rutaConfigOps });
      return !res.ok ? res.error
        : 'Actividad de tus repos:\n' + res.repos.map((r) => r.error ? `- ${r.repo}: error (${r.error})` : `- ${r.repo}: ${r.estrellas} estrellas, ${r.forks} forks, ${r.issuesAbiertas} issues abiertas`).join('\n') + `\n${res.nota}`;
    },
    configurar_alertas_repos: (args, opciones) => {
      const quiere = args.activo === true;
      const pideTexto = /(activa(r|s|do)?|enciend(e|er)|pon\s+en\s+marcha|quiero)\s+.{0,40}(alertas?|avisos?)\s+.{0,30}(repos|repositorios|github)/i.test(opciones.mensajeUsuario || '');
      if (quiere && !pideTexto) {
        return 'No he activado las alertas de repos porque tu mensaje no lo pedia explicitamente. Si las quieres, dime "activa las alertas de mis repos".';
      }
      const res = configurarAlertasRepos({ activo: args.activo, repos: args.repos }, { rutaConfig: opciones.rutaConfigOps });
      return res.activo ? `Alertas de repos ACTIVADAS para: ${res.repos.join(', ')} (avisos de cambios en estrellas, forks e issues).` : 'Alertas de repos desactivadas.';
    },
    crear_backup_sesion: async () => {
      const res = await crearBackupSesion({});
      return !res.ok ? res.error : `Backup cifrado creado: ${res.archivo} (${Math.round(res.bytes / 1024)} KB).\n${res.nota}`;
    },
    verificar_backup_sesion: async (args) => {
      const res = await verificarBackupSesion({ archivo: args.archivo }, {});
      return !res.ok ? res.error : `Backup verificado: ${Math.round(res.bytes / 1024)} KB recuperables.\n${res.nota}`;
    },
    explicar_recorrido: (_args, opciones) => explicarUltimoRecorrido(opciones.chatId, opciones)
  };
}
