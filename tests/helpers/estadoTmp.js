import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Aisla todo el estado por defecto (programados, memorias, agenda) en un
// directorio tmp: las pruebas que ejecutan el agente nunca tocan data/.
process.env.DAVIS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-data-test-'));
