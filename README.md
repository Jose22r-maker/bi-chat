# BI Chat

Servicio de mensajeria en tiempo real desarrollado por **x21** con React 19, TypeScript, Vite y Supabase.

## Principios

- Accesibilidad primero: teclado, `aria-live`, contraste AA y objetivos tactiles de 44px.
- Legibilidad a distancia: mensajes de 17px, interlineado 1.5 y jerarquia por peso/tamano.
- Rendimiento ligero: CSS puro, estado local/contexto, virtualizacion para historiales largos.
- Datos seguros desde el inicio: RLS en Postgres y Supabase Realtime sin servidor de sockets propio.

## Inicio

```bash
npm install
cp .env.example .env.local
npm run dev
```

Antes de usar la app, ejecuta el SQL de `supabase/schema.sql` en tu proyecto Supabase.

Si ya habias ejecutado una version anterior del esquema, ejecuta tambien `supabase/search_profiles_migration.sql` para habilitar busqueda de usuarios por usuario/QR.

BI Chat muestra un acceso simple con **usuario y contrasena**. Internamente se usa Supabase Auth con email privado derivado del usuario, para que la interfaz no pida correo. El usuario se vincula al QR; la contrasena no se guarda en texto en el dispositivo, queda gestionada por Supabase Auth y en el navegador solo queda la sesion.

En Supabase Auth, desactiva la confirmacion obligatoria por email para que el registro con usuario entre de inmediato.

## Verificacion

```bash
npm run lint
npm run build
```

El build separa Supabase en un chunk propio para mantener bajo el JS inicial de la interfaz.
