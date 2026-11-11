import {test} from 'node:test';
import assert from 'node:assert/strict';
import {crearLocalSlmInferenceService,validarContraEsquema} from '../../src/services/localSlmInferenceService.js';
const esquema={type:'object',required:['producto'],properties:{producto:{type:'string'}},additionalProperties:false};
function fixture(confianza){let calls=0;return {get calls(){return calls;},service:crearLocalSlmInferenceService({provider:{async chatCompletion(p){calls++;const system=p.messages[0].content;const content=system.includes('Clasifica')?JSON.stringify({intencion:'notas',confianza}):system.includes('Extrae')?JSON.stringify({argumentos:{producto:'arroz'},confianza}):`Hola\n${JSON.stringify({confianza})}`;return {message:{content}};}}})};}
for(const value of [true,false,'0.99','1',null,[],{}])test(`non-numeric confidence ${JSON.stringify(value)} fails closed in all three paths`,async()=>{
 const f=fixture(value);
 const results=await Promise.all([f.service.clasificarIntencion('nota',['notas']),f.service.extraerArgumentos('arroz','comprar',esquema),f.service.responderConversacion('hola')]);
 assert.ok(results.every(r=>r.exito===false&&r.motivo==='slm_parse_fail'));assert.equal(f.calls,3);
});
test('numeric confidence remains usable without claiming calibration',async()=>{const f=fixture(0.9);assert.equal((await f.service.extraerArgumentos('arroz','comprar',esquema)).exito,true);});
for(const value of [true,'0.82',NaN,Infinity,-1,2])test(`invalid configured threshold ${String(value)} rejected`,()=>{assert.throws(()=>crearLocalSlmInferenceService({provider:{chatCompletion(){}},umbral:value}),TypeError);});
for(const [keyword,value] of [['minimum',0],['pattern','^a'],['format','email'],['oneOf',[]],['$ref','#/x'],['default',1]])test(`unsupported schema keyword ${keyword} rejected before provider call`,async()=>{
 const f=fixture(0.99);const e=structuredClone(esquema);e.properties.producto[keyword]=value;
 assert.deepEqual(validarContraEsquema({producto:'arroz'},e),['esquema_no_soportado']);
 assert.equal((await f.service.extraerArgumentos('arroz','comprar',e)).motivo,'esquema_no_soportado');assert.equal(f.calls,0);
});
test('array item constraints actually reject bad elements',()=>{const e={type:'array',items:{type:'integer'}};assert.deepEqual(validarContraEsquema([1,2],e),[]);assert.ok(validarContraEsquema([1,'2'],e).length);});
test('additionalProperties false rejects extra arguments',()=>{assert.ok(validarContraEsquema({producto:'arroz',cantidad:9},esquema).length);});
test('inherited required fields do not satisfy schema',()=>{assert.ok(validarContraEsquema(Object.create({producto:'arroz'}),esquema).length);});
test('nullable object union still validates nested properties',()=>{const e={type:['object','null'],properties:{x:{type:'integer'}},required:['x']};assert.deepEqual(validarContraEsquema(null,e),[]);assert.ok(validarContraEsquema({x:'1'},e).length);});
test('malformed or recursive schemas reject rather than throw or recurse forever',()=>{const cyclic={type:'object',properties:{}};cyclic.properties.self=cyclic;for(const e of [null,[],{},true,{type:'weird'},{type:'object',required:'x'},cyclic])assert.deepEqual(validarContraEsquema({},e),['esquema_no_soportado']);});
test('depth budget rejects deep schema',()=>{let e={type:'string'};for(let i=0;i<30;i++)e={type:'array',items:e};assert.deepEqual(validarContraEsquema([],e),['esquema_no_soportado']);});
test('unsafe integer and nonfinite number rejected',()=>{assert.ok(validarContraEsquema(Number.MAX_SAFE_INTEGER+1,{type:'integer'}).length);assert.ok(validarContraEsquema(Infinity,{type:'number'}).length);});
test('oversized typed arrays rejected without unbounded walk',()=>{assert.deepEqual(validarContraEsquema(Array(4097).fill(1),{type:'array',items:{type:'integer'}}),['valor_fuera_de_limites']);});
test('unknown enum object semantics are not silently certified',()=>{assert.deepEqual(validarContraEsquema({}, {type:'object',enum:[{}]}),['esquema_no_soportado']);});
test('untyped extraction schemas rejected before generation',async()=>{const f=fixture(1);assert.equal((await f.service.extraerArgumentos('arroz','comprar',{properties:{producto:{type:'string'}}})).motivo,'esquema_no_soportado');assert.equal(f.calls,0);});
