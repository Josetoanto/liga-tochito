const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const db = new DatabaseSync(path.join(DATA_DIR, 'liga.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS tournaments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  roster_deadline TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  logo TEXT,
  UNIQUE(tournament_id, name)
);
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  jersey INTEGER NOT NULL,
  birth_date TEXT NOT NULL,
  photo TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(team_id, jersey)
);
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  home_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  away_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  home_score INTEGER NOT NULL,
  away_score INTEGER NOT NULL,
  played_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

const uid = () => crypto.randomUUID();
const DEFAULT_TOURNAMENT = 'Liga de Papa Tocheros';

const slugify = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'torneo';

const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

// Migración: bases existentes de una sola liga -> torneos múltiples.
const migrate = () => {
  let first = db.prepare('SELECT * FROM tournaments ORDER BY rowid LIMIT 1').get();
  const legacyDeadline = db.prepare("SELECT value FROM settings WHERE key = 'roster_deadline'").get()?.value ?? null;

  if (!first) {
    const id = uid();
    db.prepare('INSERT INTO tournaments (id, name, slug, roster_deadline) VALUES (?, ?, ?, ?)')
      .run(id, DEFAULT_TOURNAMENT, 'papa-tocheros', legacyDeadline);
    first = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
  } else if (legacyDeadline && !first.roster_deadline) {
    db.prepare('UPDATE tournaments SET roster_deadline = ? WHERE id = ?').run(legacyDeadline, first.id);
  }

  if (!columns('teams').includes('tournament_id')) {
    const oldTeams = db.prepare('SELECT * FROM teams').all();
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec(`
        CREATE TABLE teams_new (
          id TEXT PRIMARY KEY,
          tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          token TEXT NOT NULL UNIQUE,
          logo TEXT,
          UNIQUE(tournament_id, name)
        );
      `);
      const insert = db.prepare('INSERT INTO teams_new (id, tournament_id, name, token, logo) VALUES (?, ?, ?, ?, ?)');
      for (const team of oldTeams) insert.run(team.id, first.id, team.name, team.token, team.logo ?? null);
      db.exec('DROP TABLE teams');
      db.exec('ALTER TABLE teams_new RENAME TO teams');
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }

  if (!columns('teams').includes('logo')) db.exec('ALTER TABLE teams ADD COLUMN logo TEXT');

  if (!columns('games').includes('tournament_id')) {
    db.exec('ALTER TABLE games ADD COLUMN tournament_id TEXT REFERENCES tournaments(id) ON DELETE CASCADE');
  }
  db.exec(`
    UPDATE games SET tournament_id = (SELECT tournament_id FROM teams WHERE teams.id = games.home_id)
    WHERE tournament_id IS NULL
  `);

  db.exec('CREATE INDEX IF NOT EXISTS idx_teams_tournament ON teams(tournament_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_games_tournament ON games(tournament_id)');
  db.exec("DELETE FROM settings WHERE key = 'roster_deadline'");
};
migrate();

exports.createTournament = (name) => {
  const clean = name.trim();
  const id = uid();
  const base = slugify(clean);
  let slug = base;
  for (let i = 2; db.prepare('SELECT 1 FROM tournaments WHERE slug = ?').get(slug); i++) slug = `${base}-${i}`;
  db.prepare('INSERT INTO tournaments (id, name, slug) VALUES (?, ?, ?)').run(id, clean, slug);
  return db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
};
exports.listTournaments = () => db.prepare(`
  SELECT t.*, (SELECT COUNT(*) FROM teams tm WHERE tm.tournament_id = t.id) AS team_count
  FROM tournaments t ORDER BY t.created_at, t.rowid
`).all();
exports.getTournament = (id) => db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
exports.getTournamentBySlug = (slug) => db.prepare('SELECT * FROM tournaments WHERE slug = ?').get(slug);
exports.setTournamentDeadline = (id, value) =>
  db.prepare('UPDATE tournaments SET roster_deadline = ? WHERE id = ?').run(value, id);

exports.createTeam = (tournamentId, name) => {
  const team = { id: uid(), tournament_id: tournamentId, name: name.trim(), token: uid() };
  db.prepare('INSERT INTO teams (id, tournament_id, name, token) VALUES (?, ?, ?, ?)')
    .run(team.id, team.tournament_id, team.name, team.token);
  return team;
};
exports.listTeams = (tournamentId) =>
  db.prepare('SELECT * FROM teams WHERE tournament_id = ? ORDER BY name').all(tournamentId);
exports.getTeamByToken = (token) => db.prepare('SELECT * FROM teams WHERE token = ?').get(token);
exports.getTeam = (id) => db.prepare('SELECT * FROM teams WHERE id = ?').get(id);
exports.setTeamLogo = (id, logo) => db.prepare('UPDATE teams SET logo = ? WHERE id = ?').run(logo, id);
exports.deleteTeam = (id) => db.prepare('DELETE FROM teams WHERE id = ?').run(id);

exports.addPlayer = ({ teamId, name, jersey, birthDate, photo }) => {
  const id = uid();
  db.prepare('INSERT INTO players (id, team_id, name, jersey, birth_date, photo) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, teamId, name.trim(), jersey, birthDate, photo || null);
  return id;
};
exports.listPlayers = (teamId) =>
  db.prepare('SELECT * FROM players WHERE team_id = ? ORDER BY jersey').all(teamId);
exports.deletePlayer = (id) => db.prepare('DELETE FROM players WHERE id = ?').run(id);

exports.addGame = ({ tournamentId, homeId, awayId, homeScore, awayScore, playedAt }) => {
  const id = uid();
  db.prepare('INSERT INTO games (id, tournament_id, home_id, away_id, home_score, away_score, played_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, tournamentId, homeId, awayId, homeScore, awayScore, playedAt || new Date().toISOString().slice(0, 16).replace('T', ' '));
  return id;
};
exports.deleteGame = (id) => db.prepare('DELETE FROM games WHERE id = ?').run(id);
exports.getGame = (id) => db.prepare('SELECT * FROM games WHERE id = ?').get(id);
exports.updateGame = (id, { homeId, awayId, homeScore, awayScore, playedAt }) =>
  db.prepare('UPDATE games SET home_id = ?, away_id = ?, home_score = ?, away_score = ?, played_at = ? WHERE id = ?')
    .run(homeId, awayId, homeScore, awayScore, playedAt || new Date().toISOString().slice(0, 16).replace('T', ' '), id);

exports.standings = (tournamentId) => {
  const teams = exports.listTeams(tournamentId);
  const rows = db.prepare(`
    SELECT t.id, t.name, t.logo,
      SUM(CASE WHEN g.home_id = t.id THEN 1 WHEN g.away_id = t.id THEN 1 ELSE 0 END) AS jj,
      SUM(CASE WHEN (g.home_id = t.id AND g.home_score > g.away_score) OR (g.away_id = t.id AND g.away_score > g.home_score) THEN 1 ELSE 0 END) AS jg,
      SUM(CASE WHEN (g.home_id = t.id AND g.home_score < g.away_score) OR (g.away_id = t.id AND g.away_score < g.home_score) THEN 1 ELSE 0 END) AS jp,
      SUM(CASE WHEN g.home_id = t.id THEN g.home_score WHEN g.away_id = t.id THEN g.away_score ELSE 0 END) AS pf,
      SUM(CASE WHEN g.home_id = t.id THEN g.away_score WHEN g.away_id = t.id THEN g.home_score ELSE 0 END) AS pc
    FROM teams t LEFT JOIN games g ON (g.home_id = t.id OR g.away_id = t.id) AND g.tournament_id = t.tournament_id
    WHERE t.tournament_id = ?
    GROUP BY t.id
  `).all(tournamentId);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return teams
    .map((t) => byId.get(t.id))
    .sort((a, b) => {
      const da = (a.pf || 0) - (a.pc || 0);
      const dbd = (b.pf || 0) - (b.pc || 0);
      return dbd - da || b.pf - a.pf || a.name.localeCompare(b.name);
    });
};

exports.recentGames = (tournamentId, limit = 50) =>
  db.prepare(`
    SELECT g.*, ht.name AS home_name, at.name AS away_name
    FROM games g
    JOIN teams ht ON ht.id = g.home_id
    JOIN teams at ON at.id = g.away_id
    WHERE g.tournament_id = ?
    ORDER BY g.played_at DESC, g.rowid DESC
    LIMIT ?
  `).all(tournamentId, limit);

module.exports = exports;
