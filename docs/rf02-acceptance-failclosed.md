# RF02: aceptar solo lo que se valida

Preparacion LOCAL sobre `f68469063f127d1d25513d8d0fe7f4c2e88ada48`, 11 de noviembre de 2026. No activa el SLM ni cambia la cola, el proveedor, los gates, el servidor o los residuos del ensayo.

## Fallos concretos reproducidos antes del cambio

Prueba sintetica directa con el fichero del commit base, sin modelo ni red:

- Clasificacion con `confianza: true`: aceptada como exito, porque `Number(true)` se convertia en 1.
- Valor -5 con esquema `{type:'number', minimum:0}`: validador devolvia cero violaciones porque ignoraba minimum.
- Array `['bad']` con items integer: cero violaciones porque no recorria items.
- Campo extra con additionalProperties false: cero violaciones porque no comprobaba esa restriccion.

Estas son reproducciones del contrato de codigo, no evidencia de que un modelo haya emitido esas salidas en uso real.

## Cambio

La confianza debe ser un numero JSON finito entre 0 y 1. No se convierte desde booleanos, cadenas, null u otros tipos. El umbral configurado tambien se valida como numero finito en ese rango.

El validador reconoce un subconjunto explicito: type (incluidas uniones de tipos), properties, required, enum de valores primitivos, items, additionalProperties booleano y metadatos title/description. Valida realmente items y campos adicionales, usa propiedades propias para required y rechaza enteros no seguros.

No se ignoran keywords desconocidas: minimum, pattern, format, oneOf, $ref, default y otras no implementadas producen `esquema_no_soportado`. Este rechazo conserva el flujo de escalada del router, no ejecuta ninguna herramienta. Las extracciones con esquema no soportado se rechazan ANTES de llamar al proveedor local. Un esquema de extraccion raiz debe declarar type object. No se afirma compatibilidad completa con JSON Schema. Algunos esquemas anteriormente admitidos por validacion parcial ahora escalaran; es intencional.

Limites de recursion y recorrido: profundidad de esquema/valor 24, hasta 512 nodos de esquema, 4096 elementos/propiedades visitadas de valor. Valores o esquemas fuera de limites se rechazan. No son limites de CPU del modelo ni de memoria global de la aplicacion. Los esquemas son objetos de configuracion propios; no se ofrece una frontera para objetos JavaScript hostiles con getters/proxies.

## Verificacion acotada

30 pruebas nuevas de aceptacion y las 24 pruebas RF02 existentes: 54/54 PASS, 0 fallos/skips. Sin ejecutar baterias genericas, medir modelos, descargar recursos, usar cuotas o tocar HOST.

```sh
node --test tests/sector3/rf02_acceptance_failclosed.test.js tests/sector3/rf02_inferencia_especulativa.test.js
```

La correccion de confianza y esquema no prueba verdad semantica. Un modelo aun puede inventar un dato que encaje en un esquema y declararse confiado. Tampoco mejora por si misma la latencia fria medida ni calibra el umbral 0.82. El SLM sigue sin activar; la latencia util y la calidad real siguen pendientes.

## Integracion

Solo se cambia `src/services/localSlmInferenceService.js` y se agregan este documento y el test de regresion. No se cambian contratos de envio, permisos, multitenancy, RAG ni funciones nuevas. Revisar el delta antes de integrar en la rama ERS; no enviar a main ni desplegar por este documento.
