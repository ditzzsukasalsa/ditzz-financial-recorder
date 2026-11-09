"use strict";
const fs = require("fs");
const path = require("path");
const webpush = require("web-push");
const { readDb, writeDb } = require("./store");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const KEY_FILE = path.join(DATA_DIR, "vapid-keys.json");
const DEFAULT_PREFS = Object.freeze({
  billReminders: false,
  recurringReminders: false,
  budgetAlerts: false,
  goalAlerts: false,
  backupReminder: false,
  reminderTime: "09:00",
  billDaysBefore: 1,
  budgetThreshold: 80,
  backupWeekday: 0,
  timezone: "Asia/Jakarta"
});

function getVapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    const keys = JSON.parse(fs.readFileSync(KEY_FILE, "utf8"));
    if (keys.publicKey && keys.privateKey) return keys;
  } catch {}
  const keys = webpush.generateVAPIDKeys();
  const temp = KEY_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(keys, null, 2), { mode: 0o600 });
  fs.renameSync(temp, KEY_FILE);
  try { fs.chmodSync(KEY_FILE, 0o600); } catch {}
  return keys;
}

const vapidKeys = getVapidKeys();
webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", vapidKeys.publicKey, vapidKeys.privateKey);

function preferencesFor(db, userId) {
  const saved = db.pushPreferences.find(x => x.userId === userId);
  return { ...DEFAULT_PREFS, ...(saved || {}), billReminders: false, recurringReminders: false, budgetAlerts: false, goalAlerts: false };
}
function dateInZone(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
function timeInZone(date, timezone) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}
function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

async function sendUser(userId, payload) {
  const db = readDb();
  const rows = db.pushSubscriptions.filter(x => x.userId === userId);
  if (!rows.length) return false;
  let delivered = false, changed = false;
  for (const row of rows) {
    try {
      await webpush.sendNotification(row.subscription, JSON.stringify(payload), { TTL: 60 * 60 * 12, urgency: "normal" });
      delivered = true;
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        db.pushSubscriptions = db.pushSubscriptions.filter(x => x.id !== row.id);
        changed = true;
      } else {
        console.error("Push notification gagal:", error.statusCode || error.message);
      }
    }
  }
  if (changed) writeDb(db);
  return delivered;
}

async function sendOnce(userId, key, payload) {
  const db = readDb();
  if (db.pushSent.some(x => x.userId === userId && x.key === key)) return false;
  const delivered = await sendUser(userId, { ...payload, tag: payload.tag || key });
  if (!delivered) return false;
  const latest = readDb();
  latest.pushSent.push({ userId, key, sentAt: new Date().toISOString() });
  latest.pushSent = latest.pushSent.filter(x => Date.now() - Date.parse(x.sentAt) < 60 * 86400000);
  writeDb(latest);
  return true;
}

async function runScheduler() {
  const now = new Date();
  const db = readDb();
  const userIds = [...new Set(db.pushSubscriptions.map(x => x.userId))];
  for (const userId of userIds) {
    const prefs = preferencesFor(db, userId);
    let localDate, localTime;
    try { localDate = dateInZone(now, prefs.timezone); localTime = timeInZone(now, prefs.timezone); }
    catch { localDate = dateInZone(now, "Asia/Jakarta"); localTime = timeInZone(now, "Asia/Jakarta"); }
    if (localTime !== prefs.reminderTime) continue;

    if (prefs.billReminders) {
      for (const bill of db.bills.filter(x => x.userId === userId && !x.paid)) {
        const days = daysBetween(localDate, bill.dueDate);
        if (days >= 0 && days <= prefs.billDaysBefore) {
          await sendOnce(userId, `bill:${bill.id}:${bill.dueDate}`, { title: "Pengingat tagihan", body: `${bill.name} jatuh tempo ${days === 0 ? "hari ini" : `dalam ${days} hari`} · Rp${Number(bill.amount).toLocaleString("id-ID")}`, url: "/" });
        }
      }
    }
    if (prefs.recurringReminders) {
      for (const item of db.recurring.filter(x => x.userId === userId && x.active && x.nextDate === localDate)) {
        await sendOnce(userId, `recurring:${item.id}:${item.nextDate}`, { title: "Jadwal transaksi hari ini", body: `${item.title} · Rp${Number(item.amount).toLocaleString("id-ID")}`, url: "/" });
      }
    }
    if (prefs.budgetAlerts) {
      const month = localDate.slice(0, 7);
      for (const budget of db.budgets.filter(x => x.userId === userId && x.month === month)) {
        const used = db.transactions.filter(t => t.userId === userId && t.type === "expense" && t.date.startsWith(month) && t.category.toLowerCase() === budget.category.toLowerCase()).reduce((n, t) => n + t.amount, 0);
        if (budget.limit > 0 && used >= budget.limit * prefs.budgetThreshold / 100) {
          await sendOnce(userId, `budget:${budget.id}:${month}`, { title: "Peringatan anggaran", body: `Pengeluaran kategori ${budget.category} mencapai ${Math.round(used / budget.limit * 100)}% dari anggaran.`, url: "/" });
        }
      }
    }
    if (prefs.goalAlerts) {
      for (const goal of db.goals.filter(x => x.userId === userId && x.target > 0 && x.saved >= x.target)) {
        await sendOnce(userId, `goal:${goal.id}`, { title: "Target tabungan tercapai", body: `Selamat! Target ${goal.name} sudah tercapai.`, url: "/" });
      }
    }
    if (prefs.backupReminder && new Date(`${localDate}T00:00:00Z`).getUTCDay() === Number(prefs.backupWeekday)) {
      await sendOnce(userId, `backup:${localDate}`, { title: "Pengingat backup", body: "Saatnya mengunduh backup data DITZZ FINANCE agar catatanmu tetap aman.", url: "/" });
    }
  }
}

function startScheduler() {
  // Run on startup and then every minute. Delivery is deduplicated per event.
  runScheduler().catch(error => console.error("Push scheduler:", error.message));
  setInterval(() => runScheduler().catch(error => console.error("Push scheduler:", error.message)), 60 * 1000).unref();
}

module.exports = { vapidPublicKey: vapidKeys.publicKey, DEFAULT_PREFS, preferencesFor, sendUser, runScheduler, startScheduler };
