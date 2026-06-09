// js/utils.js — Shared helpers

// ── Leave types config ────────────────────────────────────────────
export const LEAVE_TYPES = {
  Annual:    { label: "Annual Leave",              maxDays: null },
  Unpaid:    { label: "Unpaid Leave",              maxDays: null },
  Paternity: { label: "Paternity Leave",           maxDays: 4    },
  Hajj:      { label: "Hajj Leave",               maxDays: 30   },
  Emergency: { label: "Emergency Leave",           maxDays: null },
  Custom:    { label: "Custom / Other",            maxDays: null }
};

// Map leave type to the field on the employee record that tracks usage
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

// ── Date helpers ──────────────────────────────────────────────────

// Returns today as YYYY-MM-DD in local time
export function todayStr() {
  const d = new Date();
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

// Format YYYY-MM-DD to DD/MM/YYYY for display
export function fmtDate(str) {
  if (!str) return "--";
  const [y, m, d] = str.split("-");
  if (!y || !m || !d) return str;
  return `${d}/${m}/${y}`;
}

// Format a Firestore Timestamp or null to readable datetime
export function fmtDateTime(ts) {
  if (!ts) return "--";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" }) +
    " " + d.toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" });
}

// Given a cycle start date string, return the end date (1 year - 1 day later)
export function cycleEnd(startStr) {
  if (!startStr) return "";
  const d = new Date(startStr + "T00:00:00");
  d.setFullYear(d.getFullYear() + 1);
  d.setDate(d.getDate() - 1);
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

// ── Working day logic ─────────────────────────────────────────────

// GD staff: Mon–Thu are working days (0=Sun,1=Mon,...,4=Thu,5=Fri,6=Sat)
export function isGDWorkDay(dateStr) {
  const day = new Date(dateStr + "T00:00:00").getDay();
  return day >= 1 && day <= 4; // Mon=1, Tue=2, Wed=3, Thu=4
}

// DO staff: rotating shift pattern e.g. "6W4O" = 6 work, 4 off
// rosterStart is the first day of the current cycle (YYYY-MM-DD)
export function isDOWorkDay(dateStr, pattern, rosterStart) {
  if (!pattern || !rosterStart) return false;
  const match = pattern.toUpperCase().match(/^(\d+)W(\d+)O$/);
  if (!match) return false;
  const workDays = parseInt(match[1]);
  const offDays  = parseInt(match[2]);
  const cycleLen = workDays + offDays;

  const start = new Date(rosterStart + "T00:00:00");
  const date  = new Date(dateStr     + "T00:00:00");
  const diff  = Math.round((date - start) / 86400000);
  const pos   = ((diff % cycleLen) + cycleLen) % cycleLen;
  return pos < workDays;
}

// Count working days between two dates (inclusive) for a given dept/pattern
export function countWorkDays(startStr, endStr, dept, pattern, rosterStart) {
  let count = 0;
  const cur = new Date(startStr + "T00:00:00");
  const end = new Date(endStr   + "T00:00:00");
  while (cur <= end) {
    const s = cur.getFullYear() + "-" +
      String(cur.getMonth() + 1).padStart(2, "0") + "-" +
      String(cur.getDate()).padStart(2, "0");
    if (dept === "GD") {
      if (isGDWorkDay(s)) count++;
    } else {
      if (isDOWorkDay(s, pattern, rosterStart)) count++;
    }
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// ── Clash detection ───────────────────────────────────────────────
// Returns array of clashing request objects from a list
export function detectClashes(newStart, newEnd, requests) {
  return requests.filter(r => {
    if (r.status === "Rejected" || r.status === "Cancelled") return false;
    return !(r.endDate < newStart || r.startDate > newEnd);
  });
}

// ── Renewal check ─────────────────────────────────────────────────
// Returns true if employee's cycle ends within 30 days or is already past
export function isRenewalDue(emp) {
  if (!emp.cycleEnd) return false;
  const end  = new Date(emp.cycleEnd + "T00:00:00");
  const now  = new Date();
  const diff = Math.ceil((end - now) / 86400000);
  return diff <= 30;
}

// ── HTML badge helpers ────────────────────────────────────────────
export function statusBadge(status) {
  const map = {
    Pending:     "sb-pending",
    Approved:    "sb-approved",
    Rejected:    "sb-rejected",
    Cancelled:   "sb-cancelled",
    EditAllowed: "sb-pending"
  };
  const cls = map[status] || "sb-cancelled";
  return `<span class="status-badge ${cls}">${status}</span>`;
}

export function leaveTypeBadge(type) {
  const colors = {
    Annual:    "background:var(--blue-light);color:var(--blue)",
    Unpaid:    "background:var(--gray-100);color:var(--gray-600)",
    Paternity: "background:var(--purple-light);color:var(--purple)",
    Hajj:      "background:var(--green-light);color:var(--green)",
    Emergency: "background:var(--red-light);color:var(--red)",
    Custom:    "background:var(--orange-light);color:var(--orange)"
  };
  const style = colors[type] || "background:var(--gray-100);color:var(--gray-600)";
  return `<span class="status-badge" style="${style}">${type||"--"}</span>`;
}

export function deptBadge(dept) {
  if (!dept) return "--";
  return `<span class="dept-badge db-${dept}">${dept}</span>`;
}

export function roleBadge(role) {
  const cls = role === "manager" ? "rb-manager" : "rb-staff";
  return `<span class="role-badge ${cls}">${role === "manager" ? "Manager" : "Staff"}</span>`;
}

// Mini progress bar HTML
export function pbar(used, total) {
  const pct = total > 0 ? Math.min(100, Math.round(used / total * 100)) : 0;
  const cls = pct >= 90 ? "danger" : pct >= 70 ? "warn" : "";
  return `<div class="pbar-wrap">
    <div class="pbar"><div class="pbar-fill ${cls}" style="width:${pct}%"></div></div>
    <span class="pbar-pct">${pct}%</span>
  </div>`;
}

// Get initials from a full name (up to 2 letters)
export function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ── Toast notifications ───────────────────────────────────────────
export function toast(message, type = "success") {
  const wrap = document.getElementById("toastWrap");
  if (!wrap) return;
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
