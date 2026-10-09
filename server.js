const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const t = require('./templates');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Admin token: env var, or generated once and persisted
let ADMIN_TOKEN = process.env.ADMIN_TOKEN;
if (!ADMIN_TOKEN) {
  const tokenFile = path.join(DATA_DIR, 'admin_token.txt');
  if (fs.existsSync(tokenFile)) ADMIN_TOKEN = fs.readFileSync(tokenFile, 'utf8').trim();
  else {
    ADMIN_TOKEN = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(tokenFile, ADMIN_TOKEN, { mode: 0o600 });
  }
  console.log(`Admin token (guárdalo, sirve para entrar a /admin): ${ADMIN_TOKEN}`);
}

const db = require('./db');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d' }));

// method override for DELETE via form
app.use((req, res, next) => {
  if (req.method === 'POST' && req.query._method) req.method = req.query._method.toUpperCase();
  next();
});

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, crypto.randomUUID() + '.jpg'),
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype.startsWith('image/'));
  },
});

const isAdmin = (req, res, next) => {
  const cookie = (req.headers.cookie || '').match(/admin_token=([^;]+)/);
  if (cookie && cookie[1] === ADMIN_TOKEN) return next();
  res.redirect('/admin');
};

// ---------- Públicas ----------
app.get('/', (req, res) => {
  res.send(t.home(db.standings(), db.recentGames(), db.listTeams()));
});

app.get('/team/:id', (req, res) => {
  const team = db.getTeam(req.params.id);
  if (!team) return res.status(404).send('Equipo no encontrado');
  res.send(t.teamRoster(team, db.listPlayers(team.id)));
});

app.get('/r/:token', (req, res) => {
  const team = db.getTeamByToken(req.params.token);
  if (!team) return res.status(404).send('Link inválido o equipo borrado');
  res.send(t.registerForm(team));
});

app.post('/r/:token', upload.single('photo'), (req, res) => {
  const team = db.getTeamByToken(req.params.token);
  if (!team) return res.status(404).send('Link inválido');
  const { name, jersey, birth_date } = req.body;
  if (!name || !birth_date || jersey === undefined || jersey === '') {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).send(t.registerForm(team, 'Faltan datos obligatorios.'));
  }
  try {
    db.addPlayer({
      teamId: team.id,
      name,
      jersey: parseInt(jersey, 10),
      birthDate: birth_date,
      photo: req.file ? req.file.filename : null,
    });
  } catch (e) {
    if (req.file) fs.unlink(req.file.path, () => {});
    if (String(e.message).includes('UNIQUE')) {
      return res.status(400).send(t.registerForm(team, `El número ${jersey} ya está tomado en este equipo. Elige otro.`));
    }
    throw e;
  }
  res.redirect('/listo');
});
app.get('/listo', (req, res) => res.send(t.registerDone()));

// ---------- Admin ----------
app.get('/admin', (req, res) => {
  const cookie = (req.headers.cookie || '').match(/admin_token=([^;]+)/);
  if (!cookie || cookie[1] !== ADMIN_TOKEN) return res.send(t.adminLogin());
  const origin = `${req.protocol}://${req.get('host')}`;
  const teams = db.listTeams().map((x) => ({ ...x, count: db.listPlayers(x.id).length, regUrl: `${origin}/r/${x.token}` }));
  res.send(t.adminDashboard(teams, db.standings(), db.recentGames()));
});

app.post('/admin/login', (req, res) => {
  if (req.body.token === ADMIN_TOKEN) {
    res.setHeader('Set-Cookie', `admin_token=${ADMIN_TOKEN}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`);
    return res.redirect('/admin');
  }
  res.send(t.adminLogin('Contraseña incorrecta.'));
});

app.post('/admin/logout', isAdmin, (req, res) => {
  res.setHeader('Set-Cookie', 'admin_token=; HttpOnly; Path=/; Max-Age=0');
  res.redirect('/');
});

app.post('/admin/teams', isAdmin, upload.single('logo'), (req, res) => {
  const name = (req.body.name || '').trim();
  if (name) {
    try {
      const team = db.createTeam(name);
      if (req.file) db.setTeamLogo(team.id, req.file.filename);
    } catch (e) {
      if (req.file) fs.unlink(req.file.path, () => {});
      if (!String(e.message).includes('UNIQUE')) throw e;
    }
  }
  res.redirect('/admin');
});

app.post('/admin/teams/:id/logo', isAdmin, upload.single('logo'), (req, res) => {
  if (req.file && db.getTeam(req.params.id)) db.setTeamLogo(req.params.id, req.file.filename);
  else if (req.file) fs.unlink(req.file.path, () => {});
  res.redirect('/admin');
});

app.delete('/admin/teams/:id', isAdmin, (req, res) => {
  db.deleteTeam(req.params.id);
  res.redirect('/admin');
});

app.post('/admin/games', isAdmin, (req, res) => {
  const { home_id, away_id, home_score, away_score, played_at } = req.body;
  if (home_id !== away_id && home_score !== '' && away_score !== '') {
    db.addGame({
      homeId: home_id,
      awayId: away_id,
      homeScore: parseInt(home_score, 10),
      awayScore: parseInt(away_score, 10),
      playedAt: played_at ? played_at.replace('T', ' ') : null,
    });
  }
  res.redirect('/admin');
});

app.delete('/admin/games/:id', isAdmin, (req, res) => {
  db.deleteGame(req.params.id);
  res.redirect('/admin');
});

app.listen(port, () => console.log(`Liga de Papa Tocheros en http://localhost:${port}`));
