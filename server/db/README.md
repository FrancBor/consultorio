# Migraciones PostgreSQL del servidor

Estas migraciones crean el modelo canónico y la infraestructura PostgreSQL del servidor en una base PostgreSQL 17 vacía. Se ejecutan con `node-pg-migrate` y mantienen su historial en `schema_migrations`.

## Preparación rápida

1. Use Node.js `20.11.0` o una versión posterior compatible.
2. Desde `server/`, instale las dependencias con `npm ci`.
3. Copie `.env.example` como `.env` y configure `DATABASE_URL` localmente. No confirme `.env` ni credenciales.
4. Use una base vacía y ejecute:

```bash
npm run db:migrate:up
```

Para revertir únicamente la última migración aplicada:

```bash
npm run db:migrate:down
```

`up` aplica todas las migraciones pendientes. `down` fija `count: 1` y revierte solo la última migración registrada.

## Fuente de verdad

| Recurso | Responsabilidad |
|---|---|
| `db/migrations/*.up.sql` | Fuente ejecutable y versionada de cambios de esquema. |
| `db/migrations/*.down.sql` | Reversión explícita de cada cambio. |
| [`../../docs/schema.sql`](../../docs/schema.sql) | Snapshot de referencia para lectura y creación manual de una base vacía. |
| [`../../docs/data-model/`](../../docs/data-model/) | Semántica, diccionario y reglas del modelo. |

Las migraciones son la fuente ejecutable. El snapshot refleja el estado acumulado para lectura y creación manual, e incluye su propia transacción; las migraciones no contienen `BEGIN` ni `COMMIT` porque `node-pg-migrate` controla la transacción. Todo cambio futuro debe agregarse como una nueva migración y reflejarse en el snapshot y la documentación cuando corresponda. `sesiones_http` es infraestructura efímera de la capa HTTP y no un hecho de negocio.

## Verificar el estado

Consulte el historial sin modificar el esquema:

```sql
SELECT id, name, run_on
FROM schema_migrations
ORDER BY id;
```

También puede comprobar las tablas canónicas:

```sql
SELECT tablename
FROM pg_catalog.pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

## Versionado de autenticación

`003_user_auth_version` agrega `usuarios.auth_version` como contador positivo, monotónico e independiente de `actualizado_en` y `ultimo_acceso_en`. Cambiar contraseña, rol o estado aumenta el contador; un cambio solo de nombre o correo no lo modifica. Las sesiones creadas antes de esta migración no contienen `authVersion`, por lo que el middleware las rechaza y exige iniciar sesión nuevamente.

Para validar en una base temporal el ciclo `up → down 003 → up`, junto con las carreras de login y revocación:

```bash
npm run test:postgres:auth-concurrency
```

## Base existente `consultorio`

La base local `consultorio` debe registrar las migraciones `001` a `004`. `004_import_history_and_idempotency` agrega el conteo de actualizaciones y la unicidad por fuente/hash para las cargas manuales. `npm run db:migrate:up` aplica únicamente las migraciones pendientes.

Para validar en una base temporal el ciclo `up → down 004 → up` y el flujo HTTP completo de importación:

```bash
npm run test:postgres:imports
```

## Datos sintéticos de desarrollo

`npm run db:seed:synthetic` carga un único lote determinista de hechos sintéticos cuando `NODE_ENV` es `development` o `test`. No es una migración ni contiene datos reales. Su idempotencia exige que lote y hechos coincidan exactamente; una ejecución parcial o alterada falla y conserva el estado previo mediante rollback.

## Rollback destructivo

Cada ejecución de `npm run db:migrate:down` revierte solo la última migración. Revertir `004` suma las actualizaciones históricas a `cantidad_insertados` antes de retirar su columna; se conserva el total procesado, pero se pierde esa distinción. Revertir `003_user_auth_version` elimina únicamente su constraint y columna; el siguiente `down` elimina la infraestructura de sesiones HTTP de `002_http_sessions`. Continuar hasta revertir `001_initial_schema` elimina las diez tablas canónicas y todos sus datos. Úselo únicamente en desarrollo o en entornos desechables. No es un mecanismo de recuperación para una base con información que deba conservarse.
