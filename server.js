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

const loadTournament = (req, res, next) => {
  const tournament = db.getTournament(req.params.tid);
  if (!tournament) return res.status(404).send('Torneo no encontrado');
  req.tournament = tournament;
  next();
};

const loadTeam = (req, res, next) => {
  const team = db.getTeamByToken(req.params.token);
  if (!team) return res.status(404).send('Link inválido o equipo borrado');
  const tournament = db.getTournament(team.tournament_id);
  if (!tournament) return res.status(404).send('Torneo no encontrado');
  req.team = team;
  req.tournament = tournament;
  next();
};

const ROSTER_HOURS = 72;
const regOpen = (tournament) => tournament.roster_deadline && Date.parse(tournament.roster_deadline) > Date.now();
const requireOpen = (req, res, next) =>
  regOpen(req.tournament) ? next() : res.status(403).send(t.registrationClosed(req.tournament));

const deadlineOf = (tournament) => (tournament.roster_deadline ? new Date(tournament.roster_deadline) : null);

// ---------- Públicas ----------
app.get('/', (req, res) => {
  res.send(t.tournamentsIndex(db.listTournaments()));
});

app.get('/t/:slug', (req, res) => {
  const tournament = db.getTournamentBySlug(req.params.slug);
  if (!tournament) return res.status(404).send('Torneo no encontrado');
  res.send(t.tournament(
    tournament,
    db.standings(tournament.id),
    db.recentGames(tournament.id),
    db.listTeams(tournament.id)
  ));
});

app.get('/team/:id', (req, res) => {
  const team = db.getTeam(req.params.id);
  if (!team) return res.status(404).send('Equipo no encontrado');
  const tournament = db.getTournament(team.tournament_id);
  if (!tournament) return res.status(404).send('Torneo no encontrado');
  res.send(t.teamRoster(team, db.listPlayers(team.id), tournament));
});

app.get('/r/:token', loadTeam, requireOpen, (req, res) => {
  const success = req.query.ok ? 'Jugador registrado ✓. Registra el siguiente.' : '';
  res.send(t.registerForm(req.team, req.tournament, '', success, deadlineOf(req.tournament)));
});

app.post('/r/:token', loadTeam, requireOpen, upload.single('photo'), (req, res) => {
  const { name, jersey, birth_date } = req.body;
  const deadline = deadlineOf(req.tournament);
  if (!name || !birth_date || jersey === undefined || jersey === '') {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).send(t.registerForm(req.team, req.tournament, 'Faltan datos obligatorios.', '', deadline));
  }
  try {
    db.addPlayer({
      teamId: req.team.id,
      name,
      jersey: parseInt(jersey, 10),
      birthDate: birth_date,
      photo: req.file ? req.file.filename : null,
    });
  } catch (e) {
    if (req.file) fs.unlink(req.file.path, () => {});
    if (String(e.message).includes('UNIQUE')) {
      return res.status(400).send(t.registerForm(req.team, req.tournament, `El número ${jersey} ya está tomado en este equipo. Elige otro.`, '', deadline));
    }
    throw e;
  }
  res.redirect('/r/' + req.team.token + '?ok=1');
});

// ---------- Admin ----------
app.get('/admin', (req, res) => {
  const cookie = (req.headers.cookie || '').match(/admin_token=([^;]+)/);
  if (!cookie || cookie[1] !== ADMIN_TOKEN) return res.send(t.adminLogin());
  res.send(t.adminTournaments(db.listTournaments()));
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

app.post('/admin/tournaments', isAdmin, (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.redirect('/admin');
  const tournament = db.createTournament(name);
  res.redirect('/admin/t/' + tournament.id);
});

app.get('/admin/t/:tid', isAdmin, loadTournament, (req, res) => {
  const origin = `${req.protocol}://${req.get('host')}`;
  const teams = db.listTeams(req.tournament.id)
    .map((x) => ({ ...x, count: db.listPlayers(x.id).length, regUrl: `${origin}/r/${x.token}` }));
  const games = db.recentGames(req.tournament.id);
  const editGame = req.query.edit ? games.find((g) => g.id === req.query.edit) : null;
  res.send(t.adminDashboard(
    req.tournament,
    teams,
    db.standings(req.tournament.id),
    games,
    deadlineOf(req.tournament),
    editGame
  ));
});

app.post('/admin/t/:tid/registration/open', isAdmin, loadTournament, (req, res) => {
  db.setTournamentDeadline(req.tournament.id, new Date(Date.now() + ROSTER_HOURS * 3600 * 1000).toISOString());
  res.redirect('/admin/t/' + req.tournament.id);
});

app.post('/admin/t/:tid/registration/extend', isAdmin, loadTournament, (req, res) => {
  const deadline = req.tournament.roster_deadline;
  if (deadline && Date.parse(deadline) > Date.now()) {
    db.setTournamentDeadline(req.tournament.id, new Date(Date.parse(deadline) + 24 * 3600 * 1000).toISOString());
  }
  res.redirect('/admin/t/' + req.tournament.id);
});

app.post('/admin/t/:tid/registration/close', isAdmin, loadTournament, (req, res) => {
  db.setTournamentDeadline(req.tournament.id, null);
  res.redirect('/admin/t/' + req.tournament.id);
});

app.post('/admin/t/:tid/teams', isAdmin, loadTournament, upload.single('logo'), (req, res) => {
  const name = (req.body.name || '').trim();
  if (name) {
    try {
      const team = db.createTeam(req.tournament.id, name);
      if (req.file) db.setTeamLogo(team.id, req.file.filename);
    } catch (e) {
      if (req.file) fs.unlink(req.file.path, () => {});
      if (!String(e.message).includes('UNIQUE')) throw e;
    }
  }
  res.redirect('/admin/t/' + req.tournament.id);
});

app.post('/admin/t/:tid/teams/:teamId/logo', isAdmin, loadTournament, upload.single('logo'), (req, res) => {
  const team = db.getTeam(req.params.teamId);
  if (req.file && team && team.tournament_id === req.tournament.id) db.setTeamLogo(team.id, req.file.filename);
  else if (req.file) fs.unlink(req.file.path, () => {});
  res.redirect('/admin/t/' + req.tournament.id);
});

app.delete('/admin/t/:tid/teams/:teamId', isAdmin, loadTournament, (req, res) => {
  const team = db.getTeam(req.params.teamId);
  if (team && team.tournament_id === req.tournament.id) db.deleteTeam(team.id);
  res.redirect('/admin/t/' + req.tournament.id);
});

const gameInput = (req) => {
  const { home_id, away_id, home_score, away_score, played_at } = req.body;
  const home = db.getTeam(home_id);
  const away = db.getTeam(away_id);
  const homeScore = parseInt(home_score, 10);
  const awayScore = parseInt(away_score, 10);
  if (
    !home || !away ||
    home.tournament_id !== req.tournament.id ||
    away.tournament_id !== req.tournament.id ||
    home_id === away_id ||
    home_score === '' || away_score === '' ||
    !Number.isFinite(homeScore) || !Number.isFinite(awayScore)
  ) return null;
  return {
    homeId: home_id,
    awayId: away_id,
    homeScore,
    awayScore,
    playedAt: played_at ? played_at.replace('T', ' ') : null,
  };
};

app.post('/admin/t/:tid/games', isAdmin, loadTournament, (req, res) => {
  const input = gameInput(req);
  if (input) db.addGame({ tournamentId: req.tournament.id, ...input });
  res.redirect('/admin/t/' + req.tournament.id);
});

app.post('/admin/t/:tid/games/:id', isAdmin, loadTournament, (req, res) => {
  const game = db.getGame(req.params.id);
  const input = gameInput(req);
  if (input && game && game.tournament_id === req.tournament.id) db.updateGame(game.id, input);
  res.redirect('/admin/t/' + req.tournament.id);
});

app.delete('/admin/t/:tid/games/:id', isAdmin, loadTournament, (req, res) => {
  const game = db.getGame(req.params.id);
  if (game && game.tournament_id === req.tournament.id) db.deleteGame(game.id);
  res.redirect('/admin/t/' + req.tournament.id);
});

app.listen(port, () => console.log(`Liga de Papa Tocheros en http://localhost:${port}`));
