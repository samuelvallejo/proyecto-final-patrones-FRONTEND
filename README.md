# StreamGuard Frontend

Frontend responsive de StreamGuard, desarrollada con TypeScript y Vite. La interfaz está en español.

## Ejecutar localmente

Requiere Node.js 22.12 o superior.

```powershell
npm ci
$env:PUBLIC_API_URL='http://localhost:8080'
npm run dev
```

Abre http://localhost:5173. Para compilar, configura `PUBLIC_API_URL` con el origen HTTPS del backend y ejecuta `npm run build`; la salida queda en `frontend/dist`.

## Publicar

Vercel y Firebase Hosting usan la configuración del repositorio. Configura `PUBLIC_API_URL` como variable de entorno de compilación con el origen público del backend.
