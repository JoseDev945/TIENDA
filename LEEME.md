# Regateo: tu tienda (versión para Vercel + Neon)

Un marketplace entre personas, como el de Facebook, donde **cada publicación tiene su propio chat** para opinar, preguntar y ofertar.

## Ponerla en internet

Sigue **`DESPLEGAR.md`**. En resumen: doble clic en `desplegar.bat`, conectar Neon y Blob desde el panel de Vercel, y volver a ejecutar `desplegar.bat`.

> **Importante:** la primera cuenta que se crea es la **administradora**. Créala tú en cuanto la tienda esté en línea.

## Probarla en tu computadora (opcional)

1. Después de desplegar y conectar Neon y Blob, abre una terminal en esta carpeta y ejecuta `npx vercel env pull .env.local`. Eso descarga las claves a un archivo `.env.local`.
2. Doble clic en **`iniciar.bat`**. La primera vez instala lo necesario y abre `http://localhost:3000`.

Ojo: así tu computadora usa **la misma base de datos y los mismos archivos que la tienda en línea**. Lo que publiques o borres en la prueba también cambia en la tienda real.

## Qué puedes cambiar sin saber programar

Abre `config.js` con el Bloc de notas:

| Opción | Para qué sirve |
| --- | --- |
| `nombre` | El nombre de la tienda (aparece arriba a la izquierda). |
| `simboloMoneda` | `$`, `B/.`, `€`… |
| `formatoRegional` | Cómo se escriben los números. `es-PA` muestra `1,250.50`. |
| `admins` | Usuarios extra con permisos de moderación, por ejemplo `['maria', 'pedro']`. |
| `maxArchivoMB` / `maxImagenMB` | Peso máximo de videos/archivos y de fotos. |

Después de cambiar algo, vuelve a ejecutar `desplegar.bat`.

## Dónde se guarda todo

- **Usuarios, publicaciones y mensajes:** en tu base de datos Neon.
- **Fotos, videos y archivos:** en tu almacén Vercel Blob.

Los dos se ven y administran desde el apartado **Storage** de tu proyecto en Vercel.

## Archivos de esta carpeta

- `api/` y `lib/`: el servidor. `lib/tienda.js` tiene cuentas, publicaciones, chat y moderación; `lib/eventos.js` el chat en vivo; `lib/archivos.js` las subidas; `lib/db.js` la base de datos.
- `public/`: lo que se ve en el navegador (`js/app.js` pantallas, `js/chat.js` el chat, `styles.css` el diseño).
- `vercel.json`: configuración de Vercel. `config.js`: ajustes de la tienda.
- `servidor-local.js` e `iniciar.bat`: para probarla en tu computadora.
- `PLAN.md`: el plan, las decisiones que se tomaron y las limitaciones conocidas.
- `_version_anterior/`: la primera versión (la que guardaba todo en tu computadora). Ya no se usa; puedes borrarla.
