// Verificacion en vivo del indice GTFS Renfe y del feed LD (7 nov 2026).
// Uso: node scripts/check_renfe_live.js
import { resolverEstaciones } from '../src/services/renfeGtfsService.js';
import { llegadasTrenLD } from '../src/services/cercaniasAdapter.js';
import { proximasLlegadas } from '../src/services/transportService.js';

const deps = { rutaCache: '/tmp/live-estaciones-renfe.json' };

console.log('== indice GTFS ==');
for (const q of ['atocha', 'zaragoza delicias', 'estacion inexistente xyz']) {
  const r = await resolverEstaciones(q, deps);
  console.log(q, '->', JSON.stringify(r));
}

console.log('== feed LD directo (stop 62103, observado en vivo) ==');
const ld = await llegadasTrenLD('62103', {});
console.log('ok:', ld.ok, 'llegadas:', ld.llegadas ? ld.llegadas.length : 0, 'ejemplo:', JSON.stringify(ld.llegadas ? ld.llegadas[0] : null));

console.log('== proximasLlegadas por nombre LD (zaragoza delicias, tipo tren) ==');
const zaza = await proximasLlegadas({ parada: 'zaragoza delicias', tipo: 'tren' }, deps);
console.log(JSON.stringify(zaza));
