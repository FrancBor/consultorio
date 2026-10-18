# Reglas de negocio del modelo de datos

Los KPI se calculan desde hechos, con una única semántica temporal y sin persistir totales. Esta página define qué cuenta, qué se excluye y cómo se informa la ausencia de datos.

## Conceptos canónicos

| Concepto | Definición |
|---|---|
| Solicitud | Evento de demanda recibido en `solicitudes_atencion`, independientemente de si luego se agenda. |
| Cita | Cupo con un instante programado y un estado operativo en `citas`. |
| Agenda resuelta | Cita cuyo estado final es `atendida` o `inasistencia`. |
| Atención realizada | Ejecución de una cita `atendida`, registrada en `atenciones_realizadas`. |
| Espera | Minutos desde `llegada_en` hasta `inicio_atencion_en`, o duración reportada cuando no existe llegada. |
| Unidad | Dimensión opcional de organización. Un hecho sin unidad sigue siendo válido y aparece en el total general. |
| Período | Intervalo local inclusivo de fechas solicitado por la interfaz y convertido a un intervalo semiabierto de instantes. |

La palabra “hora” de la interfaz actual significa **cupo o cita**, no sesenta minutos de duración. El modelo no dispone de duración planificada, por lo que no debe multiplicar ni sumar minutos para estos KPI.

## Estados

### Solicitudes

| Código | Uso |
|---|---|
| `pendiente` | Demanda recibida aún no resuelta. |
| `agendada` | Existe al menos una cita vigente asociada. |
| `cerrada` | El proceso terminó; `cerrada_en` debe estar informado. |
| `cancelada` | La solicitud fue anulada; `cerrada_en` debe estar informado. |

Los cuatro estados cuentan como demanda porque la demanda mide ingresos, no resultados. `cerrada_en` debe ser nulo para `pendiente` y `agendada`, y no nulo para `cerrada` y `cancelada`. La aplicación valida esta relación en la misma transacción.

### Citas

| Código | Uso en indicadores |
|---|---|
| `agendada` | Cita futura o todavía no resuelta; no entra en denominadores de resultado. |
| `confirmada` | Cita confirmada pero todavía no resuelta; no entra en denominadores de resultado. |
| `atendida` | Entra en agenda resuelta, uso de agenda y atenciones realizadas. Debe tener una atención realizada. |
| `inasistencia` | Entra en agenda resuelta y en el numerador de inasistencia. No puede tener atención realizada. |
| `cancelada` | Se excluye de agenda resuelta, uso e inasistencia. No puede tener atención realizada. |

La aplicación debe cambiar el estado de la cita y crear o retirar su atención realizada dentro de una única transacción. No se permite una cita `atendida` sin ejecución ni una ejecución asociada a otro estado.

## Ventana temporal común

Para fechas `desde` y `hasta`, ambas inclusive en calendario institucional, el backend construye:

```text
inicio = desde a las 00:00:00 en America/Santiago
fin_exclusivo = día posterior a hasta a las 00:00:00 en America/Santiago
condición = timestamp >= inicio AND timestamp < fin_exclusivo
```

No se debe fabricar un fin de día `23:59:59.999`. El límite semiabierto funciona incluso en cambios de horario de verano.

- Demanda usa `solicitudes_atencion.solicitada_en`.
- Agenda, inasistencia, atenciones realizadas, espera y detalle usan `citas.inicio_agendado_en`.
- Una atención iniciada fuera del período permanece en el período de su cita.
- Los períodos mensuales se obtienen desde la fecha local de `America/Santiago`, no desde UTC.

## Fórmulas de los cinco KPI

Todas las fórmulas se aplican después del filtro temporal y de cualquier filtro opcional por tipo o unidad.

### 1. Tasa de inasistencia

```text
inasistencias = COUNT(citas WHERE estado_cita_codigo = 'inasistencia')
agenda_resuelta = COUNT(citas WHERE estado_cita_codigo IN ('atendida', 'inasistencia'))
tasa_inasistencia = inasistencias / agenda_resuelta
```

Las citas `agendada`, `confirmada` y `cancelada` no entran en el denominador. La tasa es decimal entre `0` y `1`; la interfaz decide su formato porcentual.

### 2. Atenciones realizadas

```text
atenciones_realizadas = COUNT(atenciones_realizadas
                              JOIN citas ON citas.id = atenciones_realizadas.cita_id
                              WHERE citas.estado_cita_codigo = 'atendida')
```

El período se filtra por `citas.inicio_agendado_en`. Bajo el invariante uno a uno, el resultado coincide con el número de citas `atendida`; contar la tabla de ejecución permite detectar violaciones si el proceso de carga falla.

### 3. Tiempo promedio de espera

Para cada atención:

```text
espera_minutos =
  si llegada_en existe:
    (inicio_atencion_en - llegada_en) expresado en minutos
  si llegada_en no existe y duracion_espera_reportada_minutos existe:
    duracion_espera_reportada_minutos
  en otro caso:
    NULL

promedio_espera = AVG(espera_minutos no nulos)
```

La duración reportada es solo fallback. La restricción impide almacenarla cuando existe `llegada_en`; por lo tanto, nunca se promedian dos medidas para una atención. El promedio total se calcula sobre atenciones individuales, no como promedio simple de promedios mensuales.

### 4. Uso de horas agendadas

```text
agendadas = COUNT(citas WHERE estado_cita_codigo IN ('atendida', 'inasistencia'))
utilizadas = COUNT(citas WHERE estado_cita_codigo = 'atendida')
porcentaje_uso = utilizadas / agendadas
```

`agendadas` representa agenda resuelta. La interfaz puede mostrar ambos conteos y `porcentaje_uso × 100`. Con las categorías actuales, uso e inasistencia son complementarios para la misma población.

### 5. Demanda del período

```text
demanda = COUNT(solicitudes_atencion por solicitada_en)
```

Se cuentan todos los estados. No se usa el número de citas como sustituto: una solicitud puede quedar pendiente, cancelarse o producir más de una cita.

## Series y detalle

- Cada punto mensual repite la fórmula del KPI sobre los hechos del mes local correspondiente.
- Los meses sin hechos deben aparecer con conteos `0`; las tasas o promedios sin denominador se representan como `null`.
- El detalle se obtiene desde `citas` y, cuando corresponde, su `atenciones_realizadas`; muestra fecha y hora local, etiqueta del tipo, estado canónico de la cita y espera calculada solo para estados `atendida`.
- El conteo total y la página solicitada se calculan en una única consulta para compartir el mismo snapshot de PostgreSQL. Una página fuera de rango conserva el total y devuelve una lista vacía.
- Las etiquetas se leen desde catálogos. No se copian a los hechos ni se usan como claves.

## Nulos y ausencia de datos

| Caso | Resultado |
|---|---|
| No hay agenda resuelta | `tasa_inasistencia = null` y `porcentaje_uso = null`; conteos en `0`. |
| Hay atenciones, pero ninguna posee espera calculable o reportada | `promedio_espera = null`. |
| Unidad nula | El hecho participa del total general; aparece como “Sin unidad” al agrupar. |
| Solicitud sin cita | Cuenta en demanda y no cuenta en indicadores de agenda. |
| Cita sin solicitud | Cuenta en agenda según estado y no inventa una solicitud. |
| Atención sin `fin_atencion_en` | Sigue siendo válida; el fin no interviene en los cinco KPI. |

`null` significa “sin medida calculable”, no cero. El backend no debe convertirlo silenciosamente en `0`.

## Invariantes

### Declarativos en PostgreSQL

- PK, FK y claves de origen evitan filas huérfanas y duplicados.
- Los códigos usan minúsculas, números y guiones bajos.
- Los timestamps de cierre, inicio y fin respetan su orden cuando están presentes.
- Una cita tiene como máximo una atención realizada.
- La espera reportada es no negativa y solo se permite sin `llegada_en`.
- Usuario y correo informado son únicos sin distinguir mayúsculas.

### Transaccionales de aplicación

- Los códigos de catálogo no se renombran; se cambia su etiqueta o se desactivan.
- Una cita vinculada conserva el tipo de su solicitud y una unidad compatible.
- `cerrada_en` coincide con el carácter terminal del estado de solicitud.
- Estado `atendida` y atención realizada se crean o modifican juntos.
- En `carga_manual_v1`, una clave repetida se omite si coincide o actualiza solicitud, cita y atención juntas si difiere.
- La importación confirma el lote y todos sus hechos juntos o no confirma ninguno.
- `actualizado_en` se mantiene en cada modificación administrativa o de hechos; registrar `usuarios.ultimo_acceso_en` no lo modifica.
- `usuarios.auth_version` aumenta únicamente al cambiar contraseña, rol o estado; los cambios de nombre o correo no invalidan sesiones.

## Privacidad y minimización

El modelo no necesita ni admite datos de identificación o contenido clínico de personas atendidas. En particular, los archivos de importación no deben incluir nombres, documentos, domicilio, teléfono, correo, previsión, diagnósticos, tratamientos ni observaciones clínicas.

`usuarios` contiene solo datos necesarios para cuentas internas: identificador de acceso, nombre de visualización, correo opcional, hash de contraseña y rol. Los hashes nunca se exportan ni se aceptan en el contrato de hechos.

## Referencia histórica de los mocks

`src/api/mockData.js` conserva el prototipo visual y no se importa en ejecución. La semilla sintética canónica de desarrollo toma únicamente las cuotas coherentes de agenda, atenciones y espera:

1. Demanda mensual y horas agendadas tienen exactamente los mismos valores, por lo que no demuestran una demanda independiente de la agenda.
2. Las series suman `1840` citas y `1527` utilizadas. Sus diferencias mensuales producen tasas aproximadas de `24,26 %`, `24,83 %`, `20,51 %`, `13,07 %`, `11,43 %` y `8,22 %`, no las tasas publicadas de `19 %`, `21 %`, `18 %`, `15 %`, `14 %` y `17 %`.
3. El resumen de espera `23,4` es el promedio simple de seis promedios mensuales. Ponderado por las atenciones mensuales publicadas da aproximadamente `23,06` minutos; ninguno puede validarse sin hechos individuales completos.
4. El detalle histórico solo contiene seis filas de muestra y no representa exhaustivamente los 1.840 hechos. El filtro inicial vigente de `Dashboard.jsx` cubre todo abril-septiembre de 2026.
5. La API real aplica los filtros y calcula todos los resultados desde hechos PostgreSQL.

Por estas razones, la semilla genera 1.840 solicitudes y citas, 1.527 atenciones y 313 inasistencias. Las tasas mensuales resultan de las diferencias reales entre cuotas, y el promedio global de espera se pondera sobre las 1.527 atenciones individuales (redondeado a `23,1` minutos), no como promedio simple de meses.
