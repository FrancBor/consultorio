# Contrato de importación manual v1.0

La importación manual acepta un archivo CSV o JSON UTF-8 con filas que representan una solicitud, su cita y, cuando la cita fue atendida, su atención. El archivo completo se valida y se confirma en una sola transacción: cualquier error revierte el lote completo.

## Límites y formato

| Propiedad | Regla |
|---|---|
| Fuente interna | `carga_manual_v1`; no se recibe desde el archivo. |
| Formatos | `.csv` con MIME CSV o `.json` con MIME JSON. |
| Codificación | UTF-8 válido; se permite BOM inicial. |
| Tamaño | Máximo 5 MiB. |
| Registros | Entre 1 y 50.000. |
| Zona institucional | `America/Santiago`. |
| Timestamps | ISO 8601/RFC 3339 con `Z` u offset explícito y hasta 3 dígitos de fracción de segundo. |
| Privacidad | No admite campos adicionales, datos personales ni contenido clínico. |

JSON usa un arreglo raíz de objetos. CSV usa coma, reglas RFC 4180 y el encabezado exacto indicado abajo. No se aceptan columnas desconocidas, filas vacías ni documentos comprimidos.

## Campos por registro

| Campo | Requerido | Regla |
|---|---:|---|
| `clave_origen` | Sí | 1–200 caracteres: letras, números, punto, guion, guion bajo o dos puntos. Identifica la misma solicitud, cita y eventual atención. |
| `tipo_atencion_codigo` | Sí | Código activo de `tipos_atencion`; se normaliza a minúsculas. |
| `estado_solicitud_codigo` | Sí | Código activo de `estados_solicitud`. |
| `unidad_codigo` | No | Código activo de `unidades_organizacionales`. |
| `solicitada_en` | Sí | Timestamp con offset. |
| `cerrada_en` | Condicional | Obligatorio para solicitud `cerrada` o `cancelada`; nulo para otros estados; no puede preceder a `solicitada_en`. |
| `estado_cita_codigo` | Sí | Código activo de `estados_cita`. |
| `inicio_agendado_en` | Sí | Timestamp con offset. |
| `llegada_en` | No | Solo para cita `atendida`; no puede ser posterior al inicio real. |
| `inicio_atencion_en` | Condicional | Obligatorio para cita `atendida`; nulo para otros estados. |
| `fin_atencion_en` | No | Solo para cita `atendida`; no puede preceder al inicio real. |
| `duracion_espera_reportada_minutos` | No | Entero de 0 a 1.440, solo para cita `atendida` sin `llegada_en`. |

La clave no puede repetirse dentro del mismo archivo. Solicitud y cita comparten tipo de atención y unidad por construcción. Una cita no atendida no admite ningún dato de atención.

## CSV

El encabezado debe respetar exactamente este orden:

```csv
clave_origen,tipo_atencion_codigo,estado_solicitud_codigo,unidad_codigo,solicitada_en,cerrada_en,estado_cita_codigo,inicio_agendado_en,llegada_en,inicio_atencion_en,fin_atencion_en,duracion_espera_reportada_minutos
```

Ejemplo sin datos personales:

```csv
clave_origen,tipo_atencion_codigo,estado_solicitud_codigo,unidad_codigo,solicitada_en,cerrada_en,estado_cita_codigo,inicio_agendado_en,llegada_en,inicio_atencion_en,fin_atencion_en,duracion_espera_reportada_minutos
manual-0001,medicina_general,cerrada,,2026-10-01T09:00:00-03:00,2026-10-02T10:30:00-03:00,atendida,2026-10-02T10:00:00-03:00,2026-10-02T09:50:00-03:00,2026-10-02T10:05:00-03:00,2026-10-02T10:30:00-03:00,
```

Una cadena vacía representa `null` únicamente en campos opcionales.

## JSON

JSON usa los mismos nombres y reglas. Los campos opcionales pueden omitirse o usar `null`.

```json
[
  {
    "clave_origen": "manual-0001",
    "tipo_atencion_codigo": "medicina_general",
    "estado_solicitud_codigo": "cerrada",
    "solicitada_en": "2026-10-01T09:00:00-03:00",
    "cerrada_en": "2026-10-02T10:30:00-03:00",
    "estado_cita_codigo": "atendida",
    "inicio_agendado_en": "2026-10-02T10:00:00-03:00",
    "llegada_en": "2026-10-02T09:50:00-03:00",
    "inicio_atencion_en": "2026-10-02T10:05:00-03:00",
    "fin_atencion_en": "2026-10-02T10:30:00-03:00"
  }
]
```

## Resultado, actualización e idempotencia

El backend calcula SHA-256 sobre los bytes recibidos y no confía en identificadores de lote declarados por el archivo.

1. Un hash ya confirmado para `carga_manual_v1` devuelve el resultado original y no ejecuta escrituras.
2. Una clave nueva inserta solicitud, cita y atención opcional y aumenta `cantidad_insertados`.
3. Una clave existente con contenido normalizado idéntico no modifica sus hechos y aumenta `cantidad_omitidos`.
4. Una clave existente con contenido distinto reemplaza atómicamente sus valores operativos y aumenta `cantidad_actualizados`.
5. La serialización mediante bloqueo transaccional y el índice único por fuente/hash impiden lotes duplicados bajo concurrencia.

Cada lote cumple:

```text
cantidad_insertados + cantidad_actualizados + cantidad_omitidos = cantidad_registros
```

El historial solo contiene lotes confirmados y registra formato, nombre original seguro, cantidades, usuario e instante de importación.

## Errores

Los errores de contenido usan estado HTTP `422` y pueden incluir hasta 100 elementos seguros:

```json
{
  "codigo": "catalogo_no_encontrado",
  "registro": 3,
  "campo": "tipo_atencion_codigo",
  "mensaje": "El código no existe o no está activo."
}
```

`errores_truncados` indica que existen más errores. Las respuestas nunca incluyen contenido completo del archivo, SQL, trazas, rutas locales ni secretos.
