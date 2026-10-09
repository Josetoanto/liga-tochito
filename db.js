const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const db = new DatabaseSync(path.join(DATA_DIR, 'liga.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL UNIQUE
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

// Migración: agrega la columna del logo si falta (bases de datos ya existentes)
if (!db.prepare('PRAGMA table_info(teams)').all().some((c) => c.name === 'logo')) {
  db.exec('ALTER TABLE teams ADD COLUMN logo TEXT');
}

const uid = () => crypto.randomUUID();

exports.createTeam = (name) => {
  const team = { id: uid(), name: name.trim(), token: uid() };
  db.prepare('INSERT INTO teams (id, name, token) VALUES (?, ?, ?)').run(team.id, team.name, team.token);
  return team;
};
exports.listTeams = () => db.prepare('SELECT * FROM teams ORDER BY name').all();
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

exports.addGame = ({ homeId, awayId, homeScore, awayScore, playedAt }) => {
  const id = uid();
  db.prepare('INSERT INTO games (id, home_id, away_id, home_score, away_score, played_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, homeId, awayId, homeScore, awayScore, playedAt || new Date().toISOString().slice(0, 16).replace('T', ' '));
  return id;
};
exports.deleteGame = (id) => db.prepare('DELETE FROM games WHERE id = ?').run(id);
exports.getGame = (id) => db.prepare('SELECT * FROM games WHERE id = ?').get(id);
exports.updateGame = (id, { homeId, awayId, homeScore, awayScore, playedAt }) =>
  db.prepare('UPDATE games SET home_id = ?, away_id = ?, home_score = ?, away_score = ?, played_at = ? WHERE id = ?')
    .run(homeId, awayId, homeScore, awayScore, playedAt || new Date().toISOString().slice(0, 16).replace('T', ' '), id);

exports.getSetting = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;
exports.setSetting = (key, value) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
exports.deleteSetting = (key) => db.prepare('DELETE FROM settings WHERE key = ?').run(key);

exports.standings = () => {
  const teams = exports.listTeams();
  const rows = db.prepare(`
    SELECT t.id, t.name, t.logo,
      SUM(CASE WHEN g.home_id = t.id THEN 1 WHEN g.away_id = t.id THEN 1 ELSE 0 END) AS jj,
      SUM(CASE WHEN (g.home_id = t.id AND g.home_score > g.away_score) OR (g.away_id = t.id AND g.away_score > g.home_score) THEN 1 ELSE 0 END) AS jg,
      SUM(CASE WHEN (g.home_id = t.id AND g.home_score < g.away_score) OR (g.away_id = t.id AND g.away_score < g.home_score) THEN 1 ELSE 0 END) AS jp,
      SUM(CASE WHEN g.home_id = t.id THEN g.home_score WHEN g.away_id = t.id THEN g.away_score ELSE 0 END) AS pf,
      SUM(CASE WHEN g.home_id = t.id THEN g.away_score WHEN g.away_id = t.id THEN g.home_score ELSE 0 END) AS pc
    FROM teams t LEFT JOIN games g ON g.home_id = t.id OR g.away_id = t.id
    GROUP BY t.id
  `).all();
  const byId = new Map(rows.map((r) => [r.id, r]));
  return teams
    .map((t) => byId.get(t.id))
    .sort((a, b) => {
      const pa = a.jj ? a.jg / a.jj : 0;
      const pb = b.jj ? b.jg / b.jj : 0;
      return pb - pa || b.pf - a.pf || a.name.localeCompare(b.name);
    });
};

exports.recentGames = (limit = 50) =>
  db.prepare(`
    SELECT g.*, ht.name AS home_name, at.name AS away_name
    FROM games g
    JOIN teams ht ON ht.id = g.home_id
    JOIN teams at ON at.id = g.away_id
    ORDER BY g.played_at DESC, g.rowid DESC
    LIMIT ?
  `).all(limit);

module.exports = exports;
