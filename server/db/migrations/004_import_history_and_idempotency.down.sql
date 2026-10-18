-- Revierte la trazabilidad de actualizaciones conservando el total procesado.

DROP INDEX uq_lotes_importacion_fuente_hash;

ALTER TABLE lotes_importacion
    DROP CONSTRAINT chk_lotes_importacion_cantidades;

UPDATE lotes_importacion
SET cantidad_insertados = cantidad_insertados + cantidad_actualizados
WHERE cantidad_actualizados > 0;

ALTER TABLE lotes_importacion
    DROP COLUMN cantidad_actualizados;

ALTER TABLE lotes_importacion
    ADD CONSTRAINT chk_lotes_importacion_cantidades
        CHECK (
            cantidad_registros >= 0
            AND cantidad_insertados >= 0
            AND cantidad_omitidos >= 0
            AND cantidad_insertados + cantidad_omitidos = cantidad_registros
        );
