# Modelo de datos canónico del dashboard CESFAM

El dashboard debe calcular sus cinco indicadores desde hechos normalizados en PostgreSQL 17: solicitudes para demanda, citas para agenda e inasistencia, y atenciones realizadas para ejecución y espera. No se persisten agregados KPI ni datos personales o clínicos de las personas atendidas.

## Ruta rápida de lectura

1. Revise las entidades y decisiones principales en esta página.
2. Consulte cada columna, restricción e índice en el [diccionario de datos](./data-dictionary.md).
3. Valide fórmulas, estados y semántica temporal en las [reglas de negocio](./business-rules.md).
4. Prepare cargas conforme al [contrato de importación](./import-contract.md).
5. Use las [migraciones del servidor](../../server/db/README.md) para crear el esquema en una base PostgreSQL 17 vacía; el [snapshot SQL](../schema.sql) queda como referencia equivalente para ejecución manual.

## Mapa conceptual

```text
roles_usuario ──< usuarios
                       │
                       └──< lotes_importacion
                                  │
                                  ├──< solicitudes_atencion ──< citas ──0..1 atenciones_realizadas
                                  ├──< citas
                                  └──< atenciones_realizadas

tipos_atencion ──< solicitudes_atencion
                 └──< citas

estados_solicitud ──< solicitudes_atencion
estados_cita ────────< citas
unidades_organizacionales ──< solicitudes_atencion (opcional)
                           └──< citas (opcional)

sesiones_http (infraestructura HTTP efímera; fuera del modelo de hechos)
```

| Hecho | Pregunta que responde | Tiempo del indicador |
|---|---|---|
| `solicitudes_atencion` | ¿Cuánta demanda ingresó? | `solicitada_en` |
| `citas` | ¿Cuántos cupos se resolvieron y cuántos terminaron en inasistencia? | `inicio_agendado_en` |
| `atenciones_realizadas` | ¿Qué citas fueron ejecutadas y cuánto se esperó? | Período de la cita asociada |

## Decisiones principales

| Tema | Decisión |
|---|---|
| Motor | Solo PostgreSQL 17. El snapshot ya no contiene una variante SQLite. |
| Fuente ejecutable del esquema | Las migraciones versionadas en `server/db/migrations/`; `docs/schema.sql` es el snapshot de referencia equivalente. |
| Fuente de verdad | Los hechos individuales son canónicos. Los resúmenes y series se calculan al consultar. |
| Separación de procesos | Una solicitud puede no llegar a cita; una cita puede existir sin solicitud importada; una cita atendida tiene una atención realizada. |
| Tiempo | Todos los instantes usan `TIMESTAMPTZ`. La zona institucional para filtros, agrupaciones y presentación es `America/Santiago`. |
| Espera | Se calcula como inicio de atención menos llegada. Si falta la llegada, puede usarse una duración reportada; ambos métodos nunca coexisten. |
| Idempotencia | Lotes y hechos tienen claves únicas compuestas por `sistema_origen` y `clave_origen`. |
| Catálogos | Los códigos son estables, sin tildes y en `snake_case`; las etiquetas visibles pueden editarse. |
| Unidad | `unidades_organizacionales` permite filtrar por área, servicio, sector o box, pero sus referencias son opcionales. |
| Usuarios | El identificador de acceso es único sin distinguir mayúsculas. El correo es opcional. |
| Sesión HTTP | `sesiones_http` pertenece a la infraestructura de autenticación. No es un hecho de negocio y su contenido expira. |
| Privacidad | No se almacenan nombres, documentos, contactos, diagnósticos ni otras variables de personas atendidas. |

## Alcance

El modelo cubre:

- autenticación básica por usuario y rol;
- trazabilidad de cargas CSV/JSON exitosas;
- demanda, agenda, inasistencia, atenciones realizadas, espera y detalle operativo;
- filtros por período, tipo de atención y unidad cuando esté informada;
- catálogos iniciales mínimos coherentes con la interfaz actual.

## Fuera de alcance

- ficha clínica, identificación o contacto de personas atendidas;
- profesionales, prestaciones clínicas, diagnósticos y tratamientos;
- disponibilidad futura, turnos, recursos físicos o duración contractual de cupos;
- agregados materializados, metas, alertas y umbrales del dashboard;
- historial de transiciones de estado y auditoría detallada de cambios;
- backend de importación CSV/JSON.

Los datos de `src/api/mockData.js` son una referencia histórica y no forman parte del runtime. La semilla de desarrollo genera hechos coherentes a partir de sus cuotas de agenda, atenciones y espera; los indicadores siempre se derivan desde PostgreSQL. Consulte [Referencia histórica de los mocks](./business-rules.md#referencia-histórica-de-los-mocks).

## Verificación de implementación futura

- El backend debe consultar hechos y no guardar totales mensuales.
- Toda importación debe respetar la transacción all-or-nothing.
- Las reglas transaccionales indicadas en el SQL y en las reglas de negocio deben aplicarse dentro de la misma transacción que modifica los hechos.
- Los filtros de fecha deben convertirse a límites de instante usando `America/Santiago` antes de consultar.
