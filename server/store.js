"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const BACKUP_FILE = path.join(DATA_DIR, "db.json.bak");

function ensureStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) writeDb({ users: [], transactions: [], budgets: [], goals: [], wallets: [], recurring: [], bills: [], pushSubscriptions: [], pushPreferences: [], pushSent: [], wishlist: [] });
}
function readDb() {
  ensureStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    if (!parsed || !Array.isArray(parsed.users) || !Array.isArray(parsed.transactions)) {
      throw new Error("Struktur database tidak valid.");
    }
    // Backward-compatible schema extension for existing installations.
    if (!Array.isArray(parsed.budgets)) parsed.budgets = [];
    for (const key of ["pushSubscriptions", "pushPreferences", "pushSent"]) if (!Array.isArray(parsed[key])) parsed[key] = [];
    if (!Array.isArray(parsed.goals)) parsed.goals = [];
    for (const key of ["wallets", "recurring", "bills", "wishlist"]) if (!Array.isArray(parsed[key])) parsed[key] = [];
    return parsed;
  } catch (error) {
    if (fs.existsSync(BACKUP_FILE)) {
      const backup = JSON.parse(fs.readFileSync(BACKUP_FILE, "utf8"));
      if (Array.isArray(backup.users) && Array.isArray(backup.transactions)) {
        if (!Array.isArray(backup.budgets)) backup.budgets = [];
        for (const key of ["pushSubscriptions", "pushPreferences", "pushSent"]) if (!Array.isArray(backup[key])) backup[key] = [];
        if (!Array.isArray(backup.goals)) backup.goals = [];
        for (const key of ["wallets", "recurring", "bills", "wishlist"]) if (!Array.isArray(backup[key])) backup[key] = [];
        return backup;
      }
    }
    throw new Error("Database JSON rusak atau tidak valid: " + error.message);
  }
}
function writeDb(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = DB_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), "utf8");
  if (fs.existsSync(DB_FILE)) fs.copyFileSync(DB_FILE, BACKUP_FILE);
  fs.renameSync(temp, DB_FILE);
}
async function seedAdmin() {
  const db = readDb();
  if (!db.users.some(u => u.username === "ditzz")) {
    db.users.push({
      id: "usr_" + Date.now().toString(36),
      username: "ditzz",
      passwordHash: await bcrypt.hash("ditzz", 12),
      name: "DITZZ",
      createdAt: new Date().toISOString()
    });
    writeDb(db);
  }
}
module.exports = { readDb, writeDb, seedAdmin };
