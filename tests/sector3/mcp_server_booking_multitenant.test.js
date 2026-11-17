import test from 'node:test';
import assert from 'node:assert/strict';
import { crearBookingDb } from '../../mcp-servers/booking/db.js';

test('Multi-tenant booking: aislamiento estricto de citas y huecos por tenant', () => {
  const db = crearBookingDb(':memory:');

  const fecha = '2026-11-20';
  const slot = `${fecha}T10:00:00.000Z`;

  // 1. Tenant A reserva a las 10:00
  const resA = db.reservarCita({
    cliente_nombre: 'Cliente A',
    cliente_telefono: '+34600111222',
    fecha_inicio: slot,
    duracion_minutos: 30,
    servicio: 'Consulta A',
    tenant_id: 'tenant_clinica_a'
  });
  assert.equal(resA.ok, true);
  assert.equal(resA.cita.tenant_id, 'tenant_clinica_a');

  // 2. Tenant B reserva exactamente en el MISMO horario (10:00) -> NO colisiona porque son tenants distintos
  const resB = db.reservarCita({
    cliente_nombre: 'Cliente B',
    cliente_telefono: '+34600333444',
    fecha_inicio: slot,
    duracion_minutos: 30,
    servicio: 'Consulta B',
    tenant_id: 'tenant_clinica_b'
  });
  assert.equal(resB.ok, true);
  assert.equal(resB.cita.tenant_id, 'tenant_clinica_b');

  // 3. Propietario consulta disponibilidad a las 10:00 -> el hueco 10:00 SIGUE disponible para propietario
  const dispProp = db.consultarDisponibilidad({ fecha, tenant_id: 'propietario' });
  assert.equal(dispProp.total_disponibles, 22);
  assert.equal(dispProp.huecos_disponibles.some(h => h.hora_inicio === '10:00'), true);

  // 4. Tenant A consulta disponibilidad a las 10:00 -> el hueco 10:00 NO esta disponible para Tenant A
  const dispA = db.consultarDisponibilidad({ fecha, tenant_id: 'tenant_clinica_a' });
  assert.equal(dispA.total_disponibles, 21);
  assert.equal(dispA.huecos_disponibles.some(h => h.hora_inicio === '10:00'), false);

  // 5. Listar citas por tenant -> Tenant A solo ve su cita, Tenant B solo ve la suya
  const listA = db.listarCitas({ tenant_id: 'tenant_clinica_a' });
  assert.equal(listA.total, 1);
  assert.equal(listA.citas[0].cliente_nombre, 'Cliente A');

  const listB = db.listarCitas({ tenant_id: 'tenant_clinica_b' });
  assert.equal(listB.total, 1);
  assert.equal(listB.citas[0].cliente_nombre, 'Cliente B');

  // 6. Intento de cancelacion cross-tenant: Tenant B intenta cancelar la cita de Tenant A por ID
  const cancelCrossId = db.cancelarCita({
    cita_id: resA.cita.id,
    tenant_id: 'tenant_clinica_b'
  });
  assert.equal(cancelCrossId.ok, false);
  assert.match(cancelCrossId.error, /No se encontro ninguna cita/);

  // Intento de cancelacion cross-tenant por nombre
  const cancelCrossNombre = db.cancelarCita({
    cliente_nombre: 'Cliente A',
    tenant_id: 'tenant_clinica_b'
  });
  assert.equal(cancelCrossNombre.ok, false);

  // Intento de cancelacion cross-tenant por telefono y fecha
  const cancelCrossTel = db.cancelarCita({
    cliente_telefono: '+34600111222',
    fecha,
    tenant_id: 'tenant_clinica_b'
  });
  assert.equal(cancelCrossTel.ok, false);

  // La cita de Tenant A sigue confirmada
  const citaAVerif = db.obtenerCitaPorId(resA.cita.id, 'tenant_clinica_a');
  assert.equal(citaAVerif.estado, 'confirmada');

  // Cancelacion valida por su propio tenant
  const cancelPropio = db.cancelarCita({
    cita_id: resA.cita.id,
    tenant_id: 'tenant_clinica_a'
  });
  assert.equal(cancelPropio.ok, true);
  assert.equal(cancelPropio.cita.estado, 'cancelada');

  db.cerrar();
});
