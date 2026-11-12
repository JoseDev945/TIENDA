# Plan de la tienda

Qué se construyó, por qué se decidió así y qué falta. Lo marcado con ✅ ya funciona y está probado.

## 1. Qué es

Un marketplace entre personas (como Facebook Marketplace) con una diferencia: **cada publicación tiene un chat público** donde cualquiera opina, pregunta u oferta a la vista de todos, al estilo de un canal de Discord.

## 2. Cuentas: solo un nombre de usuario

- ✅ Para registrarse solo se pide un **nombre de usuario**. Sin correo, sin contraseña.
- ✅ Es **único e irrepetible**: no distingue mayúsculas (`Jose` y `jose` son el mismo), y la base de datos lo garantiza aunque dos personas lo pidan a la vez.
- ✅ Reglas: 3 a 20 caracteres, letras sin tilde, números, punto, guion y guion bajo. Sin espacios. Así se evitan nombres casi idénticos hechos con letras raras para hacerse pasar por otro.
- ✅ Nombres reservados (`admin`, `soporte`, `moderador`, el nombre de la tienda…) para que nadie se haga pasar por el equipo.
- ✅ El formulario avisa al instante si el nombre está libre u ocupado.

**El problema de no tener contraseña y cómo se resolvió.** Si entrar fuera solo escribir el nombre, cualquiera podría entrar como otra persona. Solución:
- El navegador donde creas el usuario queda con la sesión abierta (dura un año).
- Al crear el usuario se muestra **una sola vez** un **código de acceso** (`XXXX-XXXX-XXXX`). Sirve para entrar desde otro dispositivo o si se borran los datos del navegador.
- Desde el perfil se puede generar un código nuevo; el anterior deja de servir y se cierran las demás sesiones.
- **Limitación a tener presente:** quien pierde el código *y* la sesión pierde el usuario, porque no hay correo para recuperarlo. Nadie más podrá usar ese nombre.

## 3. Marketplace

- ✅ Publicar con hasta 10 fotos o videos, título, precio, categoría, estado, ubicación y descripción.
- ✅ Dos tipos de publicación: **Vendo** y **Busco** (el "WTS / WTB" de los grupos de compraventa).
- ✅ Precio flexible: un número, **Gratis** (0) o **A convenir** (vacío).
- ✅ Inicio en cuadrícula con búsqueda (ignora tildes), 13 categorías, filtro de precio y de ubicación, y orden por fecha o precio.
- ✅ Página de cada publicación con galería, datos, vendedor y el chat al lado.
- ✅ El dueño puede editar, marcar como vendido, volver a publicar y eliminar.
- ✅ Guardar publicaciones, copiar enlace, perfil público de cada vendedor con foto y descripción.
- ✅ Mensajes privados comprador–vendedor (el "PM"), con aviso y contador de no leídos.
- ✅ Modo claro y oscuro. Funciona en teléfono y computadora.

## 4. El chat de cada publicación

- ✅ **En vivo:** los mensajes aparecen sin recargar, con contador de "personas viendo ahora".
- ✅ **Se puede mandar de todo:** texto, emojis, fotos, GIF, videos, audios y cualquier archivo (PDF, ZIP…). Hasta 10 adjuntos por mensaje.
- ✅ Tres formas de adjuntar: botón, **arrastrar y soltar**, y **pegar** una captura con Ctrl+V.
- ✅ Selector de emojis, **reacciones** a cada mensaje y a la publicación.
- ✅ **Responder** citando un mensaje, enlaces que se pueden pulsar, visor de fotos a pantalla completa.
- ✅ Etiqueta "Vendedor" junto a quien publicó. El vendedor ve cuántos mensajes nuevos tiene cada publicación suya.
- ✅ Leer es libre; para escribir hay que tener usuario.

## 5. Cosas que había que tomar en cuenta

### "Mandar de todo" es la parte más delicada
| Riesgo | Qué se hizo |
| --- | --- |
| Subir un archivo dañino disfrazado de foto | ✅ El servidor mira el **contenido real** del archivo, no su nombre. Solo fotos, videos y audios reconocidos se muestran; todo lo demás se entrega como **descarga** y nunca se ejecuta en la página. |
| Llenar el almacén | ✅ Límite de 100 MB por archivo y 15 MB por foto (configurable). Las fotos grandes se reducen en el teléfono antes de subir. Lo que se sube y no se publica se borra solo a las 24 h. |
| Fotos de iPhone (HEIC) que no se ven en otros equipos | ✅ Se convierten a JPG al subir. |
| Código malicioso escrito en un mensaje | ✅ Todo el texto se muestra como texto, nunca como código. El navegador además tiene bloqueado ejecutar scripts ajenos. |

### Spam y abuso
- ✅ Límites por usuario: mensajes (10 cada 10 s), subidas, publicaciones, reacciones, cuentas nuevas por conexión e intentos de entrar con código.
- ✅ **Reportar** publicaciones, mensajes y usuarios.
- ✅ **Moderación:** el vendedor puede borrar mensajes del chat de sus publicaciones. Los administradores pueden borrar cualquier cosa, ver los reportes y suspender cuentas. Al borrar algo también se borran sus archivos.
- ✅ La primera cuenta creada es administradora; se pueden añadir más en `config.js` o en la variable `ADMINS` de Vercel.

### Privacidad y seguridad
- ✅ Los privados solo los pueden leer sus dos participantes (probado que un tercero no puede).
- ✅ La sesión viaja en una cookie que el código de la página no puede leer, y el servidor rechaza peticiones hechas desde otros sitios.
- ✅ Los códigos de acceso y las sesiones se guardan cifrados (hash), no en texto legible.
- ✅ Aviso de seguridad al comprador en cada publicación (lugar público, no pagar por adelantado).

### Lo técnico (versión para Vercel + Neon)
- ✅ **Base de datos en Neon (Postgres).** Las tablas se crean solas la primera vez que alguien entra.
- ✅ **Fotos, videos y archivos en Vercel Blob.** El navegador los sube directo al almacén, así no aplica el límite de 4,5 MB de Vercel. Después el servidor comprueba que el archivo existe, que lo subió ese usuario, cuánto pesa y qué es en realidad.
- ✅ **Chat en vivo sin servicios extra.** En Vercel puede haber varias copias del servidor a la vez y no comparten memoria. Por eso cada aviso (mensaje, reacción, borrado) se guarda en una tabla de la base de datos y cada copia con gente conectada la revisa una vez por segundo. Demora típica de entrega: menos de un segundo.
- ✅ **Los límites anti-spam también van en la base de datos**, para que valgan entre todas las copias.
- ✅ **Limpieza diaria automática** (Vercel Cron): borra archivos subidos que nunca se publicaron y avisos viejos.
- ✅ La conexión en vivo solo se abre en pantallas con chat y con la pestaña a la vista, para gastar menos.
- ✅ Tres librerías: `pg` (base de datos), `@vercel/blob` (archivos) y `@vercel/functions`. Vercel las instala solo al desplegar.

### Qué se probó y qué no
- ✅ Contra un Postgres real (versión 16): 96 comprobaciones del servidor y un recorrido completo en navegador con dos usuarios a la vez y en teléfono.
- ✅ Simulando Vercel con tres copias separadas del servidor: los mensajes, reacciones y el contador "viendo ahora" llegan de una copia a otra; una ráfaga de mensajes simultáneos llega completa y sin repetidos.
- ✅ La subida directa a Blob (incluida la subida por partes de archivos grandes, el borrado y la limpieza) contra un **doble de pruebas** que imita la API de Vercel Blob, usando la librería oficial en el navegador y en el servidor.
- ⚠️ **No se pudo probar en Vercel, Neon y Blob de verdad**, porque requiere tu cuenta. Lo primero tras desplegar es hacer la revisión de `DESPLEGAR.md` (paso 6).

## 6. Lo que falta para abrirla al público

El despliegue está explicado paso a paso en `DESPLEGAR.md`. Además del despliegue:

1. **Dominio propio** (opcional). Vercel te da una dirección `tu-proyecto.vercel.app` con HTTPS; un dominio propio cuesta unos 12 USD al año.
2. **Plan de Vercel.** Revisa las condiciones del plan gratuito (Hobby): según recuerdo es solo para uso personal no comercial, así que una tienda con fines comerciales probablemente necesite el plan Pro. Confírmalo en vercel.com/pricing.
3. **Copias de seguridad.** Neon guarda historial para restaurar la base de datos; revisa cuántos días incluye tu plan.
4. **Textos legales:** términos de uso, política de privacidad y lista de artículos prohibidos. Conviene que los revise alguien que conozca las leyes de tu país.
5. **Plan de moderación:** decidir quién revisa los reportes y cada cuánto. Con fotos y videos abiertos al público esto no es opcional.

## 7. Limitaciones conocidas y mejoras posibles

- **Costo del chat en vivo.** Mientras alguien tenga un chat abierto, hay una función de Vercel activa y la base de datos Neon no se duerme. Con poco tráfico entra en los planes gratuitos; si la tienda crece, vigila el consumo en los paneles de Vercel y Neon. Si llegara a pesar, el siguiente paso es un servicio de mensajería en vivo (Redis o similar).
- **La conexión en vivo se renueva sola cada 4 minutos y medio**, porque Vercel corta las conexiones largas. El chat se pone al día al reconectar; no se pierde nada.
- **Los archivos en Blob son públicos por su dirección.** La dirección es larga e imposible de adivinar, pero quien la tenga puede ver el archivo sin iniciar sesión, también los adjuntos de mensajes privados. Es lo habitual en este tipo de almacenes.
- **Videos:** se guardan tal como se suben. Algunos formatos (por ejemplo ciertos `.mov` de iPhone) pueden no reproducirse en todos los navegadores.
- **Buscador de GIF:** se pueden subir GIF propios; un buscador tipo Tenor/Giphy necesita registrarse con ellos para obtener una clave.
- **Avisos fuera de la página:** los avisos de mensajes nuevos aparecen mientras estás en una pantalla con chat; en las demás, el contador se actualiza al navegar y cada minuto. Notificaciones al teléfono con la página cerrada serían un siguiente paso.
- **Pagos:** la tienda conecta a las personas; el pago y la entrega los acuerdan entre ellas, igual que en Facebook Marketplace.
- **Ideas:** notas de voz, valoraciones de vendedores, mapa por zona, publicaciones destacadas, eliminar la propia cuenta.
