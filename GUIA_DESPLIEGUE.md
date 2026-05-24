# ⚽ Polla Mundial 2026 — Guía de Despliegue Completa

## Resumen de la arquitectura
```
Participantes (celular) → app.html → Netlify Functions → Supabase
Admins (celular)        → admin.html → Netlify Functions → Supabase
Cron jobs automáticos   → recordatorios + resultados vía API-Football
Notificaciones          → Gmail (automático) + WhatsApp (mensaje listo para copiar)
```

---

## PASO 1 — Crear cuenta en Supabase (base de datos)

1. Ve a **https://supabase.com** → "Start for Free" → ingresa con tu Gmail
2. Crea un nuevo proyecto:
   - Nombre: `polla-mundial-2026`
   - Contraseña: elige una segura y **guárdala**
   - Región: `South America (São Paulo)` ← más cercana a Colombia/Brasil
3. Espera ~2 minutos a que el proyecto se inicialice
4. Ve a **SQL Editor** (ícono de base de datos en la barra izquierda)
5. Copia todo el contenido del archivo `supabase/schema.sql` y pégalo en el editor
6. Haz clic en **Run** → verás "Success" en verde
7. Anota estas dos credenciales (las necesitas en el Paso 3):
   - **Project URL**: `Settings → API → Project URL`
   - **Service Role Key**: `Settings → API → service_role` (NO la anon key)

---

## PASO 2 — Subir el código a GitHub

1. Ve a **https://github.com** → inicia sesión o crea cuenta con Gmail
2. Crea un nuevo repositorio: "New" → nombre: `polla-mundial-2026` → Public → "Create"
3. En tu computador, instala **GitHub Desktop** desde https://desktop.github.com
4. Abre GitHub Desktop → "Clone a repository" → pega la URL de tu repo
5. Copia todos los archivos del proyecto en la carpeta clonada:
   ```
   polla2026/
   ├── netlify.toml
   ├── package.json
   ├── src/
   │   ├── app.html
   │   └── admin.html
   ├── netlify/
   │   └── functions/
   │       ├── api.js
   │       ├── scheduled-reminders.js
   │       └── scheduled-sync.js
   └── supabase/
       └── schema.sql
   ```
6. En GitHub Desktop: escribe "Primer commit" → "Commit to main" → "Push origin"

---

## PASO 3 — Publicar en Netlify

1. Ve a **https://netlify.com** → "Sign up" → "Continue with GitHub"
2. Haz clic en **"Add new site"** → "Import an existing project" → "Deploy with GitHub"
3. Selecciona el repositorio `polla-mundial-2026`
4. Configuración de build:
   - Build command: `npm install`
   - Publish directory: `src`
   - Functions directory: `netlify/functions`
5. Haz clic en **"Deploy site"**
6. Netlify te dará una URL como `https://random-name-123.netlify.app`
7. **Cambia el nombre del sitio** (opcional): Site settings → General → Site name → `polla2026`

---

## PASO 4 — Variables de entorno en Netlify

En Netlify: **Site settings → Environment variables → Add variable**

Agrega estas variables una por una:

| Variable | Valor | Descripción |
|----------|-------|-------------|
| `SUPABASE_URL` | `https://xxxx.supabase.co` | URL de tu proyecto Supabase |
| `SUPABASE_SERVICE_KEY` | `eyJ...` | Service Role Key de Supabase |
| `GMAIL_USER` | `tucorreo@gmail.com` | Gmail remitente de notificaciones |
| `GMAIL_APP_PASSWORD` | `xxxx xxxx xxxx xxxx` | App Password de Google (ver abajo) |
| `APP_BASE_URL` | `https://polla2026.netlify.app` | URL de tu sitio en Netlify |
| `CRON_SECRET` | `MiClaveSecreta2026!` | Clave secreta para los cron jobs (invéntala tú) |

### Cómo obtener el Gmail App Password:
1. Ve a **myaccount.google.com** → Seguridad
2. Activa la **Verificación en dos pasos** si no la tienes
3. Busca **"Contraseñas de aplicaciones"**
4. App: "Correo" · Dispositivo: "Otro" → escribe "Polla2026"
5. Google genera una clave de 16 caracteres → **cópiala**

Después de agregar todas las variables: **Deploys → Trigger deploy → Deploy site**

---

## PASO 5 — Crear los primeros administradores

Como aún no hay admins, el primer admin se crea directamente en Supabase:

1. Ve a Supabase → **Table Editor** → tabla `participants`
2. Haz clic en **"Insert row"** y llena:
   - `name`: Tu nombre completo
   - `email`: Tu correo
   - `timezone`: `America/Bogota`
   - `role`: `admin`
   - `cuota`: `50000`
   - `is_active`: `true`
   - (deja `access_token` — se genera automáticamente)
3. Repite para los otros 2 administradores
4. Copia el `access_token` de cada uno → ese es su link de acceso:
   - Link participante: `https://polla2026.netlify.app/app?token=ELTOKEN`
   - Link admin: `https://polla2026.netlify.app/admin?token=ELTOKEN`

---

## PASO 6 — Modo pruebas (activar ambiente de test)

El sistema ya viene en **modo pruebas** con 6 partidos ficticios cargados.

1. Los admins entran a `https://polla2026.netlify.app/admin?token=ELTOKEN`
2. En **Config → Modo de operación** verás "🧪 Pruebas" activo
3. Los partidos ficticios aparecen con el tag `🧪 PRUEBA`
4. Agrega los 5 testers desde el panel Admin → Jugadores → "Agregar"
5. Cada tester recibe su link personal por email automáticamente
6. Prueba todas las funcionalidades durante los días acordados

---

## PASO 7 — Reset y paso a producción

Cuando terminen las pruebas:

1. Admin → **Config → Reset total** → confirmar dos veces
2. Luego: **Config → Modo → Producción** 
3. Agregar todos los participantes reales desde el panel Admin
4. Cada uno recibe su link personal por email
5. Compartir el link también por WhatsApp como respaldo

---

## PASO 8 — Configurar API-Football (resultados automáticos)

1. Ve a **https://rapidapi.com/api-sports/api/api-football**
2. "Subscribe to Test" → plan gratuito (100 requests/día)
3. Copia tu API Key
4. En el panel Admin → Config → pega la API Key
5. Los resultados se actualizarán automáticamente cada 5 minutos

> **Nota**: En días con muchos partidos simultáneos (fase de grupos), el plan gratuito
> puede no ser suficiente. El plan básico cuesta ~$10/mes. El admin siempre puede
> ingresar resultados manualmente como respaldo.

---

## PASO 9 — Compartir con los participantes

Mensaje sugerido para el grupo de WhatsApp:

```
⚽ *Polla Mundial 2026*

¡Ya está lista! Cada uno recibió su enlace personal en el correo.

📌 *Instrucciones:*
• Abre tu enlace personal (es solo tuyo, no lo compartas)
• Ingresa tus pronósticos antes de cada partido
• 🔒 Al iniciar el partido se bloquean automáticamente
• Recibirás un aviso 10 min antes si no has pronosticado

¿No recibiste tu correo? Escríbenos y te lo enviamos.

¡Mucha suerte! 🏆
```

---

## MANTENIMIENTO DURANTE EL TORNEO

| Tarea | Frecuencia | ¿Automático? |
|-------|-----------|--------------|
| Resultados de partidos | Por partido | ✅ Sí (API-Football) |
| Cálculo de puntos | Al terminar partido | ✅ Sí |
| Recordatorios −10 min | Por partido | ✅ Sí (email) + semi (WhatsApp) |
| Bloqueo de pronósticos | Al pitazo | ✅ Sí |
| Revelar pronósticos ajenos | Al pitazo | ✅ Sí |
| Ingresar resultado manual | Si falla la API | Manual (Admin → Partidos) |
| Ingresar pronóstico por otro | Si participante no tiene acceso | Manual (Admin → Jugadores) |

---

## SOLUCIÓN DE PROBLEMAS FRECUENTES

**"Mi link no funciona"**
→ El participante debe abrir el link en el navegador, no dentro de WhatsApp.
→ Solución: decirle que toque los tres puntos (...) → "Abrir en Chrome/Safari"

**"No recibí el correo"**
→ Revisar carpeta de spam
→ El admin puede reenviar desde el panel → Jugadores → "Reenviar link"

**"El resultado no se actualizó"**
→ Verificar que la API Key esté configurada en Admin → Config
→ Ingresar manualmente desde Admin → Partidos → "Guardar resultado"

**"Quiero cambiar el horario de un partido"**
→ Supabase → Table Editor → tabla `matches` → editar `kickoff_utc`
→ Formato UTC: `2026-06-11T19:00:00Z` (convertir desde hora local)

---

## ZONAS HORARIAS — REFERENCIA RÁPIDA

| País | Zona | UTC |
|------|------|-----|
| 🇨🇴 Colombia | America/Bogota | UTC-5 |
| 🇧🇷 Brasil/Brasilia | America/Sao_Paulo | UTC-3 |
| 🇺🇸 USA/Florida | America/New_York | UTC-5 (EDT) / UTC-4 (EST) |

Los horarios de partidos se muestran en la zona horaria de cada participante automáticamente.

---

## CONTACTO Y SOPORTE

Si necesitas ayuda técnica durante el torneo, toda la conversación de configuración
está guardada en Claude (claude.ai) con el historial completo del sistema.
