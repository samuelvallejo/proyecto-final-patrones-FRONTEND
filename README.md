# StreamGuard — frontend

Interfaz web adaptable de StreamGuard, construida con **TypeScript**, **Vite** y CSS. La aplicación está en español y se publica por separado del backend.

## Tecnologías y responsabilidades

- **TypeScript estricto** para la interfaz, las llamadas HTTP, la señalización en tiempo real, la captura de medios y el service worker.
- **Vite** para el servidor local y la compilación de archivos estáticos.
- **WebRTC** para audio y video en directo; el frontend también incluye un relay de fragmentos por WebSocket seguro como alternativa cuando la conexión directa no funciona.
- **PWA** con manifest, caché offline de recursos públicos y service worker.
- **API REST y WebSocket** para autenticación, canales, chat, moderación, clips, configuración y colaboración. La autorización definitiva se valida en el backend.

El cambio de lenguaje aplica al **frontend**: sus archivos de aplicación están en `frontend/src/*.ts`. El backend del sistema sigue siendo Java y debe estar disponible para las funciones que dependen de la API; no forma parte de este repositorio.

## Requisitos

- Node.js **22.12 o superior** y npm.
- Una instancia del backend de StreamGuard para usar la aplicación completa.
- Un navegador moderno. Para publicar audio/video, abre el sitio en HTTPS o en `localhost` y concede los permisos de cámara y micrófono.

## Ejecutar en desarrollo

Instala dependencias y apunta el frontend al backend local:

```powershell
npm ci
$env:PUBLIC_API_URL='http://localhost:8080'
npm run dev
```

Abre <http://localhost:5173>. El backend debe estar ejecutándose en `http://localhost:8080`.

## Comprobar y compilar

```powershell
npm run typecheck
npm run check:localization
npm run build
```

`typecheck` verifica la interfaz y el service worker con configuraciones TypeScript estrictas. `build` comprueba las traducciones y los tipos, compila la aplicación con Vite y genera el service worker. Los archivos listos para publicar quedan en `frontend/dist`.

Para ejecutar las pruebas de medios incluidas:

```powershell
npm run test:media
```

Estas pruebas usan medios simulados; no reemplazan una comprobación con cámara, micrófono y navegadores móviles reales.

## Configurar y publicar

`PUBLIC_API_URL` es el **origen** del backend, sin rutas ni credenciales, y se incorpora durante la compilación. Para producción debe ser una URL HTTPS:

```powershell
$env:PUBLIC_API_URL='https://tu-backend.example.com'
npm run build
```

La configuración del repositorio publica `frontend/dist` en Vercel o Firebase Hosting. En ambos servicios configura `PUBLIC_API_URL` como variable de entorno de compilación. Las instrucciones de la instancia completa y sus servicios están en [`docs/shared-streaming.md`](docs/shared-streaming.md) y [`docs/browser-capture-support.md`](docs/browser-capture-support.md).

## Mapa del código

| Archivo | Responsabilidad |
|---|---|
| `frontend/src/app.ts` | Pantallas, navegación y flujos de la interfaz. |
| `frontend/src/api.ts` | Cliente REST, token de sesión y errores HTTP. |
| `frontend/src/contracts.ts` | Tipos JSON y conversión de datos externos a valores utilizables por la interfaz. |
| `frontend/src/media.ts` | Ciclo de vida de transmisiones, WebRTC, grabación y audio. |
| `frontend/src/capture.ts` y `compositor.ts` | Acceso a cámara/pantalla y composición de fuentes de video. |
| `frontend/src/relay.ts` | Relay de fragmentos multimedia cuando WebRTC no es viable. |
| `frontend/src/collaboration.ts` | Reproducción de perspectivas adicionales en transmisiones compartidas. |
| `frontend/src/i18n.ts` y `frontend/public/locales/es.json` | Tipos y textos de la interfaz en español. |
| `frontend/src/service-worker.ts` | Caché de recursos públicos para la PWA; excluye API y datos de sesión. |
| `frontend/src/styles.css` | Estilos y diseño adaptable. |

## Resultado de esta revisión

Se documentó la migración y el estado actual del frontend: TypeScript estricto, módulos, comandos y configuración de despliegue. Este cambio solo actualiza documentación; no modifica la lógica de la aplicación ni el backend.
