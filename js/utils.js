// utils.js - Shared utility functions

// Format date to dd-Mon-yy
export function formatDate(dateStr) {
  if (!dateStr) return "--";
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
}

// Calculate working days between two dates
export function calcWorkingDays(startStr, endStr, dept, pattern, rosterStart) {
  const start = new Date(startStr);
  const end = new Date(endStr);
  if (isNaN(start) || isNaN(end) || end < start) return 0;

  let count = 0;
  const cur = new Date(start);

  if (dept === "GD") {
    // Mon-Thu only (weekday 1-4 in JS where 0=Sun)
    while (cur <= end) {
      const wd = cur.getDay();
      if (wd >= 1 && wd <= 4) count++;
      cur.setDate(cur.getDate() + 1);
    }
  } else {
    // DO shift pattern e.g. "6W4O"
    if (!pattern || !rosterStart) return 0;
    const match = pattern.match(/(\d+)W(\d+)O/i);
    if (!match) return 0;
    const workDays = parseInt(match[1]);
    const cycleLen = workDays + parseInt(match[2]);
    const rDate = new Date(rosterStart);

    while (cur <= end) {
      const diff = Math.floor((cur - rDate) / 86400000);
      const pos = ((diff % cycleLen) + cycleLen) % cycleLen;
      if (pos < workDays) count++;
      cur.setDate(cur.getDate() + 1);
    }
  }
  return count;
}

// Check if a date is a valid GD working day (Mon-Thu)
export function isGDWorkingDay(dateStr) {
  const d = new Date(dateStr);
  const wd = d.getDay();
  return wd >= 1 && wd <= 4;
}

// Check if a date is a valid DO working day given pattern
export function isDOWorkingDay(dateStr, pattern, rosterStart) {
  if (!pattern || !rosterStart) return false;
  const match = pattern.match(/(\d+)W(\d+)O/i);
  if (!match) return false;
  const workDays = parseInt(match[1]);
  const cycleLen = workDays + parseInt(match[2]);
  const d = new Date(dateStr);
  const r = new Date(rosterStart);
  const diff = Math.floor((d - r) / 86400000);
  const pos = ((diff % cycleLen) + cycleLen) % cycleLen;
  return pos < workDays;
}

// Show toast notification
export function showToast(message, type = "success") {
  let container = document.querySelector(".toast-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.3s";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Status badge HTML
export function statusBadge(status) {
  const cls = {
    "Pending": "status-pending",
    "Approved": "status-approved",
    "Rejected": "status-rejected",
    "Cancelled": "status-cancelled"
  }[status] || "status-pending";
  return `<span class="status-badge ${cls}">${status || "Pending"}</span>`;
}

// Dept badge HTML
export function deptBadge(dept) {
  return `<span class="dept-badge dept-${dept}">${dept}</span>`;
}

// Progress bar HTML
export function progressBar(used, total) {
  if (!total || total === 0) return "--";
  const pct = Math.min(100, Math.round((used / total) * 100));
  let cls = "";
  if (pct >= 90) cls = "danger";
  else if (pct >= 70) cls = "warn";
  return `
    <div class="progress-wrap">
      <div class="progress-bar">
        <div class="progress-fill ${cls}" style="width:${pct}%"></div>
      </div>
      <span class="progress-label">${pct}%</span>
    </div>`;
}

// Detect overlapping leave requests (clash check)
export function detectClash(newStart, newEnd, allRequests, excludeId = null) {
  const clashing = [];
  for (const req of allRequests) {
    if (req.id === excludeId) continue;
    if (req.status === "Rejected" || req.status === "Cancelled") continue;
    const s = new Date(req.startDate);
    const e = new Date(req.endDate);
    const ns = new Date(newStart);
    const ne = new Date(newEnd);
    if (!(ne < s || ns > e)) {
      clashing.push(req.employeeName);
    }
  }
  return [...new Set(clashing)];
}
