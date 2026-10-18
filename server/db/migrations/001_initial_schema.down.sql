-- ROLLBACK DESTRUCTIVO: usar solo en entornos desechables de desarrollo.
-- El ejecutor administra schema_migrations, por lo que este archivo elimina
-- únicamente los objetos canónicos creados por 001_initial_schema.up.sql.

DROP TABLE atenciones_realizadas;
DROP TABLE citas;
DROP TABLE solicitudes_atencion;
DROP TABLE lotes_importacion;
DROP TABLE unidades_organizacionales;
DROP TABLE estados_cita;
DROP TABLE estados_solicitud;
DROP TABLE tipos_atencion;
DROP TABLE usuarios;
DROP TABLE roles_usuario;
