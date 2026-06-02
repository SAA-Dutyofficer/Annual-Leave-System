// js/utils.js — shared helper functions

// ── Date formatting ──────────────────────────────────────────────
export function fmtDate(str) {
  if (!str) return "--";
  const d = new Date(str + "T00:00:00");
  if (isNaN(d)) return str;
  return d.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"2-digit" });
}

export function fmtDateTime(ts) {
  if (!ts) return "--";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"2-digit",
    hour:"2-digit", minute:"2-digit" });
}

export function todayStr() {
  return new Date().toISOString().split("T")[0];
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

export function dateAddYears(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setFullYear(d.getFullYear() + n);
  return d.toISOString().split("T")[0];
}

// ── Working day checks ───────────────────────────────────────────
export function isGDWorkDay(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const wd = d.getDay(); // 0=Sun
  return wd >= 1 && wd <= 4; // Mon–Thu
}

export function isDOWorkDay(dateStr, pattern, rosterStart) {
  if (!pattern || !rosterStart) return false;
  const m = pattern.toUpperCase().match(/^(\d+)W(\d+)O$/);
  if (!m) return false;
  const workDays = parseInt(m[1]);
  const cycleLen = workDays + parseInt(m[2]);
  const d  = new Date(dateStr + "T00:00:00");
  const r  = new Date(rosterStart + "T00:00:00");
  const diff = Math.round((d - r) / 86400000);
  const pos  = ((diff % cycleLen) + cycleLen) % cycleLen;
  return pos < workDays;
}

// ── Day counting ─────────────────────────────────────────────────
export function countWorkDays(startStr, endStr, dept, pattern, rosterStart) {
  if (!startStr || !endStr) return 0;
  const start = new Date(startStr + "T00:00:00");
  const end   = new Date(endStr   + "T00:00:00");
  if (end < start) return 0;

  let cnt = 0;
  const cur = new Date(start);

  if (dept === "GD") {
    while (cur <= end) {
      const wd = cur.getDay();
      if (wd >= 1 && wd <= 4) cnt++;
      cur.setDate(cur.getDate() + 1);
    }
  } else {
    const m = (pattern || "").toUpperCase().match(/^(\d+)W(\d+)O$/);
    if (!m || !rosterStart) return 0;
    const workDays = parseInt(m[1]);
    const cycleLen = workDays + parseInt(m[2]);
    const r = new Date(rosterStart + "T00:00:00");
    while (cur <= end) {
      const diff = Math.round((cur - r) / 86400000);
      const pos  = ((diff % cycleLen) + cycleLen) % cycleLen;
      if (pos < workDays) cnt++;
      cur.setDate(cur.getDate() + 1);
    }
  }
  return cnt;
}

// ── Next valid working day from a date ───────────────────────────
export function nextWorkDay(dateStr, dept, pattern, rosterStart) {
  let d = dateStr;
  for (let i = 0; i < 60; i++) {
    const check = dept === "GD"
      ? isGDWorkDay(d)
      : isDOWorkDay(d, pattern, rosterStart);
    if (check) return d;
    d = addDays(d, 1);
  }
  return dateStr;
}

// ── Clash detection ──────────────────────────────────────────────
export function detectClashes(newStart, newEnd, requests, excludeId = null) {
  const names = [];
  for (const r of requests) {
    if (r.id === excludeId) continue;
    if (r.status === "Rejected" || r.status === "Cancelled") continue;
    if (r.endDate < newStart || r.startDate > newEnd) continue;
    names.push(r.employeeName);
  }
  return [...new Set(names)];
}

// ── HTML helpers ─────────────────────────────────────────────────
export function statusBadge(status) {
  const map = {
    Pending:   "sb-pending",
    Approved:  "sb-approved",
    Rejected:  "sb-rejected",
    Cancelled: "sb-cancelled"
  };
  return `<span class="status-badge ${map[status]||"sb-pending"}">${status||"Pending"}</span>`;
}

export function deptBadge(dept) {
  return `<span class="dept-badge db-${dept}">${dept}</span>`;
}

export function roleBadge(role) {
  return `<span class="role-badge ${role==="manager"?"rb-manager":"rb-staff"}">${role==="manager"?"Manager":"Staff"}</span>`;
}

export function pbar(used, total) {
  if (!total) return "--";
  const pct = Math.min(100, Math.round(used / total * 100));
  const cls = pct >= 90 ? "danger" : pct >= 70 ? "warn" : "";
  return `<div class="pbar-wrap">
    <div class="pbar"><div class="pbar-fill ${cls}" style="width:${pct}%"></div></div>
    <span class="pbar-pct">${pct}%</span>
  </div>`;
}

// ── Toast notifications ──────────────────────────────────────────
export function toast(msg, type = "success") {
  const wrap = document.getElementById("toastWrap");
  if (!wrap) return;
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity .3s";
    setTimeout(() => el.remove(), 300);
  }, 3800);
}

// ── Cycle helpers ────────────────────────────────────────────────
export function cycleEnd(cycleStart) {
  const d = new Date(cycleStart + "T00:00:00");
  d.setFullYear(d.getFullYear() + 1);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

export function isRenewalDue(emp) {
  if (!emp.cycleEnd) return false;
  const end = new Date(emp.cycleEnd + "T00:00:00");
  const today = new Date();
  const diff = Math.ceil((end - today) / 86400000);
  return diff <= 30; // due within 30 days
}

// ── Initials avatar ──────────────────────────────────────────────
export function initials(name) {
  if (!name) return "?";
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}
