-- Monotonic account authentication version for session invalidation.

ALTER TABLE usuarios
    ADD COLUMN auth_version BIGINT NOT NULL DEFAULT 1,
    ADD CONSTRAINT chk_usuarios_auth_version_positivo
        CHECK (auth_version > 0);
