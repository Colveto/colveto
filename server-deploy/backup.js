const fs = require('fs');
const path = require('path');

const SUBFOLDER = 'vet-clinic-backups';

function backupFilename(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `vet-clinic-${ts}.db`;
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function listBackups(destinations) {
  const all = [];
  for (const dest of destinations || []) {
    const folder = path.join(dest, SUBFOLDER);
    if (!fs.existsSync(folder)) continue;
    try {
      const files = fs.readdirSync(folder).filter((f) => f.endsWith('.db'));
      for (const f of files) {
        const full = path.join(folder, f);
        try {
          const stat = fs.statSync(full);
          all.push({
            destination: dest,
            filename: f,
            path: full,
            size: stat.size,
            createdAt: stat.mtime.toISOString(),
          });
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function runBackup(db, destinations) {
  if (!destinations || destinations.length === 0) {
    return { ok: false, error: 'Aucune destination configurée', written: [] };
  }
  const now = new Date();
  const filename = backupFilename(now);
  const written = [];
  const errors = [];

  for (const dest of destinations) {
    try {
      const folder = path.join(dest, SUBFOLDER);
      ensureDir(folder);
      const target = path.join(folder, filename);
      await db.backupTo(target);
      written.push({ destination: dest, path: target });
    } catch (e) {
      errors.push({ destination: dest, error: e.message });
    }
  }
  return { ok: written.length > 0, written, errors, at: now.toISOString() };
}

/**
 * Apply rotation policy:
 * - Keep all daily backups for the last 30 days
 * - Keep one monthly backup (the first of each month) for 5 years
 * - Delete the rest
 */
function rotate(destinations) {
  const now = new Date();
  const cutoffDaily = new Date(now); cutoffDaily.setDate(now.getDate() - 30);
  const cutoffMonthly = new Date(now); cutoffMonthly.setFullYear(now.getFullYear() - 5);

  for (const dest of destinations || []) {
    const folder = path.join(dest, SUBFOLDER);
    if (!fs.existsSync(folder)) continue;
    let files;
    try {
      files = fs.readdirSync(folder).filter((f) => f.endsWith('.db'));
    } catch { continue; }

    // Group by month
    const byMonth = {};
    const fileInfos = [];
    for (const f of files) {
      const m = f.match(/vet-clinic-(\d{4})-(\d{2})-(\d{2})_(\d{6})\.db/);
      if (!m) continue;
      const [_, y, mo, d, hms] = m;
      const fileDate = new Date(`${y}-${mo}-${d}T${hms.slice(0,2)}:${hms.slice(2,4)}:${hms.slice(4,6)}`);
      const monthKey = `${y}-${mo}`;
      const info = { name: f, date: fileDate, monthKey };
      fileInfos.push(info);
      if (!byMonth[monthKey] || fileDate < byMonth[monthKey].date) {
        byMonth[monthKey] = info;
      }
    }
    const monthlyKept = new Set(Object.values(byMonth).map((i) => i.name));

    for (const info of fileInfos) {
      const isDaily = info.date >= cutoffDaily;
      const isMonthlyKept = monthlyKept.has(info.name) && info.date >= cutoffMonthly;
      if (!isDaily && !isMonthlyKept) {
        try { fs.unlinkSync(path.join(folder, info.name)); } catch { /* skip */ }
      }
    }
  }
}

function startScheduler({ db, getSettings, saveSettings }) {
  // Check every minute whether a backup is due
  const tick = async () => {
    try {
      const settings = getSettings();
      if (settings.backupEnabled !== '1') return;
      const time = settings.backupTime || '22:00';
      const [h, m] = time.split(':').map((x) => parseInt(x, 10));
      const now = new Date();
      const lastAt = settings.lastBackupAt ? new Date(settings.lastBackupAt) : null;
      const today10 = new Date(now); today10.setHours(h, m, 0, 0);
      const dueAlreadyToday = now >= today10;

      // Run if scheduled time has passed today and we haven't backed up since
      const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
      const alreadyDoneToday = lastAt && lastAt >= todayStart;

      if (dueAlreadyToday && !alreadyDoneToday) {
        const destinations = JSON.parse(settings.backupDestinations || '[]');
        if (destinations.length === 0) return;
        const result = await runBackup(db, destinations);
        if (result.ok) {
          rotate(destinations);
          saveSettings({
            lastBackupAt: result.at,
            lastBackupResult: JSON.stringify({ ok: true, count: result.written.length }),
          });
        } else {
          saveSettings({
            lastBackupResult: JSON.stringify({ ok: false, errors: result.errors }),
          });
        }
      }
    } catch (e) {
      console.error('Backup scheduler error', e);
    }
  };

  // First check immediately, then every minute
  tick();
  setInterval(tick, 60_000);
}

module.exports = { runBackup, listBackups, rotate, startScheduler };
