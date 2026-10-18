# Dashboard CESFAM — Frontend

Interfaz para "Gestión Inteligente CESFAM" (CESFAM Profesor Eugenio
Cienfuegos). React + Vite + Tailwind CSS v4 + Recharts, con autenticación
real por sesión y dos niveles de acceso.

## Cómo correrlo

```bash
cp .env.example .env
npm install
npm run dev
```

Abre `http://localhost:5173`. La autenticación requiere el backend en
`http://127.0.0.1:3000`; Vite reenvía `/api` durante el desarrollo.

## Autenticación y datos del dashboard

El frontend usa los endpoints reales de sesión bajo `/api/v1/auth`. La cookie
de sesión es `HttpOnly`; las contraseñas, el token CSRF y la sesión no se
persisten en el almacenamiento del navegador.

El Dashboard consulta los cinco indicadores y el detalle real bajo `/api/v1`.
Los filtros usan fechas inclusivas y cada nueva consulta cancela la anterior
para evitar mostrar respuestas obsoletas. `src/api/mockData.js` se conserva
solo como referencia histórica y no forma parte del grafo de ejecución.

La vista Administración usa `/api/v1/admin/usuarios` para gestionar cuentas y
`/api/v1/admin/importaciones` para validar, importar y consultar el historial
de archivos CSV/JSON. Ambas funciones requieren rol administrador. La carga es
transaccional, limita tamaño y filas, permite cancelación y nunca envía datos a
un servicio externo. El contrato ejecutable está documentado en
[`docs/data-model/import-contract.md`](docs/data-model/import-contract.md).

## Estructura

```
docs/
  arquitectura-cesfam.drawio  # diagrama de arquitectura (abrir en draw.io / diagrams.net)
  schema.sql                  # modelo de datos PostgreSQL
src/
  auth/
    AuthContext.jsx  # hidratación de sesión y login/logout contra la API real
  api/
    auth.js          # contrato de autenticación y manejo seguro de errores
    http.js          # cliente HTTP compartido para /api/v1
    client.js        # cliente real de indicadores y detalle
    admin-users.js   # cliente real de administración de cuentas
    imports.js       # carga multipart e historial de importaciones
    mockData.js       # referencia histórica, fuera del runtime
  components/
    Layout.jsx         # header, navegación por rol, cerrar sesión
    KpiCard.jsx
    FiltroPeriodo.jsx
    GraficoTendencia.jsx     # gráfico de una sola serie (área)
    GraficoComparativo.jsx   # gráfico de dos series (agendadas vs. utilizadas)
    TablaDetalle.jsx
  pages/
    Login.jsx
    Dashboard.jsx
    dashboard-state.js  # estado puro de intentos, reintentos y ausencia de datos
    Administracion.jsx  # gestión real de cuentas e importaciones
```

## Diseño y accesibilidad

La dirección visual y las reglas de UX de este proyecto se apoyaron en la
skill `ui-ux-pro-max` (github.com/nextlevelbuilder/ui-ux-pro-max-skill),
consultada para: paleta de color para producto tipo "Healthcare App",
tipografía recomendada (Figtree/Noto Sans), y checklist de accesibilidad
para formularios en React (labels asociados, resumen de error enfocable,
manejo de foco, envío con feedback de carga). El color de marca (teal) se
mantuvo como el ya establecido en el informe y los diagramas del proyecto,
para dar continuidad visual — la skill informó la *estructura* de tokens
y las reglas de accesibilidad, no reemplazó la identidad ya definida.

Checklist aplicado:
- Contraste de texto ≥ 4.5:1 en modo claro.
- Estados de foco visibles (`focus-visible`) en todos los elementos interactivos.
- `cursor-pointer` y transiciones de hover (150–300ms) en botones y controles.
- `prefers-reduced-motion` respetado globalmente.
- Formulario de login: labels asociados, envío con `onSubmit` + `preventDefault`,
  resumen de error con `role="alert"` y foco automático tras un intento fallido.
- Gráficos navegables por teclado, tooltips anunciables y alternativa tabular
  visible para consultar los mismos valores sin depender del color.
- Sin emojis como íconos.

## Contrato de autenticación

Antes de cada `POST` de autenticación, el frontend solicita un token en
`GET /api/v1/auth/csrf` y lo envía en `X-CSRF-Token`. La sesión se hidrata con
`GET /api/v1/auth/me`; el usuario y su rol siempre provienen del servidor.
