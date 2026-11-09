"use strict";
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
const { readDb, writeDb, seedAdmin } = require("./store");
const pushService = require("./push");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(48).toString("hex");

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "4mb" }));
app.use(session({
  name: "ditzz.sid",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 8 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, "..", "public")));
// Initialize once per warm serverless instance. On Vercel, DATA_DIR points to /tmp;
// note that /tmp is ephemeral and is NOT a persistent production database.
let initialization;
app.use(async (req, res, next) => {
  try {
    initialization ||= seedAdmin();
    await initialization;
    next();
  } catch (error) {
    initialization = null;
    console.error("Gagal menyiapkan database:", error.message);
    res.status(500).json({ message: "Server gagal menyiapkan penyimpanan." });
  }
});

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { message: "Terlalu banyak percobaan. Coba lagi beberapa menit." } });

function auth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ message: "Silakan login terlebih dahulu." });
  next();
}
function cleanText(value, max = 80) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}
function userFor(req) {
  return readDb().users.find(u => u.id === req.session.userId);
}

app.post("/api/register", loginLimiter, async (req, res) => {
  const username = cleanText(req.body.username, 40).toLowerCase();
  const name = cleanText(req.body.name, 50);
  const password = typeof req.body.password === "string" ? req.body.password : "";
  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    return res.status(400).json({ message: "Username 3–24 karakter: huruf kecil, angka, atau underscore." });
  }
  if (name.length < 2) return res.status(400).json({ message: "Nama tampilan minimal 2 karakter." });
  if (password.length < 8 || password.length > 72) {
    return res.status(400).json({ message: "Password harus 8–72 karakter." });
  }
  const db = readDb();
  if (db.users.some(u => u.username.toLowerCase() === username)) {
    return res.status(409).json({ message: "Username sudah digunakan. Silakan pilih username lain." });
  }
  const user = {
    id: "usr_" + crypto.randomUUID(),
    username,
    passwordHash: await bcrypt.hash(password, 12),
    name,
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  writeDb(db);
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ message: "Akun dibuat, tetapi sesi login gagal. Silakan login." });
    req.session.userId = user.id;
    res.status(201).json({ user: { username: user.username, name: user.name }, message: "Pendaftaran berhasil. Selamat datang!" });
  });
});

app.post("/api/login", loginLimiter, async (req, res) => {
  const username = cleanText(req.body.username, 40);
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const db = readDb();
  const user = db.users.find(u => u.username === username);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ message: "Username atau password salah." });
  }
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ message: "Gagal membuat sesi login." });
    req.session.userId = user.id;
    res.json({ user: { username: user.username, name: user.name } });
  });
});
app.post("/api/logout", auth, (req, res) => req.session.destroy(() => {
  res.clearCookie("ditzz.sid");
  res.json({ success: true });
}));
app.get("/api/me", auth, (req, res) => {
  const user = userFor(req);
  res.json({ user: { username: user.username, name: user.name } });
});
app.post("/api/change-password", auth, async (req, res) => {
  const current = typeof req.body.currentPassword === "string" ? req.body.currentPassword : "";
  const next = typeof req.body.newPassword === "string" ? req.body.newPassword : "";
  if (next.length < 8) return res.status(400).json({ message: "Password baru minimal 8 karakter." });
  const db = readDb();
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user || !(await bcrypt.compare(current, user.passwordHash))) return res.status(400).json({ message: "Password saat ini tidak sesuai." });
  user.passwordHash = await bcrypt.hash(next, 12);
  writeDb(db);
  res.json({ message: "Password berhasil diperbarui." });
});
// Push notification settings and device subscriptions.
app.get("/api/push/settings", auth, (req, res) => {
  const db = readDb();
  const prefs = pushService.preferencesFor(db, req.session.userId);
  res.json({ publicKey: pushService.vapidPublicKey, preferences: prefs, subscribed: db.pushSubscriptions.some(x => x.userId === req.session.userId), devices: db.pushSubscriptions.filter(x => x.userId === req.session.userId).length });
});
app.put("/api/push/preferences", auth, (req, res) => {
  const body = req.body || {};
  const reminderTime = typeof body.reminderTime === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.reminderTime) ? body.reminderTime : "09:00";
  const billDaysBefore = Math.max(0, Math.min(7, Number.isInteger(Number(body.billDaysBefore)) ? Number(body.billDaysBefore) : 1));
  const budgetThreshold = Math.max(50, Math.min(100, Number.isInteger(Number(body.budgetThreshold)) ? Number(body.budgetThreshold) : 80));
  const backupWeekday = Math.max(0, Math.min(6, Number.isInteger(Number(body.backupWeekday)) ? Number(body.backupWeekday) : 0));
  const prefs = {
    billReminders: body.billReminders !== false,
    recurringReminders: body.recurringReminders !== false,
    budgetAlerts: body.budgetAlerts !== false,
    goalAlerts: body.goalAlerts !== false,
    backupReminder: body.backupReminder === true,
    reminderTime, billDaysBefore, budgetThreshold, backupWeekday,
    timezone: "Asia/Jakarta"
  };
  const db = readDb();
  const existing = db.pushPreferences.find(x => x.userId === req.session.userId);
  if (existing) Object.assign(existing, prefs);
  else db.pushPreferences.push({ userId: req.session.userId, ...prefs });
  writeDb(db);
  res.json({ preferences: prefs, message: "Preferensi notifikasi berhasil disimpan." });
});
app.post("/api/push/subscribe", auth, (req, res) => {
  const subscription = req.body && req.body.subscription;
  if (!subscription || typeof subscription.endpoint !== "string" || !subscription.endpoint.startsWith("https://") || !subscription.keys || typeof subscription.keys.p256dh !== "string" || typeof subscription.keys.auth !== "string") {
    return res.status(400).json({ message: "Data perangkat untuk notifikasi tidak valid." });
  }
  const db = readDb();
  db.pushSubscriptions = db.pushSubscriptions.filter(x => !(x.userId === req.session.userId && x.subscription.endpoint === subscription.endpoint));
  db.pushSubscriptions.push({ id: crypto.randomUUID(), userId: req.session.userId, subscription, createdAt: new Date().toISOString() });
  writeDb(db);
  res.status(201).json({ message: "Notifikasi perangkat berhasil diaktifkan." });
});
app.delete("/api/push/subscribe", auth, (req, res) => {
  const db = readDb();
  const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint : "";
  db.pushSubscriptions = db.pushSubscriptions.filter(x => x.userId !== req.session.userId || (endpoint && x.subscription.endpoint !== endpoint));
  writeDb(db);
  res.json({ message: "Perangkat notifikasi berhasil dinonaktifkan." });
});
app.post("/api/push/test", auth, async (req, res) => {
  // Build the test push from the signed-in user's REAL finance records.
  const db = readDb();
  const userId = req.session.userId;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const rupiah = value => "Rp" + Math.max(0, Number(value) || 0).toLocaleString("id-ID");
  const todayTransactions = db.transactions.filter(x => x.userId === userId && x.date === today);
  const income = todayTransactions.filter(x => x.type === "income").reduce((n, x) => n + (Number(x.amount) || 0), 0);
  const expense = todayTransactions.filter(x => x.type === "expense").reduce((n, x) => n + (Number(x.amount) || 0), 0);
  const latest = db.transactions.filter(x => x.userId === userId).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];
  const pendingBills = db.bills.filter(x => x.userId === userId && !x.paid).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  const activeGoals = db.goals.filter(x => x.userId === userId && Number(x.target) > 0);
  const goal = activeGoals.sort((a, b) => (Number(b.saved) / Number(b.target)) - (Number(a.saved) / Number(a.target)))[0];
  const details = [
    `Transaksi hari ini: ${todayTransactions.length} aktivitas.`,
    latest ? `Transaksi terbaru: ${latest.title} · ${latest.type === "income" ? "Pemasukan" : "Pengeluaran"} ${rupiah(latest.amount)} (${latest.date}).` : "Belum ada transaksi yang tercatat.",
    pendingBills[0] ? `Tagihan berikutnya: ${pendingBills[0].name} · ${rupiah(pendingBills[0].amount)} · jatuh tempo ${pendingBills[0].dueDate}.` : "Tidak ada tagihan tertunda.",
    goal ? `Target tabungan: ${goal.name} · ${rupiah(goal.saved)} dari ${rupiah(goal.target)} (${Math.min(100, Math.round(Number(goal.saved) / Number(goal.target) * 100))}%).` : "Belum ada target tabungan aktif."
  ];
  const payload = {
    title: "Ringkasan keuangan DITZZ FINANCE",
    body: `Hari ini · Pemasukan ${rupiah(income)} · Pengeluaran ${rupiah(expense)} · ${todayTransactions.length} transaksi`,
    detail: details.join("\n"),
    tag: `finance-summary-${today}-${Date.now()}`,
    url: "/"
  };
  const sent = await pushService.sendUser(userId, payload);
  if (!sent) return res.status(400).json({ message: "Belum ada perangkat aktif. Aktifkan notifikasi pada perangkat ini terlebih dahulu." });
  res.json({ message: "Ringkasan keuangan berhasil dikirim ke perangkat." });
});

// Wishlist records are isolated by the authenticated user.
app.get("/api/wishlist", auth, (req, res) => {
  const items = readDb().wishlist.filter(x => x.userId === req.session.userId).map(x => {
    const contributions = Array.isArray(x.contributions) ? x.contributions : [];
    const savedAmount = contributions.reduce((sum, entry) => sum + (Number.isSafeInteger(entry.amount) && entry.amount > 0 ? entry.amount : 0), 0);
    return { ...x, contributions, savedAmount, remainingAmount: Math.max(0, (Number(x.price) || 0) - savedAmount) };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ items });
});
app.post("/api/wishlist", auth, (req, res) => {
  const name = cleanText(req.body.name, 100), price = Number(req.body.price ?? 0), priority = req.body.priority || "medium", targetDate = req.body.targetDate || "", note = cleanText(req.body.note, 250), image = typeof req.body.image === "string" ? req.body.image : "";
  const validImage = !image || (image.length <= 1200000 && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image));
  if (name.length < 2 || !Number.isSafeInteger(price) || price < 0 || price > 1000000000000 || !["low", "medium", "high"].includes(priority) || (targetDate && !validDate(targetDate)) || !validImage) return res.status(400).json({ message: "Nama, estimasi harga, prioritas, tanggal, atau foto wishlist tidak valid. Ukuran foto maksimal sekitar 900 KB." });
  const db = readDb();
  const item = { id: crypto.randomUUID(), userId: req.session.userId, name, price, priority, targetDate, note, image, status: "active", contributions: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  db.wishlist.push(item); writeDb(db);
  res.status(201).json({ item, message: "Wishlist berhasil ditambahkan." });
});
app.post("/api/wishlist/:id/contributions", auth, (req, res) => {
  const amount = Number(req.body.amount);
  const note = cleanText(req.body.note, 160);
  const date = req.body.date || new Date().toISOString().slice(0, 10);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000000000 || !validDate(date)) {
    return res.status(400).json({ message: "Nominal dana harus berupa angka positif dan tanggal harus valid." });
  }
  const db = readDb();
  const item = db.wishlist.find(x => x.id === req.params.id && x.userId === req.session.userId);
  if (!item) return res.status(404).json({ message: "Item wishlist tidak ditemukan." });
  if (item.status === "bought") return res.status(400).json({ message: "Wishlist yang sudah dibeli tidak dapat ditambah dana." });
  if (!Array.isArray(item.contributions)) item.contributions = [];
  const currentTotal = item.contributions.reduce((sum, entry) => sum + (Number.isSafeInteger(entry.amount) && entry.amount > 0 ? entry.amount : 0), 0);
  if (currentTotal + amount > 1000000000000) return res.status(400).json({ message: "Total dana wishlist melewati batas nominal." });
  const contribution = { id: crypto.randomUUID(), amount, note, date, createdAt: new Date().toISOString() };
  item.contributions.push(contribution);
  item.updatedAt = new Date().toISOString();
  writeDb(db);
  const savedAmount = currentTotal + amount;
  res.status(201).json({ contribution, savedAmount, remainingAmount: Math.max(0, (Number(item.price) || 0) - savedAmount), message: "Dana berhasil ditambahkan ke wishlist." });
});

app.patch("/api/wishlist/:id", auth, (req, res) => {
  const db = readDb(), item = db.wishlist.find(x => x.id === req.params.id && x.userId === req.session.userId);
  if (!item) return res.status(404).json({ message: "Item wishlist tidak ditemukan." });
  if (!["active", "bought"].includes(req.body.status)) return res.status(400).json({ message: "Status wishlist tidak valid." });
  item.status = req.body.status; item.updatedAt = new Date().toISOString(); writeDb(db);
  res.json({ item, message: item.status === "bought" ? "Wishlist ditandai sudah dibeli." : "Wishlist dikembalikan ke daftar aktif." });
});
app.delete("/api/wishlist/:id", auth, (req, res) => {
  const db = readDb(), index = db.wishlist.findIndex(x => x.id === req.params.id && x.userId === req.session.userId);
  if (index < 0) return res.status(404).json({ message: "Item wishlist tidak ditemukan." });
  db.wishlist.splice(index, 1); writeDb(db); res.json({ success: true });
});

app.get("/api/transactions", auth, (req, res) => {
  const rows = readDb().transactions.filter(t => t.userId === req.session.userId).sort((a,b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  res.json({ transactions: rows });
});
app.post("/api/transactions", auth, (req, res) => {
  const type = req.body.type;
  const amount = Number(req.body.amount);
  const title = cleanText(req.body.title, 100);
  const category = cleanText(req.body.category, 50);
  const date = req.body.date;
  const note = cleanText(req.body.note, 250);
  const walletId = cleanText(req.body.walletId, 80);
  if (!["income", "expense"].includes(type)) return res.status(400).json({ message: "Jenis transaksi tidak valid." });
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000000000) return res.status(400).json({ message: "Nominal harus berupa angka rupiah yang valid." });
  if (!title || !category || !validDate(date)) return res.status(400).json({ message: "Judul, kategori, dan tanggal wajib diisi." });
  const db = readDb();
  const defaultWallet = ensureDefaultWallet(db, req.session.userId);
  const selectedWalletId = walletId || defaultWallet.id;
  if (!db.wallets.some(w => w.id === selectedWalletId && w.userId === req.session.userId)) return res.status(400).json({ message: "Dompet tidak valid." });
  const item = { id: crypto.randomUUID(), userId: req.session.userId, type, amount, title, category, date, note, walletId: selectedWalletId, receipt: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  db.transactions.push(item);
  writeDb(db);
  res.status(201).json({ transaction: item });
});
app.put("/api/transactions/:id", auth, (req, res) => {
  const db = readDb();
  const item = db.transactions.find(t => t.id === req.params.id && t.userId === req.session.userId);
  if (!item) return res.status(404).json({ message: "Transaksi tidak ditemukan." });
  const type = req.body.type;
  const amount = Number(req.body.amount);
  const title = cleanText(req.body.title, 100);
  const category = cleanText(req.body.category, 50);
  const date = req.body.date;
  if (!["income", "expense"].includes(type) || !Number.isSafeInteger(amount) || amount <= 0 || !title || !category || !validDate(date)) {
    return res.status(400).json({ message: "Data transaksi tidak valid." });
  }
  const defaultWallet = ensureDefaultWallet(db, req.session.userId);
  const walletId = cleanText(req.body.walletId, 80) || item.walletId || defaultWallet.id;
  if (!db.wallets.some(w => w.id === walletId && w.userId === req.session.userId)) return res.status(400).json({ message: "Dompet tidak valid." });
  Object.assign(item, { type, amount, title, category, date, note: cleanText(req.body.note, 250), walletId, updatedAt: new Date().toISOString() });
  writeDb(db);
  res.json({ transaction: item });
});
app.delete("/api/transactions/:id", auth, (req, res) => {
  const db = readDb();
  const index = db.transactions.findIndex(t => t.id === req.params.id && t.userId === req.session.userId);
  if (index < 0) return res.status(404).json({ message: "Transaksi tidak ditemukan." });
  db.transactions.splice(index, 1);
  writeDb(db);
  res.json({ success: true });
});
// Monthly category budgets are private to each account.
app.get("/api/budgets", auth, (req, res) => {
  const month = cleanText(req.query.month, 7);
  const rows = readDb().budgets.filter(x => x.userId === req.session.userId && (!month || x.month === month));
  res.json({ budgets: rows });
});
app.post("/api/budgets", auth, (req, res) => {
  const month = cleanText(req.body.month, 7);
  const category = cleanText(req.body.category, 50);
  const limit = Number(req.body.limit);
  if (!/^\d{4}-\d{2}$/.test(month) || Number(month.slice(5)) < 1 || Number(month.slice(5)) > 12 || !category || !Number.isSafeInteger(limit) || limit <= 0 || limit > 1000000000000) {
    return res.status(400).json({ message: "Bulan, kategori, dan batas anggaran harus valid." });
  }
  const db = readDb();
  let item = db.budgets.find(x => x.userId === req.session.userId && x.month === month && x.category.toLowerCase() === category.toLowerCase());
  if (item) item.limit = limit;
  else { item = { id: crypto.randomUUID(), userId: req.session.userId, month, category, limit, createdAt: new Date().toISOString() }; db.budgets.push(item); }
  writeDb(db);
  res.status(201).json({ budget: item, message: "Anggaran berhasil disimpan." });
});
app.delete("/api/budgets/:id", auth, (req, res) => {
  const db = readDb();
  const i = db.budgets.findIndex(x => x.id === req.params.id && x.userId === req.session.userId);
  if (i < 0) return res.status(404).json({ message: "Anggaran tidak ditemukan." });
  db.budgets.splice(i, 1); writeDb(db); res.json({ success: true });
});

// Savings goals are also isolated by user account.
app.get("/api/goals", auth, (req, res) => {
  res.json({ goals: readDb().goals.filter(x => x.userId === req.session.userId).sort((a,b) => b.createdAt.localeCompare(a.createdAt)) });
});
app.post("/api/goals", auth, (req, res) => {
  const name = cleanText(req.body.name, 80);
  const target = Number(req.body.target);
  const saved = Number(req.body.saved || 0);
  const deadline = req.body.deadline ? cleanText(req.body.deadline, 10) : "";
  if (name.length < 2 || !Number.isSafeInteger(target) || target <= 0 || target > 1000000000000 || !Number.isSafeInteger(saved) || saved < 0 || saved > target || (deadline && !validDate(deadline))) {
    return res.status(400).json({ message: "Nama, target, tabungan awal, atau tenggat tidak valid." });
  }
  const db = readDb();
  const goal = { id: crypto.randomUUID(), userId: req.session.userId, name, target, saved, deadline, createdAt: new Date().toISOString() };
  db.goals.push(goal); writeDb(db); res.status(201).json({ goal, message: "Target tabungan berhasil dibuat." });
});
app.patch("/api/goals/:id", auth, (req, res) => {
  const db = readDb();
  const goal = db.goals.find(x => x.id === req.params.id && x.userId === req.session.userId);
  if (!goal) return res.status(404).json({ message: "Target tidak ditemukan." });
  const saved = Number(req.body.saved);
  if (!Number.isSafeInteger(saved) || saved < 0 || saved > goal.target) return res.status(400).json({ message: "Jumlah tabungan harus antara Rp0 dan target." });
  goal.saved = saved; goal.updatedAt = new Date().toISOString(); writeDb(db); res.json({ goal, message: "Progres tabungan diperbarui." });
});
app.delete("/api/goals/:id", auth, (req, res) => {
  const db = readDb();
  const i = db.goals.findIndex(x => x.id === req.params.id && x.userId === req.session.userId);
  if (i < 0) return res.status(404).json({ message: "Target tidak ditemukan." });
  db.goals.splice(i, 1); writeDb(db); res.json({ success: true });
});


// Multi-wallets: balances are derived from opening balance and linked transactions.
function ensureDefaultWallet(db, userId) {
  let wallet = db.wallets.find(w => w.userId === userId && w.isDefault);
  if (!wallet) { wallet = { id: crypto.randomUUID(), userId, name: "Dompet utama", type: "cash", openingBalance: 0, isDefault: true, createdAt: new Date().toISOString() }; db.wallets.push(wallet); }
  return wallet;
}
app.get("/api/wallets", auth, (req,res) => {
  const db=readDb(), rows=db.wallets.filter(w=>w.userId===req.session.userId);
  const fallback=rows.length?rows:[ensureDefaultWallet(db,req.session.userId)]; const defaultWallet=fallback.find(w=>w.isDefault)||fallback[0]; let migrated=false; for(const t of db.transactions.filter(t=>t.userId===req.session.userId&&!t.walletId)){t.walletId=defaultWallet.id;migrated=true;} if(!rows.length||migrated)writeDb(db);
  res.json({wallets:fallback.map(w=>({...w,balance:w.openingBalance+db.transactions.filter(t=>t.userId===req.session.userId&&t.walletId===w.id).reduce((n,t)=>n+(t.type==="income"?t.amount:-t.amount),0)}))});
});
app.post("/api/wallets", auth, (req,res) => {
  const name=cleanText(req.body.name,50), type=cleanText(req.body.type,20), openingBalance=Number(req.body.openingBalance||0);
  if(name.length<2||!['cash','bank','ewallet','other'].includes(type)||!Number.isSafeInteger(openingBalance)||openingBalance<0||openingBalance>1000000000000)return res.status(400).json({message:"Nama, jenis, atau saldo awal dompet tidak valid."});
  const db=readDb(); const wallet={id:crypto.randomUUID(),userId:req.session.userId,name,type,openingBalance,isDefault:!db.wallets.some(w=>w.userId===req.session.userId),createdAt:new Date().toISOString()};db.wallets.push(wallet);writeDb(db);res.status(201).json({wallet,message:"Dompet berhasil ditambahkan."});
});
app.delete("/api/wallets/:id", auth, (req,res)=>{const db=readDb(),w=db.wallets.find(x=>x.id===req.params.id&&x.userId===req.session.userId);if(!w)return res.status(404).json({message:"Dompet tidak ditemukan."});if(db.transactions.some(t=>t.userId===req.session.userId&&t.walletId===w.id)||db.recurring.some(t=>t.userId===req.session.userId&&t.walletId===w.id))return res.status(400).json({message:"Dompet masih digunakan transaksi atau jadwal berulang."});if(w.isDefault&&db.wallets.filter(x=>x.userId===req.session.userId).length>1)return res.status(400).json({message:"Dompet utama tidak dapat dihapus."});db.wallets=db.wallets.filter(x=>x.id!==w.id);writeDb(db);res.json({success:true});});

// Scheduled transaction templates. The client asks the server to process due items on login.
function nextRecurringDate(date, frequency){const d=new Date(date+"T12:00:00");if(frequency==="weekly")d.setDate(d.getDate()+7);else{const day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+1);const last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();d.setDate(Math.min(day,last));}return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
app.get("/api/recurring",auth,(req,res)=>res.json({recurring:readDb().recurring.filter(x=>x.userId===req.session.userId)}));
app.post("/api/recurring",auth,(req,res)=>{const type=req.body.type,amount=Number(req.body.amount),title=cleanText(req.body.title,100),category=cleanText(req.body.category,50),frequency=req.body.frequency,startDate=req.body.startDate,walletId=cleanText(req.body.walletId,80);if(!['income','expense'].includes(type)||!Number.isSafeInteger(amount)||amount<=0||amount>1e12||!title||!category||!['monthly','weekly'].includes(frequency)||!validDate(startDate))return res.status(400).json({message:"Data transaksi berulang tidak valid."});const db=readDb();const defaultWallet=ensureDefaultWallet(db,req.session.userId),selectedWalletId=walletId||defaultWallet.id;if(!db.wallets.some(w=>w.id===selectedWalletId&&w.userId===req.session.userId))return res.status(400).json({message:"Dompet tidak valid."});const item={id:crypto.randomUUID(),userId:req.session.userId,type,amount,title,category,frequency,nextDate:startDate,walletId:selectedWalletId,active:true,createdAt:new Date().toISOString()};db.recurring.push(item);writeDb(db);res.status(201).json({recurring:item,message:"Jadwal transaksi dibuat."});});
app.delete("/api/recurring/:id",auth,(req,res)=>{const db=readDb(),i=db.recurring.findIndex(x=>x.id===req.params.id&&x.userId===req.session.userId);if(i<0)return res.status(404).json({message:"Jadwal tidak ditemukan."});db.recurring.splice(i,1);writeDb(db);res.json({success:true});});
app.post("/api/recurring/process",auth,(req,res)=>{const db=readDb(),today=validDate(req.body.today)?req.body.today:new Date().toISOString().slice(0,10);let created=0;for(const r of db.recurring.filter(x=>x.userId===req.session.userId&&x.active)){let guard=0;while(r.nextDate<=today&&guard++<24){db.transactions.push({id:crypto.randomUUID(),userId:req.session.userId,type:r.type,amount:r.amount,title:r.title,category:r.category,date:r.nextDate,note:"Dibuat otomatis dari transaksi berulang",walletId:r.walletId,receipt:"",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});r.nextDate=nextRecurringDate(r.nextDate,r.frequency);created++;}}if(created)writeDb(db);res.json({created});});

// Bills and due-date reminders.
app.get("/api/bills",auth,(req,res)=>res.json({bills:readDb().bills.filter(x=>x.userId===req.session.userId).sort((a,b)=>a.dueDate.localeCompare(b.dueDate))}));
app.post("/api/bills",auth,(req,res)=>{const name=cleanText(req.body.name,80),amount=Number(req.body.amount),dueDate=req.body.dueDate,frequency=req.body.frequency||"once";if(name.length<2||!Number.isSafeInteger(amount)||amount<=0||amount>1e12||!validDate(dueDate)||!['once','monthly'].includes(frequency))return res.status(400).json({message:"Data tagihan tidak valid."});const db=readDb(),bill={id:crypto.randomUUID(),userId:req.session.userId,name,amount,dueDate,frequency,paid:false,createdAt:new Date().toISOString()};db.bills.push(bill);writeDb(db);res.status(201).json({bill,message:"Tagihan berhasil ditambahkan."});});
app.patch("/api/bills/:id",auth,(req,res)=>{const db=readDb(),bill=db.bills.find(x=>x.id===req.params.id&&x.userId===req.session.userId);if(!bill)return res.status(404).json({message:"Tagihan tidak ditemukan."});if(req.body.paid===true&&bill.frequency==="monthly"){const d=new Date(bill.dueDate+"T12:00:00");d.setMonth(d.getMonth()+1);bill.dueDate=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(Math.min(new Date(bill.dueDate+"T12:00:00").getDate(),new Date(d.getFullYear(),d.getMonth()+1,0).getDate())).padStart(2,"0")}`;bill.paid=false;}else bill.paid=Boolean(req.body.paid);writeDb(db);res.json({bill,message:"Status tagihan diperbarui."});});
app.delete("/api/bills/:id",auth,(req,res)=>{const db=readDb(),i=db.bills.findIndex(x=>x.id===req.params.id&&x.userId===req.session.userId);if(i<0)return res.status(404).json({message:"Tagihan tidak ditemukan."});db.bills.splice(i,1);writeDb(db);res.json({success:true});});

// Receipt attachments are stored as bounded data URLs in the JSON record.
app.put("/api/transactions/:id/receipt",auth,(req,res)=>{const receipt=typeof req.body.receipt==="string"?req.body.receipt:"";if(receipt&&!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(receipt))return res.status(400).json({message:"Lampiran harus berupa gambar PNG, JPG, atau WEBP."});if(receipt.length>2_000_000)return res.status(413).json({message:"Ukuran gambar maksimal sekitar 1,5 MB."});const db=readDb(),tx=db.transactions.find(x=>x.id===req.params.id&&x.userId===req.session.userId);if(!tx)return res.status(404).json({message:"Transaksi tidak ditemukan."});tx.receipt=receipt;tx.updatedAt=new Date().toISOString();writeDb(db);res.json({message:receipt?"Bukti transaksi tersimpan.":"Bukti transaksi dihapus."});});

// Restore only this user's exported data; imported IDs are regenerated.
app.post("/api/restore",auth,(req,res)=>{const payload=req.body;if(!payload||!Array.isArray(payload.transactions))return res.status(400).json({message:"File backup tidak memiliki data transaksi yang valid."});if(payload.transactions.length>10000)return res.status(400).json({message:"Backup terlalu besar (maksimal 10.000 transaksi)."});const db=readDb(),uid=req.session.userId,now=new Date().toISOString(),walletMap=new Map();const importedWallets=Array.isArray(payload.wallets)?payload.wallets:[];for(const w of importedWallets){const id=crypto.randomUUID();walletMap.set(w.id,id);db.wallets.push({id,userId:uid,name:cleanText(w.name,50)||"Dompet hasil restore",type:['cash','bank','ewallet','other'].includes(w.type)?w.type:"other",openingBalance:Number.isSafeInteger(w.openingBalance)&&w.openingBalance>=0?w.openingBalance:0,isDefault:Boolean(w.isDefault)&&!db.wallets.some(x=>x.userId===uid&&x.isDefault),createdAt:now});}let defaultWallet=db.wallets.find(w=>w.userId===uid&&w.isDefault);if(!defaultWallet){defaultWallet={id:crypto.randomUUID(),userId:uid,name:"Dompet utama",type:"cash",openingBalance:0,isDefault:true,createdAt:now};db.wallets.push(defaultWallet);}const txs=[];for(const t of payload.transactions){const type=t.type,amount=Number(t.amount),title=cleanText(t.title,100),category=cleanText(t.category,50);if(!['income','expense'].includes(type)||!Number.isSafeInteger(amount)||amount<=0||amount>1e12||!title||!category||!validDate(t.date))return res.status(400).json({message:"Ada transaksi dalam backup yang tidak valid. Tidak ada data yang diubah."});txs.push({...t,id:crypto.randomUUID(),userId:uid,amount,title,category,walletId:walletMap.get(t.walletId)||defaultWallet.id,receipt:""});}db.transactions.push(...txs);for(const key of ['budgets','goals','bills'])if(Array.isArray(payload[key]))for(const item of payload[key])db[key].push({...item,id:crypto.randomUUID(),userId:uid});if(Array.isArray(payload.recurring))for(const item of payload.recurring)db.recurring.push({...item,id:crypto.randomUUID(),userId:uid,walletId:walletMap.get(item.walletId)||defaultWallet.id});if(Array.isArray(payload.wishlist))for(const item of payload.wishlist){const name=cleanText(item.name,100),price=Number(item.price??0),priority=['low','medium','high'].includes(item.priority)?item.priority:'medium',targetDate=item.targetDate&&validDate(item.targetDate)?item.targetDate:'';const image=typeof item.image==='string'&&item.image.length<=1200000&&/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(item.image)?item.image:'';if(name.length>=2&&Number.isSafeInteger(price)&&price>=0&&price<=1e12)db.wishlist.push({id:crypto.randomUUID(),userId:uid,name,price,priority,targetDate,note:cleanText(item.note,250),image,status:item.status==='bought'?'bought':'active',contributions:Array.isArray(item.contributions)?item.contributions.filter(c=>Number.isSafeInteger(Number(c.amount))&&Number(c.amount)>0&&Number(c.amount)<=1e12&&validDate(c.date)).map(c=>({id:crypto.randomUUID(),amount:Number(c.amount),note:cleanText(c.note,160),date:c.date,createdAt:now})):[],createdAt:now,updatedAt:now});}writeDb(db);res.json({message:`${txs.length} transaksi berhasil dipulihkan.`});});

// Import CSV rows in one validated batch; every row is assigned to the signed-in user.
app.post("/api/transactions/import", auth, (req, res) => {
  const rows = req.body.rows;
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 500) {
    return res.status(400).json({ message: "File harus berisi 1–500 transaksi." });
  }
  const normalized = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || {};
    const typeRaw = cleanText(row.type, 20).toLowerCase();
    const type = ["income", "pemasukan"].includes(typeRaw) ? "income" : ["expense", "pengeluaran"].includes(typeRaw) ? "expense" : "";
    const amount = Number(row.amount);
    const title = cleanText(row.title, 100);
    const category = cleanText(row.category, 50);
    const date = row.date;
    if (!type || !Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000000000 || !title || !category || !validDate(date)) {
      return res.status(400).json({ message: `Baris ${i + 2} tidak valid. Periksa tanggal, jenis, nama, kategori, dan nominal.` });
    }
    normalized.push({ id: crypto.randomUUID(), userId: req.session.userId, type, amount, title, category, date, note: cleanText(row.note, 250), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  const db = readDb();
  db.transactions.push(...normalized);
  writeDb(db);
  res.status(201).json({ imported: normalized.length, message: `${normalized.length} transaksi berhasil diimpor.` });
});

app.get("/api/backup", auth, (req, res) => {
  const db = readDb();
  const data = { exportedAt: new Date().toISOString(), wishlist: db.wishlist.filter(x => x.userId === req.session.userId), transactions: db.transactions.filter(t => t.userId === req.session.userId), budgets: db.budgets.filter(x => x.userId === req.session.userId), goals: db.goals.filter(x => x.userId === req.session.userId), wallets: db.wallets.filter(x => x.userId === req.session.userId), recurring: db.recurring.filter(x => x.userId === req.session.userId), bills: db.bills.filter(x => x.userId === req.session.userId) };
  res.setHeader("Content-Disposition", 'attachment; filename="ditzz-finance-backup.json"');
  res.json(data);
});

// Vercel Cron / external scheduler endpoint for push reminders.
app.get("/api/cron/push", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ message: "Unauthorized." });
  }
  try {
    await pushService.runScheduler();
    res.json({ success: true, message: "Pemeriksaan notifikasi selesai." });
  } catch (error) {
    console.error("Cron push gagal:", error.message);
    res.status(500).json({ message: "Pemeriksaan notifikasi gagal." });
  }
});

app.use("/api", (req, res) => res.status(404).json({ message: "Endpoint tidak ditemukan." }));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "index.html")));

if (require.main === module) {
  seedAdmin().then(() => {
    pushService.startScheduler();
    app.listen(PORT, () => console.log(`DITZZ FINANCE berjalan di http://localhost:${PORT}`));
  }).catch(err => {
    console.error("Gagal menyiapkan database:", err.message);
    process.exit(1);
  });
}

module.exports = app;
