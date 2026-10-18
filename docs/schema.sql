-- ============================================================================
-- Gestión Inteligente CESFAM
-- Snapshot de referencia del modelo de datos para PostgreSQL 17
--
-- Fuente ejecutable: server/db/migrations/*.up.sql.
-- Este snapshot se mantiene equivalente para lectura y creación manual.
-- Zona horaria institucional: America/Santiago.
-- Los TIMESTAMPTZ conservan instantes absolutos; la zona institucional se usa
-- para interpretar filtros, agrupar períodos y presentar fechas locales.
-- Este archivo crea objetos en una base vacía, controla su propia transacción
-- y no ejecuta operaciones DROP. No debe usarse mediante node-pg-migrate.
-- ============================================================================

BEGIN;

SET TIME ZONE 'America/Santiago';

-- Catálogos: los códigos son identificadores estables y no deben renombrarse.
-- Las etiquetas y descripciones sí pueden cambiar sin alterar las relaciones.

CREATE TABLE roles_usuario (
    codigo          VARCHAR(50) PRIMARY KEY,
    etiqueta        VARCHAR(100) NOT NULL,
    descripcion     TEXT,
    activo          BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT chk_roles_usuario_codigo_formato
        CHECK (codigo ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
    CONSTRAINT chk_roles_usuario_etiqueta_no_vacia
        CHECK (btrim(etiqueta) <> '')
);

CREATE TABLE usuarios (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rol_codigo          VARCHAR(50) NOT NULL,
    usuario             VARCHAR(100) NOT NULL,
    nombre_mostrar      VARCHAR(150) NOT NULL,
    correo              VARCHAR(254),
    password_hash       VARCHAR(255) NOT NULL,
    auth_version        BIGINT NOT NULL DEFAULT 1,
    activo              BOOLEAN NOT NULL DEFAULT TRUE,
    ultimo_acceso_en    TIMESTAMPTZ,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_usuarios_rol
        FOREIGN KEY (rol_codigo) REFERENCES roles_usuario (codigo)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_usuarios_usuario_no_vacio
        CHECK (btrim(usuario) <> ''),
    CONSTRAINT chk_usuarios_nombre_no_vacio
        CHECK (btrim(nombre_mostrar) <> ''),
    CONSTRAINT chk_usuarios_correo_no_vacio
        CHECK (correo IS NULL OR btrim(correo) <> ''),
    CONSTRAINT chk_usuarios_password_hash_no_vacio
        CHECK (btrim(password_hash) <> ''),
    CONSTRAINT chk_usuarios_auth_version_positivo
        CHECK (auth_version > 0),
    CONSTRAINT chk_usuarios_actualizacion
        CHECK (actualizado_en >= creado_en)
);

-- La autenticación por usuario es case-insensitive.
CREATE UNIQUE INDEX uq_usuarios_usuario_lower
    ON usuarios (lower(usuario));

-- El correo es opcional, pero no puede repetirse ignorando mayúsculas cuando existe.
CREATE UNIQUE INDEX uq_usuarios_correo_lower
    ON usuarios (lower(correo))
    WHERE correo IS NOT NULL;

CREATE INDEX idx_usuarios_rol_codigo ON usuarios (rol_codigo);
CREATE INDEX idx_usuarios_activos ON usuarios (id) WHERE activo = TRUE;

-- Infraestructura efímera requerida por connect-pg-simple. Esta tabla no es un
-- hecho de negocio ni participa en indicadores, importaciones o auditoría.
CREATE TABLE sesiones_http (
    sid         VARCHAR NOT NULL,
    sess        JSON NOT NULL,
    expire      TIMESTAMP(6) NOT NULL,

    CONSTRAINT sesiones_http_pkey PRIMARY KEY (sid)
);

CREATE INDEX idx_sesiones_http_expire ON sesiones_http (expire);

COMMENT ON TABLE sesiones_http IS
    'Infraestructura efímera de sesiones HTTP; no representa un hecho de negocio.';

CREATE TABLE tipos_atencion (
    codigo          VARCHAR(50) PRIMARY KEY,
    etiqueta        VARCHAR(100) NOT NULL,
    descripcion     TEXT,
    activo          BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT chk_tipos_atencion_codigo_formato
        CHECK (codigo ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
    CONSTRAINT chk_tipos_atencion_etiqueta_no_vacia
        CHECK (btrim(etiqueta) <> '')
);

CREATE TABLE estados_solicitud (
    codigo          VARCHAR(50) PRIMARY KEY,
    etiqueta        VARCHAR(100) NOT NULL,
    descripcion     TEXT,
    activo          BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT chk_estados_solicitud_codigo_formato
        CHECK (codigo ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
    CONSTRAINT chk_estados_solicitud_etiqueta_no_vacia
        CHECK (btrim(etiqueta) <> '')
);

CREATE TABLE estados_cita (
    codigo          VARCHAR(50) PRIMARY KEY,
    etiqueta        VARCHAR(100) NOT NULL,
    descripcion     TEXT,
    activo          BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT chk_estados_cita_codigo_formato
        CHECK (codigo ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
    CONSTRAINT chk_estados_cita_etiqueta_no_vacia
        CHECK (btrim(etiqueta) <> '')
);

-- Dimensión opcional para áreas, servicios, sectores o boxes.
CREATE TABLE unidades_organizacionales (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo          VARCHAR(50) NOT NULL,
    etiqueta        VARCHAR(120) NOT NULL,
    descripcion     TEXT,
    activo          BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT uq_unidades_organizacionales_codigo UNIQUE (codigo),
    CONSTRAINT chk_unidades_organizacionales_codigo_formato
        CHECK (codigo ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
    CONSTRAINT chk_unidades_organizacionales_etiqueta_no_vacia
        CHECK (btrim(etiqueta) <> '')
);

-- Cada lote identifica una carga exitosa. Una carga fallida se revierte completa,
-- incluido su lote, por lo que esta tabla solo contiene cargas confirmadas.
CREATE TABLE lotes_importacion (
    id                          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sistema_origen              VARCHAR(100) NOT NULL,
    clave_origen                VARCHAR(200) NOT NULL,
    version_contrato            VARCHAR(20) NOT NULL,
    formato                     VARCHAR(10) NOT NULL,
    nombre_archivo              VARCHAR(255) NOT NULL,
    hash_contenido_sha256       VARCHAR(64) NOT NULL,
    cantidad_registros          INTEGER NOT NULL,
    cantidad_insertados         INTEGER NOT NULL,
    cantidad_actualizados       INTEGER NOT NULL DEFAULT 0,
    cantidad_omitidos           INTEGER NOT NULL DEFAULT 0,
    importado_por_usuario_id    BIGINT,
    importado_en                TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_lotes_importacion_origen
        UNIQUE (sistema_origen, clave_origen),
    CONSTRAINT fk_lotes_importacion_usuario
        FOREIGN KEY (importado_por_usuario_id) REFERENCES usuarios (id)
        ON UPDATE RESTRICT ON DELETE SET NULL,
    CONSTRAINT chk_lotes_importacion_sistema_no_vacio
        CHECK (btrim(sistema_origen) <> ''),
    CONSTRAINT chk_lotes_importacion_clave_no_vacia
        CHECK (btrim(clave_origen) <> ''),
    CONSTRAINT chk_lotes_importacion_version
        CHECK (version_contrato = '1.0'),
    CONSTRAINT chk_lotes_importacion_formato
        CHECK (formato IN ('csv', 'json')),
    CONSTRAINT chk_lotes_importacion_archivo_no_vacio
        CHECK (btrim(nombre_archivo) <> ''),
    CONSTRAINT chk_lotes_importacion_hash_sha256
        CHECK (hash_contenido_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT chk_lotes_importacion_cantidades
        CHECK (
            cantidad_registros >= 0
            AND cantidad_insertados >= 0
            AND cantidad_actualizados >= 0
            AND cantidad_omitidos >= 0
            AND cantidad_insertados + cantidad_actualizados + cantidad_omitidos
                = cantidad_registros
        )
);

CREATE INDEX idx_lotes_importacion_usuario
    ON lotes_importacion (importado_por_usuario_id)
    WHERE importado_por_usuario_id IS NOT NULL;
CREATE INDEX idx_lotes_importacion_fecha
    ON lotes_importacion (importado_en);
CREATE UNIQUE INDEX uq_lotes_importacion_fuente_hash
    ON lotes_importacion (sistema_origen, hash_contenido_sha256);

-- Demanda: una fila representa una solicitud, exista o no una cita posterior.
CREATE TABLE solicitudes_atencion (
    id                          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lote_importacion_id         BIGINT NOT NULL,
    sistema_origen              VARCHAR(100) NOT NULL,
    clave_origen                VARCHAR(200) NOT NULL,
    tipo_atencion_codigo        VARCHAR(50) NOT NULL,
    estado_solicitud_codigo     VARCHAR(50) NOT NULL DEFAULT 'pendiente',
    unidad_organizacional_id    BIGINT,
    solicitada_en               TIMESTAMPTZ NOT NULL,
    cerrada_en                  TIMESTAMPTZ,
    creado_en                   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_solicitudes_atencion_origen
        UNIQUE (sistema_origen, clave_origen),
    CONSTRAINT fk_solicitudes_atencion_lote
        FOREIGN KEY (lote_importacion_id) REFERENCES lotes_importacion (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_solicitudes_atencion_tipo
        FOREIGN KEY (tipo_atencion_codigo) REFERENCES tipos_atencion (codigo)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_solicitudes_atencion_estado
        FOREIGN KEY (estado_solicitud_codigo) REFERENCES estados_solicitud (codigo)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_solicitudes_atencion_unidad
        FOREIGN KEY (unidad_organizacional_id) REFERENCES unidades_organizacionales (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_solicitudes_atencion_sistema_no_vacio
        CHECK (btrim(sistema_origen) <> ''),
    CONSTRAINT chk_solicitudes_atencion_clave_no_vacia
        CHECK (btrim(clave_origen) <> ''),
    CONSTRAINT chk_solicitudes_atencion_cierre
        CHECK (cerrada_en IS NULL OR cerrada_en >= solicitada_en),
    CONSTRAINT chk_solicitudes_atencion_actualizacion
        CHECK (actualizado_en >= creado_en)
);

CREATE INDEX idx_solicitudes_atencion_lote
    ON solicitudes_atencion (lote_importacion_id);
CREATE INDEX idx_solicitudes_atencion_solicitada_en
    ON solicitudes_atencion (solicitada_en);
CREATE INDEX idx_solicitudes_atencion_estado_periodo
    ON solicitudes_atencion (estado_solicitud_codigo, solicitada_en);
CREATE INDEX idx_solicitudes_atencion_tipo_periodo
    ON solicitudes_atencion (tipo_atencion_codigo, solicitada_en);
CREATE INDEX idx_solicitudes_atencion_unidad_periodo
    ON solicitudes_atencion (unidad_organizacional_id, solicitada_en)
    WHERE unidad_organizacional_id IS NOT NULL;

-- Agenda: una fila representa una hora o cupo agendado.
CREATE TABLE citas (
    id                          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lote_importacion_id         BIGINT NOT NULL,
    sistema_origen              VARCHAR(100) NOT NULL,
    clave_origen                VARCHAR(200) NOT NULL,
    solicitud_atencion_id       BIGINT,
    tipo_atencion_codigo        VARCHAR(50) NOT NULL,
    estado_cita_codigo          VARCHAR(50) NOT NULL DEFAULT 'agendada',
    unidad_organizacional_id    BIGINT,
    inicio_agendado_en          TIMESTAMPTZ NOT NULL,
    creado_en                   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_citas_origen
        UNIQUE (sistema_origen, clave_origen),
    CONSTRAINT fk_citas_lote
        FOREIGN KEY (lote_importacion_id) REFERENCES lotes_importacion (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_citas_solicitud
        FOREIGN KEY (solicitud_atencion_id) REFERENCES solicitudes_atencion (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_citas_tipo
        FOREIGN KEY (tipo_atencion_codigo) REFERENCES tipos_atencion (codigo)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_citas_estado
        FOREIGN KEY (estado_cita_codigo) REFERENCES estados_cita (codigo)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_citas_unidad
        FOREIGN KEY (unidad_organizacional_id) REFERENCES unidades_organizacionales (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_citas_sistema_no_vacio
        CHECK (btrim(sistema_origen) <> ''),
    CONSTRAINT chk_citas_clave_no_vacia
        CHECK (btrim(clave_origen) <> ''),
    CONSTRAINT chk_citas_actualizacion
        CHECK (actualizado_en >= creado_en)
);

CREATE INDEX idx_citas_lote ON citas (lote_importacion_id);
CREATE INDEX idx_citas_solicitud
    ON citas (solicitud_atencion_id)
    WHERE solicitud_atencion_id IS NOT NULL;
CREATE INDEX idx_citas_inicio_agendado_en ON citas (inicio_agendado_en);
CREATE INDEX idx_citas_estado_periodo
    ON citas (estado_cita_codigo, inicio_agendado_en);
CREATE INDEX idx_citas_tipo_periodo
    ON citas (tipo_atencion_codigo, inicio_agendado_en);
CREATE INDEX idx_citas_unidad_periodo
    ON citas (unidad_organizacional_id, inicio_agendado_en)
    WHERE unidad_organizacional_id IS NOT NULL;

-- Ejecución: una cita atendida tiene como máximo un registro de realización.
-- La espera se calcula con llegada_en e inicio_atencion_en. Si llegada_en no
-- existe, duracion_espera_reportada_minutos puede actuar como fallback.
CREATE TABLE atenciones_realizadas (
    id                                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lote_importacion_id                 BIGINT NOT NULL,
    sistema_origen                      VARCHAR(100) NOT NULL,
    clave_origen                        VARCHAR(200) NOT NULL,
    cita_id                             BIGINT NOT NULL,
    llegada_en                          TIMESTAMPTZ,
    inicio_atencion_en                  TIMESTAMPTZ NOT NULL,
    fin_atencion_en                     TIMESTAMPTZ,
    duracion_espera_reportada_minutos   INTEGER,
    creado_en                           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_atenciones_realizadas_origen
        UNIQUE (sistema_origen, clave_origen),
    CONSTRAINT uq_atenciones_realizadas_cita
        UNIQUE (cita_id),
    CONSTRAINT fk_atenciones_realizadas_lote
        FOREIGN KEY (lote_importacion_id) REFERENCES lotes_importacion (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_atenciones_realizadas_cita
        FOREIGN KEY (cita_id) REFERENCES citas (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_atenciones_realizadas_sistema_no_vacio
        CHECK (btrim(sistema_origen) <> ''),
    CONSTRAINT chk_atenciones_realizadas_clave_no_vacia
        CHECK (btrim(clave_origen) <> ''),
    CONSTRAINT chk_atenciones_realizadas_orden_inicio
        CHECK (llegada_en IS NULL OR inicio_atencion_en >= llegada_en),
    CONSTRAINT chk_atenciones_realizadas_orden_fin
        CHECK (fin_atencion_en IS NULL OR fin_atencion_en >= inicio_atencion_en),
    CONSTRAINT chk_atenciones_realizadas_espera_reportada
        CHECK (
            duracion_espera_reportada_minutos IS NULL
            OR (
                duracion_espera_reportada_minutos >= 0
                AND llegada_en IS NULL
            )
        )
);

CREATE INDEX idx_atenciones_realizadas_lote
    ON atenciones_realizadas (lote_importacion_id);
CREATE INDEX idx_atenciones_realizadas_inicio
    ON atenciones_realizadas (inicio_atencion_en);

COMMENT ON TABLE solicitudes_atencion IS
    'Hechos de demanda. El período se determina con solicitada_en en America/Santiago.';
COMMENT ON TABLE citas IS
    'Hechos de agenda. Inasistencia, uso de agenda y detalle usan inicio_agendado_en y estado_cita_codigo.';
COMMENT ON TABLE atenciones_realizadas IS
    'Hechos de ejecución vinculados uno a uno con citas atendidas; no contiene datos clínicos ni identificadores de personas atendidas.';
COMMENT ON COLUMN atenciones_realizadas.duracion_espera_reportada_minutos IS
    'Fallback de espera, permitido solo cuando llegada_en es NULL.';

-- Catálogos iniciales mínimos. Los códigos son parte del contrato de datos.
INSERT INTO roles_usuario (codigo, etiqueta, descripcion) VALUES
    ('admin', 'Administrador', 'Gestiona usuarios y cargas de datos.'),
    ('consulta', 'Consulta', 'Consulta indicadores y detalle operativo.');

INSERT INTO tipos_atencion (codigo, etiqueta) VALUES
    ('medicina_general', 'Medicina general'),
    ('control_cronico', 'Control crónico'),
    ('control_salud', 'Control de salud'),
    ('enfermeria', 'Enfermería'),
    ('odontologia', 'Odontología');

INSERT INTO estados_solicitud (codigo, etiqueta, descripcion) VALUES
    ('pendiente', 'Pendiente', 'La solicitud aún no tiene resolución.'),
    ('agendada', 'Agendada', 'La solicitud originó al menos una cita vigente.'),
    ('cerrada', 'Cerrada', 'La solicitud terminó su ciclo de gestión.'),
    ('cancelada', 'Cancelada', 'La solicitud fue anulada sin atención.');

INSERT INTO estados_cita (codigo, etiqueta, descripcion) VALUES
    ('agendada', 'Agendada', 'Cita creada y pendiente de resolución.'),
    ('confirmada', 'Confirmada', 'Cita confirmada y pendiente de resolución.'),
    ('atendida', 'Atendida', 'Cita con atención realizada.'),
    ('inasistencia', 'Inasistencia', 'La persona citada no asistió.'),
    ('cancelada', 'Cancelada', 'Cita anulada y excluida de agenda resuelta.');

-- Reglas transaccionales de aplicación que no pueden expresarse solo con
-- restricciones declarativas entre filas o tablas:
--   1. Los códigos de catálogos no se modifican; solo sus etiquetas,
--      descripciones y vigencia.
--   2. Si una cita referencia una solicitud, ambas deben conservar el mismo
--      tipo de atención y una unidad compatible.
--   3. Una cita en estado 'atendida' debe tener exactamente una atención
--      realizada; una cita en cualquier otro estado no debe tenerla.
--   4. cerrada_en se informa únicamente para estados terminales de solicitud.
--   5. Cada importación valida todo el lote y confirma lote y hechos en una
--      única transacción; cualquier error revierte el conjunto completo.
--   6. En carga_manual_v1, una clave repetida se omite si coincide o actualiza
--      solicitud, cita y atención juntas si su contenido difiere.
--   7. La aplicación actualiza actualizado_en en cada modificación de datos
--      administrativos o hechos; registrar ultimo_acceso_en no lo modifica.

COMMIT;
