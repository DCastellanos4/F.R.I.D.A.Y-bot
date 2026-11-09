import { test } from 'node:test';
import assert from 'node:assert/strict';
import { argumentosConcurrencia } from './testConcurrency.js';
test('runner default conserva argumentos historicos, sin concurrencia forzada',()=>{assert.deepEqual(argumentosConcurrencia(undefined),[]);assert.deepEqual(argumentosConcurrencia(''),[]);});
test('runner admite concurrencia explicita8 sin filtrar ninguna suite',()=>{assert.deepEqual(argumentosConcurrencia('8'),['--test-concurrency=8']);});
test('runner rechaza valores invalidos de concurrencia antes de lanzar subproceso',()=>{for(const v of ['0','-1','8.5','x','129','8 --test-skip-pattern=x'])assert.throws(()=>argumentosConcurrencia(v));});
