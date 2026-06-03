// js/utils.js — shared helper functions

// ── Date formatting ──────────────────────────────────────────────
export function fmtDate(str) {
  if (!str) return "--";
  const d = new Date(str + "T00:00:00");
  if (isNaN(d)) return str;
  return d.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" });
}

export function fmtDateTime(ts) {
  if (!ts) return "--";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric",
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

// ── Leave type config ────────────────────────────────────────────
export const LEAVE_TYPES = {
  Annual:    { label: "Annual Leave",    deductsBalance: true,  maxDays: null, color: "#3B82F6" },
  Unpaid:    { label: "Unpaid Leave",    deductsBalance: false, maxDays: null, color: "#6B7280" },
  Paternity: { label: "Paternity Leave", deductsBalance: false, maxDays: 4,    color: "#8B5CF6" },
  Hajj:      { label: "Hajj Leave",      deductsBalance: false, maxDays: 30,   color: "#F59E0B" },
  Emergency: { label: "Emergency Leave", deductsBalance: false, maxDays: null, color: "#EF4444" },
  Custom:    { label: "Custom / Other",  deductsBalance: false, maxDays: null, color: "#10B981" }
};

export function leaveTypeOptions(selected = "Annual") {
  return Object.entries(LEAVE_TYPES).map(([val, cfg]) =>
    `<option value="${val}" ${val === selected ? "selected" : ""}>${cfg.label}</option>`
  ).join("");
}

export function leaveTypeBadge(type) {
  const cfg = LEAVE_TYPES[type] || LEAVE_TYPES.Custom;
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:${cfg.color}20;color:${cfg.color}">${cfg.label||type}</span>`;
}

// ── Working day checks ───────────────────────────────────────────
export function isGDWorkDay(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const wd = d.getDay();
  return wd >= 1 && wd <= 4;
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
  return diff <= 30;
}

// ── Initials avatar ──────────────────────────────────────────────
export function initials(name) {
  if (!name) return "?";
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

// ── Leave type balance tracker keys ─────────────────────────────
export function balanceField(leaveType) {
  const map = {
    Annual:    "leaveUsed",
    Unpaid:    "unpaidUsed",
    Paternity: "paternityUsed",
    Hajj:      "hajjUsed",
    Emergency: "emergencyUsed",
    Custom:    "customUsed"
  };
  return map[leaveType] || "customUsed";
}
