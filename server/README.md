# API backend del dashboard CESFAM

Esta carpeta contiene la API operativa: configuración validada, logging estructurado, conexión PostgreSQL, autenticación con sesiones PostgreSQL e indicadores calculados desde hechos.

## Requisitos

- Node.js 20.11 o posterior compatible.
- PostgreSQL accesible mediante una URL de conexión.

## Configuración

1. Copie `.env.example` como `.env`.
2. Configure `DATABASE_URL` con un rol de aplicación de privilegios mínimos. No use el superusuario `postgres` en entornos productivos.
3. Genere `SESSION_SECRET` con al menos 32 caracteres aleatorios y configure la duración y el nombre de la cookie.
4. Mantenga `TRUST_PROXY=false`, salvo que la API esté detrás de un único proxy inverso controlado.
5. Ajuste `PORT`, `NODE_ENV` y `LOG_LEVEL` cuando corresponda.

La API rechaza la configuración inválida antes de abrir el puerto. Los mensajes de inicio no imprimen la URL de conexión ni sus credenciales.

## Ejecución

```bash
npm install
npm start
```

Durante el desarrollo puede usar el modo watch nativo de Node.js:

```bash
npm run dev
```

## Endpoints operacionales

| Endpoint | Propósito | Dependencia de PostgreSQL |
|---|---|---|
| `GET /health` | Confirma que el proceso HTTP está vivo. | No consulta la base. |
| `GET /ready` | Confirma que la API puede ejecutar `SELECT 1`. | Responde `503` si PostgreSQL no está disponible. |

Cada respuesta incluye `X-Request-Id`. Si la solicitud no lo envía, la API genera un UUID. Los errores usan un contrato JSON estable y no exponen trazas, SQL ni credenciales.

## Autenticación

| Método y endpoint | Propósito |
|---|---|
| `GET /api/v1/auth/csrf` | Crea o rota el token CSRF ligado a la sesión anónima. |
| `POST /api/v1/auth/login` | Inicia sesión; requiere `X-CSRF-Token`. |
| `GET /api/v1/auth/me` | Devuelve la cuenta activa y su rol vigente. |
| `POST /api/v1/auth/logout` | Cierra la sesión; requiere autenticación y `X-CSRF-Token`. |

La cookie es `HttpOnly`, `SameSite=Lax` y solo usa `Secure` en producción. El servidor conserva el identificador del usuario, el token CSRF y la versión monotónica `usuarios.auth_version`; la cuenta, el rol y esa versión se vuelven a consultar en PostgreSQL en cada petición autenticada. Una sesión con versión ausente o anterior se destruye y exige un nuevo inicio de sesión.

Después de verificar Argon2id, el login finaliza mediante un compare-and-set sobre identificador, estado activo, `auth_version` y `password_hash`. Si cualquiera cambió durante la verificación, no regenera la sesión y responde con el mismo error genérico de credenciales. Actualizar `ultimo_acceso_en` no modifica `actualizado_en` ni `auth_version`, por lo que varios logins pueden mantener sesiones válidas simultáneamente.

## Administración de usuarios

Todas las rutas siguientes requieren una cuenta activa con rol vigente `admin`. Las mutaciones también requieren `X-CSRF-Token`:

| Método y endpoint | Propósito |
|---|---|
| `GET /api/v1/admin/usuarios` | Lista y filtra cuentas con paginación. |
| `POST /api/v1/admin/usuarios` | Crea una cuenta con contraseña Argon2id. |
| `PATCH /api/v1/admin/usuarios/:id` | Modifica nombre, rol o estado. |
| `POST /api/v1/admin/usuarios/:id/password` | Restablece la contraseña y revoca sesiones. |

El listado admite `page` (por defecto `1`), `limit` (por defecto `20`, máximo `100`), `search`, `role=admin|consulta` y `active=true|false`. Rechaza parámetros desconocidos y calcula página y total en una única consulta. Su respuesta exacta es:

```json
{
  "data": {
    "users": [
      {
        "id": "1",
        "usuario": "cuenta",
        "nombre": "Nombre visible",
        "correo": null,
        "rol": "consulta",
        "activo": true,
        "ultimo_acceso_en": null,
        "creado_en": "2026-10-17T12:00:00.000Z",
        "actualizado_en": "2026-10-17T12:00:00.000Z"
      }
    ]
  },
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

Crear, editar y restablecer contraseña responden `{"data":{"user":<cuenta>}}`; nunca incluyen contraseña ni hash. Un `PATCH` sin cambios devuelve `200` con la representación vigente y no actualiza `actualizado_en`. El identificador de acceso `usuario` es inmutable y no existe eliminación física: una cuenta se activa o desactiva mediante `PATCH`.

El servidor impide degradar o desactivar la propia cuenta y bloquea las filas de administradores activos antes de permitir una operación que pueda dejar el sistema sin administración. Cambiar contraseña, rol o estado incrementa `auth_version` y elimina todas las filas atribuibles de `sesiones_http` en la misma transacción. Cambiar solo nombre —o correo si el contrato lo admite en el futuro— no incrementa la versión ni expulsa sesiones. Si un administrador restablece su propia contraseña, también se elimina su sesión actual y se borra la cookie en la respuesta; debe iniciar sesión nuevamente.

La revocación busca el `userId` superior del JSON de sesión escrito por la versión actual de `express-session` y `connect-pg-simple`, usando una comparación parametrizada. La propiedad superior `authVersion` impide que una petición concurrente vuelva a validar una sesión guardada antes del cambio. Las sesiones heredadas que no contengan `userId` no pueden atribuirse con seguridad y no se eliminan por esta consulta; las que no contengan `authVersion` tampoco satisfacen la autenticación vigente. Aplicar `003_user_auth_version` obliga por ello a iniciar sesión nuevamente.

## Indicadores y detalle

Las siguientes rutas requieren una cuenta activa con rol `admin` o `consulta`:

- `GET /api/v1/indicadores/inasistencia`
- `GET /api/v1/indicadores/atenciones`
- `GET /api/v1/indicadores/tiempo-espera`
- `GET /api/v1/indicadores/horas-agenda`
- `GET /api/v1/indicadores/demanda`
- `GET /api/v1/atenciones`

Todas exigen `desde` y `hasta` en formato `YYYY-MM-DD`, con un máximo de 366 días. El detalle admite `page` y `limit` (máximo 100), conserva el estado canónico de cada cita y calcula el total y la página en una única consulta. Los indicadores responden con `data.resumen`, `data.serie` y `meta`; el detalle usa `data.items` y metadatos de paginación. Tasas y porcentajes se expresan como decimales entre 0 y 1.

## Semilla sintética

En `development` o `test`, después de aplicar las migraciones:

```bash
npm run db:seed:synthetic
```

La semilla crea un lote determinista para abril-septiembre de 2026 con 1.840 solicitudes, 1.840 citas y 1.527 atenciones. No contiene datos personales ni clínicos. Se ejecuta en una sola transacción: repetirla compara claves, vínculos, catálogos, estados, unidades y marcas temporales de cada hecho canónico antes de aceptar el lote existente; no duplica filas y rechaza cualquier estado parcial o diferente sin corregirlo silenciosamente. No modifica usuarios, sesiones ni datos de otros orígenes.

### Crear el primer administrador

Después de aplicar las migraciones, entregue la contraseña exclusivamente por entrada estándar:

```bash
printf '%s\n' "$ADMIN_PASSWORD" | npm run admin:create -- \
  --username administrador \
  --name "Administrador del sistema" \
  --password-stdin
```

La contraseña debe tener al menos 12 caracteres. No se acepta por argumentos, archivos ni valores predeterminados. El comando rechaza usuarios duplicados sin mostrar la contraseña ni su hash.

## Pruebas

```bash
npm test
```

`npm test` ejecuta Vitest una vez en entorno Node. `npm run test:watch` mantiene Vitest observando cambios. La suite rápida simula la comprobación de PostgreSQL y no necesita una base real.

La prueba dedicada de concurrencia crea y elimina una base PostgreSQL temporal, valida `001`–`003` en ambos sentidos y coordina locks reales para demostrar las garantías de login y revocación:

```bash
npm run test:postgres:auth-concurrency
```

## Cierre

`SIGINT` y `SIGTERM` detienen primero el servidor HTTP y luego cierran el pool PostgreSQL. Las señales repetidas comparten el mismo proceso de cierre para evitar liberar recursos dos veces.

Las migraciones y su operación se documentan por separado en [`db/README.md`](./db/README.md).
