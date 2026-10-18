-- Infraestructura de sesiones HTTP para connect-pg-simple.
-- No representa un hecho de negocio del dashboard.

CREATE TABLE sesiones_http (
    sid         VARCHAR NOT NULL,
    sess        JSON NOT NULL,
    expire      TIMESTAMP(6) NOT NULL,

    CONSTRAINT sesiones_http_pkey PRIMARY KEY (sid)
);

CREATE INDEX idx_sesiones_http_expire ON sesiones_http (expire);

COMMENT ON TABLE sesiones_http IS
    'Infraestructura efímera de sesiones HTTP; no representa un hecho de negocio.';
