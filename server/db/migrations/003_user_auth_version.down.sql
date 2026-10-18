ALTER TABLE usuarios
    DROP CONSTRAINT chk_usuarios_auth_version_positivo,
    DROP COLUMN auth_version;
