# Diccionario de datos

Este diccionario describe el snapshot PostgreSQL 17 de [`docs/schema.sql`](../schema.sql). `PK` identifica clave primaria, `FK` clave foránea y `UQ` unicidad. Todas las fechas operativas son `TIMESTAMPTZ`.

## Catálogos y seguridad

### `roles_usuario`

Catálogo de niveles de acceso. Los códigos son estables y las etiquetas visibles son modificables.

| Columna | Tipo | Nulo | Clave | Significado y restricciones |
|---|---|---:|---|---|
| `codigo` | `VARCHAR(50)` | No | PK | Código estable en minúsculas, números y guiones bajos. |
| `etiqueta` | `VARCHAR(100)` | No | — | Nombre visible no vacío. |
| `descripcion` | `TEXT` | Sí | — | Alcance legible del rol. |
| `activo` | `BOOLEAN` | No | — | Vigencia para nuevas asignaciones; por defecto `TRUE`. |

**Índices:** índice único de PK sobre `codigo`.

### `usuarios`

Cuentas que acceden al sistema. No representa personas atendidas.

| Columna | Tipo | Nulo | Clave | Significado y restricciones |
|---|---|---:|---|---|
| `id` | `BIGINT IDENTITY` | No | PK | Identificador interno. |
| `rol_codigo` | `VARCHAR(50)` | No | FK | Referencia `roles_usuario.codigo`; actualización y eliminación restringidas. |
| `usuario` | `VARCHAR(100)` | No | UQ funcional | Identificador de acceso no vacío. La unicidad se evalúa con `lower(usuario)`. |
| `nombre_mostrar` | `VARCHAR(150)` | No | — | Nombre operativo visible de la cuenta, no vacío. |
| `correo` | `VARCHAR(254)` | Sí | UQ parcial | Correo de la cuenta. Si existe, no puede ser vacío ni repetirse ignorando mayúsculas. |
| `password_hash` | `VARCHAR(255)` | No | — | Hash de contraseña no vacío; nunca guarda la contraseña. |
| `auth_version` | `BIGINT` | No | — | Versión positiva y monotónica de autenticación; comienza en `1` y aumenta al cambiar contraseña, rol o estado. |
| `activo` | `BOOLEAN` | No | — | Habilitación de acceso; por defecto `TRUE`. |
| `ultimo_acceso_en` | `TIMESTAMPTZ` | Sí | — | Último acceso exitoso conocido. |
| `creado_en` | `TIMESTAMPTZ` | No | — | Creación de la cuenta; por defecto el instante actual. |
| `actualizado_en` | `TIMESTAMPTZ` | No | — | Última modificación administrativa de la cuenta; no puede preceder a `creado_en`. Registrar `ultimo_acceso_en` no cambia este valor. |

**Índices:** PK en `id`; `uq_usuarios_usuario_lower` único sobre `lower(usuario)`; `uq_usuarios_correo_lower` único parcial sobre `lower(correo)`; `idx_usuarios_rol_codigo`; `idx_usuarios_activos` parcial.

### `sesiones_http`

Almacenamiento efímero de sesiones HTTP compatible con `connect-pg-simple`. Es infraestructura técnica: no representa usuarios, accesos auditables ni hechos de negocio, y no participa en los KPI.

| Columna | Tipo | Nulo | Clave | Significado y restricciones |
|---|---|---:|---|---|
| `sid` | `VARCHAR` | No | PK | Identificador opaco de sesión generado por `express-session`. |
| `sess` | `JSON` | No | — | Estado mínimo de la sesión del servidor. |
| `expire` | `TIMESTAMP(6)` | No | — | Vencimiento usado para rechazar y depurar sesiones expiradas. |

**Índices:** PK en `sid`; `idx_sesiones_http_expire` sobre `expire` para la depuración periódica. La fuente ejecutable de esta estructura es `server/db/migrations/002_http_sessions.up.sql`.

La aplicación actual guarda `userId` y `authVersion` como propiedades superiores de `sess`. La desactivación de cuentas, los cambios de rol y el restablecimiento de contraseñas usan `userId` para revocar sesiones mediante una consulta parametrizada y aumentan `usuarios.auth_version`. Una sesión heredada sin `userId` no puede atribuirse con seguridad y no se elimina mediante este mecanismo; una sesión sin `authVersion`, o con una versión anterior, tampoco satisface la autenticación vigente.

### `tipos_atencion`

Catálogo de categorías operativas de atención.

| Columna | Tipo | Nulo | Clave | Significado y restricciones |
|---|---|---:|---|---|
| `codigo` | `VARCHAR(50)` | No | PK | Código estable en minúsculas, números y guiones bajos. |
| `etiqueta` | `VARCHAR(100)` | No | — | Etiqueta visible no vacía. |
| `descripcion` | `TEXT` | Sí | — | Explicación funcional opcional. |
| `activo` | `BOOLEAN` | No | — | Vigencia para nuevos hechos; por defecto `TRUE`. |

**Índices:** índice único de PK sobre `codigo`.

Valores iniciales: `medicina_general`, `control_cronico`, `control_salud`, `enfermeria` y `odontologia`.

### `estados_solicitud`

Catálogo del ciclo de vida de una solicitud de atención.

| Columna | Tipo | Nulo | Clave | Significado y restricciones |
|---|---|---:|---|---|
| `codigo` | `VARCHAR(50)` | No | PK | Código estable en minúsculas, números y guiones bajos. |
| `etiqueta` | `VARCHAR(100)` | No | — | Etiqueta visible no vacía. |
| `descripcion` | `TEXT` | Sí | — | Semántica del estado. |
| `activo` | `BOOLEAN` | No | — | Vigencia para nuevos hechos; por defecto `TRUE`. |

**Índices:** índice único de PK sobre `codigo`.

Valores iniciales: `pendiente`, `agendada`, `cerrada` y `cancelada`.

### `estados_cita`

Catálogo del resultado operativo de una cita.

| Columna | Tipo | Nulo | Clave | Significado y restricciones |
|---|---|---:|---|---|
| `codigo` | `VARCHAR(50)` | No | PK | Código estable en minúsculas, números y guiones bajos. |
| `etiqueta` | `VARCHAR(100)` | No | — | Etiqueta visible no vacía. |
| `descripcion` | `TEXT` | Sí | — | Semántica del estado. |
| `activo` | `BOOLEAN` | No | — | Vigencia para nuevos hechos; por defecto `TRUE`. |

**Índices:** índice único de PK sobre `codigo`.

Valores iniciales: `agendada`, `confirmada`, `atendida`, `inasistencia` y `cancelada`.

### `unidades_organizacionales`

Dimensión opcional para áreas, servicios, sectores o boxes. No se exige para importar hechos.

| Columna | Tipo | Nulo | Clave | Significado y restricciones |
|---|---|---:|---|---|
| `id` | `BIGINT IDENTITY` | No | PK | Identificador interno. |
| `codigo` | `VARCHAR(50)` | No | UQ | Código estable en minúsculas, números y guiones bajos. |
| `etiqueta` | `VARCHAR(120)` | No | — | Nombre visible no vacío. |
| `descripcion` | `TEXT` | Sí | — | Descripción funcional opcional. |
| `activo` | `BOOLEAN` | No | — | Vigencia para nuevas asociaciones; por defecto `TRUE`. |

**Índices:** PK en `id`; índice único de la restricción `uq_unidades_organizacionales_codigo` sobre `codigo`.

## Trazabilidad de importación

### `lotes_importacion`

Registra únicamente cargas confirmadas. Si una carga falla, la fila se revierte junto con todos sus hechos.

| Columna | Tipo | Nulo | Clave | Significado y restricciones |
|---|---|---:|---|---|
| `id` | `BIGINT IDENTITY` | No | PK | Identificador interno del lote. |
| `sistema_origen` | `VARCHAR(100)` | No | UQ compuesta | Sistema que asignó la clave; no vacío. |
| `clave_origen` | `VARCHAR(200)` | No | UQ compuesta | Identificador idempotente del lote; no vacío. |
| `version_contrato` | `VARCHAR(20)` | No | — | Versión del contrato; este snapshot acepta `1.0`. |
| `formato` | `VARCHAR(10)` | No | — | `csv` o `json`. |
| `nombre_archivo` | `VARCHAR(255)` | No | — | Nombre original no vacío, sin ruta local. |
| `hash_contenido_sha256` | `VARCHAR(64)` | No | — | SHA-256 en hexadecimal minúsculo de los bytes recibidos. |
| `cantidad_registros` | `INTEGER` | No | — | Filas o elementos válidos del documento; mayor o igual que cero. |
| `cantidad_insertados` | `INTEGER` | No | — | Registros de entrada cuya clave era nueva; mayor o igual que cero. |
| `cantidad_actualizados` | `INTEGER` | No | — | Registros existentes cuyo contenido operativo cambió; por defecto cero. |
| `cantidad_omitidos` | `INTEGER` | No | — | Registros idénticos ya existentes; por defecto cero. |
| `importado_por_usuario_id` | `BIGINT` | Sí | FK | Cuenta que inició la carga; referencia `usuarios.id` y queda nula si se elimina la cuenta. |
| `importado_en` | `TIMESTAMPTZ` | No | — | Confirmación del lote; por defecto el instante actual. |

`cantidad_insertados + cantidad_actualizados + cantidad_omitidos` debe ser igual a `cantidad_registros`. La pareja (`sistema_origen`, `clave_origen`) y la pareja (`sistema_origen`, `hash_contenido_sha256`) son únicas.

**Índices:** PK en `id`; índices únicos `uq_lotes_importacion_origen` y `uq_lotes_importacion_fuente_hash`; `idx_lotes_importacion_usuario` parcial; `idx_lotes_importacion_fecha`.

## Hechos

### `solicitudes_atencion`

Una fila representa demanda recibida, aunque nunca origine una cita.

| Columna | Tipo | Nulo | Clave | Significado y restricciones |
|---|---|---:|---|---|
| `id` | `BIGINT IDENTITY` | No | PK | Identificador interno. |
| `lote_importacion_id` | `BIGINT` | No | FK | Lote que incorporó el hecho; referencia `lotes_importacion.id`. |
| `sistema_origen` | `VARCHAR(100)` | No | UQ compuesta | Sistema dueño de la clave; no vacío. |
| `clave_origen` | `VARCHAR(200)` | No | UQ compuesta | Identificador idempotente de la solicitud; no vacío. |
| `tipo_atencion_codigo` | `VARCHAR(50)` | No | FK | Referencia `tipos_atencion.codigo`. |
| `estado_solicitud_codigo` | `VARCHAR(50)` | No | FK | Referencia `estados_solicitud.codigo`; por defecto `pendiente`. |
| `unidad_organizacional_id` | `BIGINT` | Sí | FK | Unidad opcional; referencia `unidades_organizacionales.id`. |
| `solicitada_en` | `TIMESTAMPTZ` | No | — | Instante que determina el KPI de demanda. |
| `cerrada_en` | `TIMESTAMPTZ` | Sí | — | Cierre de la solicitud; no puede preceder a `solicitada_en`. |
| `creado_en` | `TIMESTAMPTZ` | No | — | Inserción en esta base; por defecto el instante actual. |
| `actualizado_en` | `TIMESTAMPTZ` | No | — | Última modificación; no puede preceder a `creado_en`. |

La pareja (`sistema_origen`, `clave_origen`) es única. Todas las FK restringen actualización y eliminación.

**Índices:** PK en `id`; índice único de `uq_solicitudes_atencion_origen`; `idx_solicitudes_atencion_lote`; `idx_solicitudes_atencion_solicitada_en`; índices compuestos por estado/período y tipo/período; índice parcial por unidad/período.

### `citas`

Una fila representa una hora o cupo agendado. El vínculo con una solicitud es opcional para admitir fuentes históricas incompletas sin inventar demanda.

| Columna | Tipo | Nulo | Clave | Significado y restricciones |
|---|---|---:|---|---|
| `id` | `BIGINT IDENTITY` | No | PK | Identificador interno. |
| `lote_importacion_id` | `BIGINT` | No | FK | Lote que incorporó el hecho; referencia `lotes_importacion.id`. |
| `sistema_origen` | `VARCHAR(100)` | No | UQ compuesta | Sistema dueño de la clave; no vacío. |
| `clave_origen` | `VARCHAR(200)` | No | UQ compuesta | Identificador idempotente de la cita; no vacío. |
| `solicitud_atencion_id` | `BIGINT` | Sí | FK | Solicitud que originó la cita, si se conoce. |
| `tipo_atencion_codigo` | `VARCHAR(50)` | No | FK | Referencia `tipos_atencion.codigo`. |
| `estado_cita_codigo` | `VARCHAR(50)` | No | FK | Referencia `estados_cita.codigo`; por defecto `agendada`. |
| `unidad_organizacional_id` | `BIGINT` | Sí | FK | Unidad opcional; referencia `unidades_organizacionales.id`. |
| `inicio_agendado_en` | `TIMESTAMPTZ` | No | — | Instante de agenda usado por inasistencia, uso, atenciones y detalle. |
| `creado_en` | `TIMESTAMPTZ` | No | — | Inserción en esta base; por defecto el instante actual. |
| `actualizado_en` | `TIMESTAMPTZ` | No | — | Última modificación; no puede preceder a `creado_en`. |

La pareja (`sistema_origen`, `clave_origen`) es única. Todas las FK restringen actualización y eliminación.

**Índices:** PK en `id`; índice único de `uq_citas_origen`; `idx_citas_lote`; `idx_citas_solicitud` parcial; `idx_citas_inicio_agendado_en`; índices compuestos por estado/período y tipo/período; índice parcial por unidad/período.

### `atenciones_realizadas`

Registra la ejecución operativa de una cita sin información clínica. Cada cita puede tener como máximo una fila.

| Columna | Tipo | Nulo | Clave | Significado y restricciones |
|---|---|---:|---|---|
| `id` | `BIGINT IDENTITY` | No | PK | Identificador interno. |
| `lote_importacion_id` | `BIGINT` | No | FK | Lote que incorporó el hecho; referencia `lotes_importacion.id`. |
| `sistema_origen` | `VARCHAR(100)` | No | UQ compuesta | Sistema dueño de la clave; no vacío. |
| `clave_origen` | `VARCHAR(200)` | No | UQ compuesta | Identificador idempotente de la atención; no vacío. |
| `cita_id` | `BIGINT` | No | FK y UQ | Cita ejecutada; referencia única a `citas.id`. |
| `llegada_en` | `TIMESTAMPTZ` | Sí | — | Llegada usada para calcular espera. Si existe, no se permite duración reportada. |
| `inicio_atencion_en` | `TIMESTAMPTZ` | No | — | Inicio real; no puede preceder a `llegada_en`. |
| `fin_atencion_en` | `TIMESTAMPTZ` | Sí | — | Fin real opcional; no puede preceder al inicio. |
| `duracion_espera_reportada_minutos` | `INTEGER` | Sí | — | Fallback no negativo, permitido solo si `llegada_en` es nula. |
| `creado_en` | `TIMESTAMPTZ` | No | — | Inserción en esta base; por defecto el instante actual. |

La pareja (`sistema_origen`, `clave_origen`) es única. `cita_id` también es único.

**Índices:** PK en `id`; índices únicos de `uq_atenciones_realizadas_origen` y `uq_atenciones_realizadas_cita`; `idx_atenciones_realizadas_lote`; `idx_atenciones_realizadas_inicio`.

## Reglas que requieren transacción de aplicación

Las siguientes reglas cruzan tablas o comparan el contenido previo y no quedan completamente garantizadas por un `CHECK`:

1. Los códigos de catálogo son inmutables.
2. Cita y solicitud vinculadas conservan el mismo tipo de atención y una unidad compatible.
3. Una cita `atendida` tiene exactamente una atención realizada; otros estados no tienen ninguna.
4. `cerrada_en` se usa solo con estados terminales de solicitud.
5. En la fuente manual, una clave repetida se omite si el contenido normalizado coincide y se actualiza atómicamente si difiere; otras fuentes conservan sus reglas específicas.
6. `actualizado_en` se cambia junto con cada actualización.
