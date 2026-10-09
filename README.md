# 🏈 Liga de Papa Tocheros

App web para administrar la liga: **registro de jugadores con foto**, **rosters por equipo** y **tabla de posiciones**.

- **Link de registro**: compartes un link por equipo (WhatsApp), cada jugador llena su ficha.
- **Admin**: creas equipos, copias los links y capturas los resultados de los juegos.
- **Público**: cualquiera con el link de la liga ve la tabla de posiciones y los rosters.

## Correr en tu computadora

Requiere Node 24+.

```bash
npm install
npm start
```

Abre http://localhost:3000. La primera vez imprime en la terminal la **contraseña de admin** (o la fijas con `ADMIN_TOKEN`). Guarda esa contraseña: entra a `/admin` con ella.

## Cómo se usa

1. Entra a `/admin` con la contraseña.
2. Crea un equipo → se genera un **link de registro** único.
3. Manda ese link al equipo por WhatsApp. Cada jugador pone nombre, número de jersey, fecha de nacimiento y su foto (se sube desde el celular y se comprime sola).
4. Cuando terminen, en el admin registrarás cada juego (local vs visitante y el marcador). La **tabla de posiciones** se actualiza sola.
5. Comparte la página principal (`/`) para que todos vean puntos y resultados.

## Subir a la nube (Railway, gratis)

1. Sube esta carpeta a un repositorio de GitHub.
2. En https://railway.app → **New Project → Deploy from GitHub repo**.
3. En el servicio, pestaña **Variables**: agrega `ADMIN_TOKEN` con tu contraseña. Agrega también `DATA_DIR` = `/data`.
4. Pestaña **Volumes**: crea un volumen montado en `/data` (así no se borran jugadores ni fotos al actualizar).
5. Railway te da una URL pública (ej. `mi-liga.up.railway.app`). Esa es la liga. Los links de registro empiezan con esa URL.

## Estructura

- `server.js` — rutas y servidor Express
- `db.js` — base de datos SQLite (`node:sqlite`, sin dependencias nativas)
- `templates.js` — páginas HTML
- `public/style.css` — estilos
- Datos y fotos en `DATA_DIR` (por defecto la raíz del proyecto)
