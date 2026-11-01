# Highfield · Continuidad de la hierba y tirones del recorrido

**Objetivo.** Desde la cámara del jugador, el prado debe pasar de matas altas a hierba corta de forma gradual. El camino debe seguir despejado y el arbolado distante debe conservar su separación con el primer plano. En paralelo, hay que reproducir los tirones del recorrido y medir qué trabajo coincide con ellos.

## Punto de partida

En la pose `original-04` (bioma 4, X = −8957, Z = 7737), el mediodía deja ver una franja de tallos cortos con una inclinación muy parecida junto a las matas densas. El atardecer permite comprobar qué borde de cada hoja recibe la luz. El cielo cubierto permite juzgar la silueta sin reflejos fuertes. La rotación de las normales ya está corregida y verificada en GPU. Los 37–44 tirones corresponden a capturas anteriores. Su causa y su frecuencia en esta revisión siguen abiertas. [Historial de iluminación](../lighting-atmosphere.md)

## 1. Fijar una referencia antes de tocar el prado

- Congelar una copia del código, la configuración y los recursos, incluida la corrección de las normales. Anotar la revisión y las diferencias locales. Capturar las tres condiciones a 1600 × 900, con la misma cámara, semilla, calidad y terreno seco. Guardar un recorte del límite entre las matas y los tallos cortos.
- Repetir la vista con viento en calma y recorrer el mismo tramo hacia delante y hacia atrás. Si la franja se desplaza con la cámara, investigar la transición entre niveles de detalle (LOD). Si permanece en el mismo lugar, comparar allí la altura, la inclinación en reposo y la cobertura del terreno. Si aparece solo con viento, aislar el campo de viento.
- Para rendimiento, recuperar los puntos y la duración del recorrido original si existen. En su defecto, guardar una vuelta de Highfield con coordenadas canónicas y usarla como nueva referencia. Reproducirla mediante `ScenicTour.start(points)`. Cronometrar por separado preparación, primera vuelta y repetición. La prueba `qa:exploration` comprueba que el tour funciona y se detiene al comienzo.

## 2. Corregir la causa que se reproduzca

| Señal | Primer cambio a probar | Comprobación |
| --- | --- | --- |
| El escalón de altura permanece en el terreno | Acercar ligeramente la altura corta a la alta en el perfil de pradera, `growth.byTileId.4` de `editor.config.yaml`. Probar una sola variable por captura. | Se distinguen tallos intermedios en el recorte y persisten los claros naturales. Comprobar también otro terreno que use el perfil de reserva. |
| Los tallos siguen paralelos con el viento en calma | Comparar la orientación de cada tallo con la inclinación compartida de su mata. Probar una menor contribución de esa inclinación usando el campo existente de `meadowTuftField.js`. Si se cambia la fórmula, mantener equivalentes `meadowGrowthMath.js` y `meadowTuftNodes.js`. | Hay variación entre matas, los tallos de una misma mata siguen agrupados y el borde iluminado se mantiene estable al atardecer. |
| La franja sigue a la cámara o aparece solo en movimiento | En el primer caso, aislar el relevo entre briznas y tarjetas en la prueba `lod`. En el segundo, comparar dos instantes con igual cámara y revisar la variación espacial del viento en `meadowWindVariation.js`. | Al volver sobre los pasos no aparece un anillo, un salto de cobertura ni una fila de hojas que cambie de dirección a la vez. |

Mantener la densidad, el presupuesto de instancias, las distancias de dibujado y las máscaras de caminos durante las comparaciones. Si el corte coincide con una frontera de hábitat, comprobar primero su máscara con la prueba `grass`. Conservar el primer cambio que resuelva el defecto reproducido.

## 3. Medir y atribuir los tirones

1. Alternar al menos tres pares de ejecuciones de la referencia y la candidata, en la misma GPU WebGPU, con la ventana enfocada, la misma resolución y los mismos recursos. Medir el tour completo sin tomar capturas durante la vuelta cronometrada. Usar `chunk-cross` como control independiente de carga durante el movimiento.
2. Guardar por ejecución el total de fotogramas, p95, p99, máximo y número y porcentaje de fotogramas por encima de 33,3 ms. Alinear los peores fotogramas con la posición en la ruta, las fases de CPU, las subidas de terreno o vegetación y los tiempos de GPU cuando estén disponibles. Revisar también el fotograma precedente, donde puede haber terminado trabajo asíncrono.
3. Si el pico coincide repetidamente con publicación o subida de datos, probar un reparto de ese trabajo y comprobar que las colas se vacían tras detenerse. Si coincide con tiempo de GPU, aislar el material o la pasada implicada y repetir el mismo tramo. Si los picos no se reproducen, guardar la dispersión y dejar la atribución abierta. [Protocolo de rendimiento](../perf-qa.md)

## 4. Aceptación

- **Imagen.** Comparar antes y después en mediodía, atardecer y cubierto seco, además del recorrido de ida y vuelta. Aceptar cuando desaparezca el corte artificial señalado en el recorte, se conserve la lectura del camino y no aparezca un salto al cambiar de LOD.
- **Regresión.** Pasar las pruebas de matas, relevo de LOD, caminos y normales. En la prueba visual de hierba deben pasar los ocho casos de frontera y distancia. Verificar que no crezcan los recuentos de instancias ni las llamadas de dibujo en la pose fija.
- **Rendimiento.** Aplicar el presupuesto del proyecto, p95 ≤ 33,3 ms y ≤ 2 % de fotogramas con tirón, al control y como objetivo para el tour. Comparar también p99 y máximo para detectar un parón aislado que el p95 ocultaría. Conservar los resultados por ejecución. Registrar por separado la aprobación visual y cualquier incidencia de rendimiento pendiente.

### Comandos de comprobación

Desde la raíz, con el servidor de QA sirviendo la copia evaluada. Ejecutar los comandos de navegador en serie. El ejemplo guarda una ejecución de referencia; cambiar la carpeta para cada repetición y para la candidata.

```sh
node --test test/meadow-tufts-and-ground-detail.test.js test/meadow-lod-handoff.test.js test/meadow-path-clearance.test.js test/shader-material-response.test.js
node scripts/run-world-visual-lighting-qa.mjs --highfield --out tmp/highfield-grass/base-01/lighting
node scripts/run-world-visual-grass-qa.mjs --fixture grass --out tmp/highfield-grass/base-01/grass
node scripts/run-world-visual-grass-qa.mjs --fixture lod --out tmp/highfield-grass/base-01/lod
npm run qa:perf -- --headed --qa chunk-cross --warmup 8 --duration 12 --settle --drain-seconds 5 --out tmp/highfield-grass/base-01/chunk-cross.json
```
