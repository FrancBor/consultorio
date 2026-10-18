-- Amplía la trazabilidad de cargas manuales y garantiza idempotencia por contenido.

ALTER TABLE lotes_importacion
    ADD COLUMN cantidad_actualizados INTEGER NOT NULL DEFAULT 0;

ALTER TABLE lotes_importacion
    DROP CONSTRAINT chk_lotes_importacion_cantidades;

ALTER TABLE lotes_importacion
    ADD CONSTRAINT chk_lotes_importacion_cantidades
        CHECK (
            cantidad_registros >= 0
            AND cantidad_insertados >= 0
            AND cantidad_actualizados >= 0
            AND cantidad_omitidos >= 0
            AND cantidad_insertados + cantidad_actualizados + cantidad_omitidos
                = cantidad_registros
        );

CREATE UNIQUE INDEX uq_lotes_importacion_fuente_hash
    ON lotes_importacion (sistema_origen, hash_contenido_sha256);
