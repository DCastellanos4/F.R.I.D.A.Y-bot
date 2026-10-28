import fs from 'fs';
import { execSync } from 'child_process';
import { transcribirAudioBuffer } from './voiceService.js';

async function testVoice() {
  console.log('--- TEST TRANSCRIPTOR DE VOZ LOCAL (WHISPER) ---');
  execSync('ffmpeg -y -i /home/ubuntu/whisper.cpp/samples/jfk.wav -c:a libopus /tmp/test_unit_voice.ogg');
  const buffer = fs.readFileSync('/tmp/test_unit_voice.ogg');
  console.log(`Buffer OGG creado: ${buffer.length} bytes`);

  const t0 = Date.now();
  const resultado = await transcribirAudioBuffer(buffer);
  const duracion = ((Date.now() - t0) / 1000).toFixed(2);

  console.log(`[Tiempo] Transcripción completada en ${duracion}s:`, resultado);
  fs.unlinkSync('/tmp/test_unit_voice.ogg');

  if (resultado.ok && resultado.texto.includes('country')) {
    console.log('[OK] [PASS] Transcripción de nota de voz funcionando al 100%');
  } else {
    console.error('[Error] [FAIL] Transcripción incorrecta');
    process.exit(1);
  }
}

testVoice().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
