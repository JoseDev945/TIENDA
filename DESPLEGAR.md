# Cómo poner la tienda en internet (Vercel + Neon)

Tardas unos 15 minutos. Necesitas una cuenta en https://vercel.com (puedes entrar con Google o GitHub) y tener instalado **Node.js** (https://nodejs.org, versión LTS).

## 1. Primer despliegue

Haz doble clic en **`desplegar.bat`**.

- La primera vez se abre el navegador para que entres a tu cuenta de Vercel.
- Después hace unas preguntas en inglés en la ventana negra. Acepta lo que propone pulsando **Enter** en cada una (cuando pregunte el nombre del proyecto, puedes escribir el que quieras, por ejemplo `regateo`).
- Al terminar muestra la dirección de tu tienda, algo como `https://regateo.vercel.app`.

Si abres esa dirección ahora verás la tienda, pero con un aviso de que falta la base de datos. Es lo normal: se conecta en el paso siguiente.

## 2. Conectar la base de datos (Neon)

1. Entra a https://vercel.com, abre tu proyecto y ve a **Storage**.
2. Elige **Create Database** y selecciona **Neon** (Postgres).
3. En la región elige **Washington, D.C., USA (East)** (`iad1` / `us-east-1`). Es donde corre la tienda; si la base de datos queda lejos, todo irá más lento.
4. Acepta los valores propuestos y conéctala a tu proyecto en todos los entornos.

Esto crea sola la variable `DATABASE_URL`. No hay que crear tablas a mano: la tienda las crea la primera vez que alguien entra.

## 3. Conectar el almacén de fotos y videos (Vercel Blob)

1. En el mismo apartado **Storage**, elige **Create Database** (o **Create Storage**) y selecciona **Blob**.
2. En el acceso elige **Public**.
3. **Marca la casilla "Add a read-write token env var to this connection".** Sin ella no se pueden subir archivos desde el navegador.
4. Crea el almacén y conéctalo a tu proyecto.

Esto crea la variable `BLOB_READ_WRITE_TOKEN`.

## 4. Volver a desplegar

Las variables nuevas solo valen para despliegues nuevos. Haz doble clic otra vez en **`desplegar.bat`**.

## 5. Crear tu cuenta antes que nadie

Abre la dirección de tu tienda y **crea tu usuario de inmediato**: la primera cuenta que se crea queda como administradora (puede borrar cualquier cosa y suspender usuarios). Guarda el código de acceso que te muestra.

Si quieres dar permisos de moderación a más personas, en Vercel ve a **Settings > Environment Variables** y crea `ADMINS` con los nombres de usuario separados por comas (por ejemplo `maria,pedro`). Luego vuelve a desplegar.

## 6. Revisión rápida (hazla la primera vez)

Esta versión se probó a fondo en un entorno que imita a Vercel, pero no en tu cuenta real. Comprueba estas cinco cosas:

1. **Publicar algo con una foto.** Si falla la subida, revisa el paso 3 (casilla del token y acceso *Public*).
2. **Subir un video de más de 5 MB** en el chat de esa publicación.
3. **Abrir la misma publicación en dos navegadores** (o en el teléfono) y escribir en uno: el mensaje debe aparecer en el otro en un segundo o dos, sin recargar.
4. **Dejar el chat abierto 6 minutos** y escribir desde el otro navegador: debe seguir llegando (la conexión se renueva sola cada 4 minutos y medio).
5. **Borrar un mensaje con foto** y comprobar que desaparece en los dos lados.

Si algo de esto falla, en Vercel abre tu proyecto > **Logs** y copia el error.

## Opcional

- **Proteger la limpieza diaria.** En **Settings > Environment Variables** crea `CRON_SECRET` con un texto largo cualquiera. Vercel lo usará para llamar a la limpieza y nadie más podrá dispararla.
- **Dominio propio.** En **Settings > Domains**.
- **Desplegar desde GitHub.** Si subes esta carpeta a un repositorio y lo importas en Vercel, cada cambio que subas se publica solo y no necesitas `desplegar.bat`.

## Cambiar el nombre de la tienda u otros ajustes

Abre `config.js` con el Bloc de notas, cambia lo que quieras y vuelve a ejecutar `desplegar.bat`.
