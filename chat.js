import readline from 'readline';
import { consultarJarvis } from './jarvisAgent.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.clear();
console.log('====================================================');
console.log('🤖 F.R.I.D.A.Y. - TERMINAL TÁCTICA INTERACTIVA');
console.log('====================================================');
console.log('Puedes pedirle recordatorios, clima, noticias, memoria o charlar.');
console.log('Escribe "salir" o pulsa Ctrl+C para terminar.\n');

const historial = [];

function promptUsuario() {
  rl.question('👤 David: ', async (entrada) => {
    const texto = entrada.trim();
    if (!texto) {
      promptUsuario();
      return;
    }

    if (texto.toLowerCase() === 'salir' || texto.toLowerCase() === 'exit') {
      console.log('\nHasta luego, jefe. Sistemas en reposo.');
      process.exit(0);
    }

    try {
      console.log('\n🤖 FRIDAY está evaluando...');
      const inicio = Date.now();
      const respuesta = await consultarJarvis(texto, historial);
      const tiempo = ((Date.now() - inicio) / 1000).toFixed(1);

      console.log(`\n💬 FRIDAY (${tiempo}s):`);
      console.log(respuesta);
      console.log('\n----------------------------------------------------');

      // Mantener memoria de contexto en la conversación
      historial.push({ role: 'user', content: texto });
      historial.push({ role: 'assistant', content: respuesta });
      if (historial.length > 8) {
        historial.splice(0, 2);
      }
    } catch (err) {
      console.error('\n❌ Error al consultar a FRIDAY:', err.message);
    }

    promptUsuario();
  });
}

promptUsuario();
