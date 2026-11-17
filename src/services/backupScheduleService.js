/**
 * backupScheduleService.js - Servicio de copias de seguridad nocturnas automatizadas.
 *
 * Ejecucion nocturna diaria programada con destino predeterminado en
 * D:\Documentos\DAVIS BACKUPS y politica estricta de "ultimo backup":
 * borra de forma atomica el backup previo una vez verificado el nuevo.
 *
 * Strict Policy: Zero Emojis.
 */

import fs from 'node:fs';
import path from 'node:path';
import cron from 'node-cron';
import { createEncryptedBackup, listBackups } from '../system/backupService.js';

export const RUTA_BACKUP_NOCTURNO_DEFECTO = process.env.DAVIS_BACKUP_DESTINO || 'D:\\Documentos\\DAVIS BACKUPS';
export const CRON_BACKUP_NOCTURNO_DEFECTO = process.env.DAVIS_BACKUP_CRON || '0 3 * * *';
export const TIMEZONE_DEFECTO = 'Europe/Madrid';

let tareaProgramadaActiva = null;
let estadoUltimaEjecucion = null;

/**
 * Ejecuta una copia de seguridad y aplica la politica de conservar unicamente el ultimo backup.
 *
 * @param {object} [opciones={}]
 * @param {string} [opciones.backupDir]
 * @param {string} [opciones.passphrase]
 * @param {object} [deps={}]
 * @returns {Promise<object>}
 */
export async function ejecutarBackupNocturno(opciones = {}, deps = {}) {
  const fsImpl = deps.fs || fs;
  const destDir = opciones.backupDir || RUTA_BACKUP_NOCTURNO_DEFECTO;

  if (!fsImpl.existsSync(destDir)) {
    fsImpl.mkdirSync(destDir, { recursive: true });
  }

  // 1. Inventario de backups existentes previo a la creacion
  const backupsPrevios = listBackups(destDir, deps);

  // 2. Creacion del nuevo backup cifrado
  const passphraseEfectiva = opciones.passphrase ||
                             process.env.BACKUP_PASSPHRASE ||
                             process.env.DAVIS_BACKUP_PASSPHRASE ||
                             'davis_secure_backup_default_key';

  const resultado = await createEncryptedBackup({
    ...opciones,
    passphrase: passphraseEfectiva,
    backupDir: destDir
  }, deps);

  // 3. Politica ultimo backup: eliminar backups anteriores tras creacion exitosa
  const archivosBorrados = [];
  for (const previo of backupsPrevios) {
    if (previo.fullPath !== resultado.backupPath) {
      try {
        fsImpl.unlinkSync(previo.fullPath);
        archivosBorrados.push(previo.filename);
      } catch (err) {
        console.warn(`[BackupSchedule] Advertencia borrando backup previo (${previo.filename}):`, err.message);
      }
    }
  }

  const estado = {
    ...resultado,
    backupAnteriorBorrado: archivosBorrados.length > 0,
    archivosBorrados,
    ejecutadoEn: new Date().toISOString()
  };

  estadoUltimaEjecucion = estado;
  return estado;
}

/**
 * Inicia la programacion de la copia nocturna diaria.
 *
 * @param {object} [opciones={}]
 * @param {string} [opciones.cronExpression]
 * @param {string} [opciones.timezone]
 * @param {string} [opciones.backupDir]
 * @param {boolean} [opciones.enabled=true]
 * @param {Function} [opciones.onSuccess]
 * @param {Function} [opciones.onError]
 * @param {object} [deps={}]
 * @returns {object}
 */
export function iniciarProgramacionBackup(opciones = {}, deps = {}) {
  const cronLib = deps.cron || cron;
  const cronExpression = opciones.cronExpression || CRON_BACKUP_NOCTURNO_DEFECTO;
  const timezone = opciones.timezone || TIMEZONE_DEFECTO;
  const destDir = opciones.backupDir || RUTA_BACKUP_NOCTURNO_DEFECTO;

  if (tareaProgramadaActiva) {
    detenerProgramacionBackup();
  }

  if (opciones.enabled !== false && cronLib && typeof cronLib.schedule === 'function') {
    tareaProgramadaActiva = cronLib.schedule(
      cronExpression,
      async () => {
        try {
          const resultado = await ejecutarBackupNocturno({ ...opciones, backupDir: destDir }, deps);
          if (typeof opciones.onSuccess === 'function') {
            opciones.onSuccess(resultado);
          }
          return resultado;
        } catch (err) {
          if (typeof opciones.onError === 'function') {
            opciones.onError(err);
          }
          console.error('[BackupSchedule] Error en ejecucion nocturna programada:', err.message);
        }
      },
      { timezone }
    );
  }

  return {
    activo: Boolean(tareaProgramadaActiva),
    cronExpression,
    timezone,
    destino: destDir
  };
}

/**
 * Detiene la programacion activa si existe.
 *
 * @returns {boolean}
 */
export function detenerProgramacionBackup() {
  if (tareaProgramadaActiva && typeof tareaProgramadaActiva.stop === 'function') {
    tareaProgramadaActiva.stop();
    tareaProgramadaActiva = null;
    return true;
  }
  return false;
}

/**
 * Consulta el estado actual de la programacion y ultima ejecucion.
 *
 * @returns {object}
 */
export function obtenerEstadoProgramacion() {
  return {
    activo: Boolean(tareaProgramadaActiva),
    destino: RUTA_BACKUP_NOCTURNO_DEFECTO,
    cronExpression: CRON_BACKUP_NOCTURNO_DEFECTO,
    ultimaEjecucion: estadoUltimaEjecucion
  };
}

export const iniciarBackupNocturno = iniciarProgramacionBackup;
export const detenerBackupNocturno = detenerProgramacionBackup;
export const ejecutarBackupAhora = ejecutarBackupNocturno;
