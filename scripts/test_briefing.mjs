import { generarBriefingCompleto } from '../src/services/dailyBriefing.js';
const texto = await generarBriefingCompleto('Madrid');
console.log(texto);
