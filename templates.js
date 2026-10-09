const layout = (title, body, extra = '') => `
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Liga Tochito Banderola</title>
<link rel="stylesheet" href="/style.css">
${extra}
</head>
<body>
<header class="topbar">
  <a href="/" class="brand">🏈 Liga Tochito Banderola</a>
  <nav><a href="/admin">Admin</a></nav>
</header>
<main>${body}</main>
<footer>Hecho con cariño para la liga</footer>
</body>
</html>`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (jj, jg) => (jj ? (jg / jj).toFixed(3).replace(/^0\./, '.') : '.000');

exports.home = (standings, games, teams) => layout('Tabla de posiciones', `
<section>
  <h2>Tabla de posiciones</h2>
  ${standings.length ? `
  <div class="table-wrap"><table>
    <thead><tr><th>#</th><th>Equipo</th><th>JJ</th><th>JG</th><th>JP</th><th>PF</th><th>PC</th><th>%</th><th></th></tr></thead>
    <tbody>
      ${standings.map((t, i) => `<tr>
        <td>${i + 1}</td>
        <td><strong>${esc(t.name)}</strong></td>
        <td>${t.jj || 0}</td><td>${t.jg || 0}</td><td>${t.jp || 0}</td>
        <td>${t.pf || 0}</td><td>${t.pc || 0}</td>
        <td>${pct(t.jj, t.jg || 0)}</td>
        <td><a href="/team/${t.id}">Roster →</a></td>
      </tr>`).join('')}
    </tbody>
  </table></div>` : '<p class="muted">Aún no hay equipos en la liga.</p>'}
</section>

<section>
  <h2>Últimos resultados</h2>
  ${games.length ? `<ul class="games">
    ${games.map((g) => `<li class="game">
      <span class="game-date">${esc(g.played_at)}</span>
      <span class="game-teams">${esc(g.home_name)} <b>${g.home_score}</b> — <b>${g.away_score}</b> ${esc(g.away_name)}</span>
    </li>`).join('')}
  </ul>` : '<p class="muted">Aún no hay juegos registrados.</p>'}
</section>

<section>
  <h2>Equipos</h2>
  ${teams.length ? `<div class="cards">
    ${teams.map((t) => `<a class="card" href="/team/${t.id}"><span class="card-emoji">🛡️</span>${esc(t.name)}</a>`).join('')}
  </div>` : '<p class="muted">Pide al admin que cree tu equipo.</p>'}
</section>
`);

exports.registerForm = (team, error = '') => layout(`Registro · ${team.name}`, `
<section class="narrow">
  <h2>Regístrate en <span class="accent">${esc(team.name)}</span></h2>
  <p class="muted">Llena tus datos y sube una foto. El número de jersey queda reservado para ti.</p>
  ${error ? `<p class="error">${esc(error)}</p>` : ''}
  <form method="post" enctype="multipart/form-data" id="reg-form">
    <label>Nombre completo
      <input name="name" required maxlength="80" placeholder="Juan Pérez">
    </label>
    <label>Número de jersey
      <input name="jersey" type="number" required min="0" max="99" inputmode="numeric" placeholder="7">
    </label>
    <label>Fecha de nacimiento
      <input name="birth_date" type="date" required>
    </label>
    <label>Foto
      <input name="photo" type="file" accept="image/*" capture="user" id="photo-input">
    </label>
    <div id="photo-preview" class="preview hidden"><img alt="Vista previa"><button type="button" id="photo-clear">Quitar foto</button></div>
    <button type="submit">Registrar</button>
  </form>
</section>
<script>
const input = document.getElementById('photo-input');
const preview = document.getElementById('photo-preview');
const form = document.getElementById('reg-form');
let compressedBlob = null;

input.addEventListener('change', () => {
  const file = input.files[0];
  if (!file) { preview.classList.add('hidden'); compressedBlob = null; return; }
  const img = new Image();
  img.onload = () => {
    const max = 600;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      compressedBlob = blob;
      preview.querySelector('img').src = URL.createObjectURL(blob);
      preview.classList.remove('hidden');
    }, 'image/jpeg', 0.8);
  };
  img.src = URL.createObjectURL(file);
});

document.getElementById('photo-clear').addEventListener('click', () => {
  input.value = ''; compressedBlob = null; preview.classList.add('hidden');
});

form.addEventListener('submit', (e) => {
  if (!compressedBlob) return;
  e.preventDefault();
  const data = new FormData(form);
  if (compressedBlob) data.set('photo', compressedBlob, 'foto.jpg');
  fetch(form.action, { method: 'POST', body: data })
    .then((r) => { if (r.ok) window.location.href = '/listo'; else return r.text().then(t => { throw new Error(t); }); })
    .catch((err) => alert('Error: ' + err.message));
});
</script>
`);

exports.registerDone = () => layout('Registro completo', `
<section class="narrow center">
  <div class="big-emoji">✅</div>
  <h2>¡Registro completo!</h2>
  <p>Tu ficha ya está en el roster del equipo. Nos vemos en el campo.</p>
  <p><a class="btn-link" href="/">Ver tabla de posiciones</a></p>
</section>
`);

exports.teamRoster = (team, players) => layout(`Roster · ${team.name}`, `
<section>
  <h2><span class="accent">${esc(team.name)}</span></h2>
  <p class="muted">${players.length} jugador${players.length === 1 ? '' : 'es'} registrado${players.length === 1 ? '' : 's'}</p>
  ${players.length ? `<div class="roster">
    ${players.map((p) => `<div class="player">
      <div class="jersey">${p.jersey}</div>
      ${p.photo ? `<img src="/uploads/${esc(p.photo)}" alt="${esc(p.name)}" loading="lazy">` : '<div class="photo-placeholder">🏈</div>'}
      <div class="player-name">${esc(p.name)}</div>
    </div>`).join('')}
  </div>` : '<p class="muted">Aún no hay jugadores registrados en este equipo.</p>'}
  <p><a href="/">← Volver a la liga</a></p>
</section>
`);

exports.adminLogin = (error = '') => layout('Admin', `
<section class="narrow">
  <h2>Panel de la liga</h2>
  ${error ? `<p class="error">${esc(error)}</p>` : ''}
  <form method="post" action="/admin/login">
    <label>Contraseña
      <input name="token" type="password" required autofocus>
    </label>
    <button type="submit">Entrar</button>
  </form>
</section>
`);

exports.adminDashboard = (teams, standings, games) => layout('Admin · Liga', `
<section>
  <h2>Equipos</h2>
  <form method="post" action="/admin/teams" class="inline-form">
    <input name="name" required maxlength="60" placeholder="Nombre del nuevo equipo">
    <button type="submit">Crear equipo</button>
  </form>
  ${teams.length ? `<div class="table-wrap"><table>
    <thead><tr><th>Equipo</th><th>Jugadores</th><th>Link de registro</th><th></th></tr></thead>
    <tbody>
      ${teams.map((t) => `<tr>
        <td><strong>${esc(t.name)}</strong></td>
        <td>${t.count}</td>
        <td class="link-cell">
          <input readonly value="${esc(t.regUrl)}" onclick="this.select();navigator.clipboard&&navigator.clipboard.writeText(this.value)">
          <button type="button" class="small" onclick="navigator.clipboard.writeText('${esc(t.regUrl)}').then(()=>this.textContent='Copiado ✓',()=>{this.previousElementSibling.select()})">Copiar</button>
          <a class="small" href="/r/${esc(t.token)}">Abrir</a>
          <a class="small" href="/team/${t.id}">Roster</a>
        </td>
        <td><form method="post" action="/admin/teams/${t.id}?_method=DELETE" onsubmit="return confirm('Borrar equipo ${esc(t.name)} y todo su roster?')"><button type="submit" class="danger small">Borrar</button></form></td>
      </tr>`).join('')}
    </tbody>
  </table></div>` : '<p class="muted">Crea el primer equipo para generar su link de registro.</p>'}
</section>

<section>
  <h2>Registrar resultado</h2>
  ${teams.length >= 2 ? `
  <form method="post" action="/admin/games" class="inline-form wrap">
    <label>Local <select name="home_id" required>${teams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>
    <input name="home_score" type="number" required min="0" class="score" placeholder="0">
    <span class="vs">vs</span>
    <input name="away_score" type="number" required min="0" class="score" placeholder="0">
    <label><select name="away_id" required>${teams.map((t, i) => `<option value="${t.id}" ${i === 1 ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select> Visitante</label>
    <label>Fecha <input name="played_at" type="datetime-local"></label>
    <button type="submit">Guardar resultado</button>
  </form>` : '<p class="muted">Necesitas al menos 2 equipos.</p>'}

  ${games.length ? `<div class="table-wrap"><table>
    <thead><tr><th>Fecha</th><th>Resultado</th><th></th></tr></thead>
    <tbody>
      ${games.map((g) => `<tr>
        <td>${esc(g.played_at)}</td>
        <td>${esc(g.home_name)} <b>${g.home_score}</b> — <b>${g.away_score}</b> ${esc(g.away_name)}</td>
        <td><form method="post" action="/admin/games/${g.id}?_method=DELETE" onsubmit="return confirm('Borrar este juego?')"><button type="submit" class="danger small">Borrar</button></form></td>
      </tr>`).join('')}
    </tbody>
  </table></div>` : ''}
</section>

<section>
  <h2>Posiciones (vista del público)</h2>
  <p><a href="/">Ver tabla pública →</a></p>
</section>

<form method="post" action="/admin/logout"><button type="submit" class="small">Cerrar sesión</button></form>
`);

module.exports = exports;
