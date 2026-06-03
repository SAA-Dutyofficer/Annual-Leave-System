// js/staff.js — Staff portal
import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, collection, query, where, onSnapshot,
         addDoc, updateDoc, serverTimestamp, getDocs, orderBy }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { fmtDate, todayStr, cycleEnd,
         isGDWorkDay, isDOWorkDay, countWorkDays,
         detectClashes, statusBadge, leaveTypeBadge,
         LEAVE_TYPES, balanceField, toast, initials }
  from "./utils.js";

let ME = null;
let EMP = null;
let myRequests = [];
let allRequests = [];

// ── Auth guard ───────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { location.href = "../index.html"; return; }
  ME = user;

  const uSnap = await getDoc(doc(db, "users", user.uid));
  if (!uSnap.exists()) { location.href = "../index.html"; return; }
  const uData = uSnap.data();
  if (uData.role === "manager") { location.href = "manager.html"; return; }

  document.getElementById("navName").textContent = uData.name || user.email;

  const eSnap = await getDoc(doc(db, "employees", user.uid));
  if (!eSnap.exists()) {
    toast("Employee record not found. Contact your manager.", "error"); return;
  }
  EMP = { id: eSnap.id, ...eSnap.data() };

  // Show/hide pattern fields based on dept
  if (EMP.dept === "DO") {
    document.getElementById("doPatternFields").style.display = "block";
    // Pre-fill with employee defaults
    if (EMP.pattern) document.getElementById("fPattern").value = EMP.pattern;
    if (EMP.rosterStart) document.getElementById("fRosterStart").value = EMP.rosterStart;
  }

  renderBalance();
  renderCalendar();
  listenMyRequests();
  listenAllRequests();
  loadTeam();
  checkRenewal();
});

// ── Sign out ─────────────────────────────────────────────────────
document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  location.href = "../index.html";
});

// ── Navigation (top tabs + bottom nav) ──────────────────────────
function switchSection(name) {
  document.querySelectorAll(".bnav-item").forEach(b =>
    b.classList.toggle("active", b.dataset.section === name));
  document.querySelectorAll(".nav-tab[data-section]").forEach(t =>
    t.classList.toggle("active", t.dataset.section === name));
  document.querySelectorAll(".page-section").forEach(s => s.classList.remove("active"));
  document.getElementById("section-" + name).classList.add("active");
}

// Bottom nav
document.querySelectorAll(".bnav-item").forEach(btn =>
  btn.addEventListener("click", () => switchSection(btn.dataset.section)));

// Top nav tabs
document.querySelectorAll(".nav-tab[data-section]").forEach(tab =>
  tab.addEventListener("click", () => switchSection(tab.dataset.section)));

// ── Balance display ──────────────────────────────────────────────
function renderBalance() {
  const used      = EMP.leaveUsed    || 0;
  const ent       = EMP.entitlement  || 0;
  const remaining = Math.max(0, ent - used);
  const pct       = ent > 0 ? Math.min(100, Math.round(used / ent * 100)) : 0;

  // Other leave total
  const other = (EMP.unpaidUsed||0) + (EMP.paternityUsed||0) +
                (EMP.hajjUsed||0) + (EMP.emergencyUsed||0) + (EMP.customUsed||0);

  document.getElementById("bcEntitlement").textContent = ent;
  document.getElementById("bcUsed").textContent        = used;
  document.getElementById("bcRemaining").textContent   = remaining;
  document.getElementById("bcOther").textContent       = other;
  document.getElementById("progressPct").textContent   = pct + "%";
  document.getElementById("progressLabel").textContent = `${used} of ${ent} annual days used`;

  // Special leave breakdown
  document.getElementById("ltUnpaid").textContent    = `${EMP.unpaidUsed||0} days`;
  document.getElementById("ltPaternity").textContent = `${EMP.paternityUsed||0} / 4 days`;
  document.getElementById("ltHajj").textContent      = `${EMP.hajjUsed||0} / 30 days`;
  document.getElementById("ltEmergency").textContent = `${EMP.emergencyUsed||0} days`;
  document.getElementById("ltCustom").textContent    = `${EMP.customUsed||0} days`;

  const fill = document.getElementById("progressFill");
  fill.style.width = pct + "%";
  fill.className   = "progress-fill" + (pct >= 90 ? " danger" : pct >= 70 ? " warn" : "");

  const cs = EMP.cycleStart, ce = EMP.cycleEnd || cycleEnd(cs || todayStr());
  document.getElementById("cycleInfo").textContent =
    `Cycle: ${fmtDate(cs)} – ${fmtDate(ce)} | ${EMP.dept} Staff`;
}

// ── Live requests ────────────────────────────────────────────────
function listenMyRequests() {
  const q = query(
    collection(db, "leaveRequests"),
    where("employeeId", "==", ME.uid),
    orderBy("submittedAt", "desc")
  );
  onSnapshot(q, snap => {
    myRequests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderHistory();
    renderUpcoming();
    renderCalendar();
  });
}

function listenAllRequests() {
  onSnapshot(collection(db, "leaveRequests"), snap => {
    allRequests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  });
}

// ── Upcoming ─────────────────────────────────────────────────────
function renderUpcoming() {
  const today = todayStr();
  const upcoming = myRequests
    .filter(r => r.status === "Approved" && r.endDate >= today)
    .sort((a,b) => a.startDate.localeCompare(b.startDate))
    .slice(0, 5);

  const el = document.getElementById("upcomingLeave");
  if (!upcoming.length) {
    el.innerHTML = `<div class="list-empty">No upcoming approved leave.</div>`; return;
  }
  el.innerHTML = upcoming.map(r => `
    <div class="list-item">
      <div>
        <div style="font-weight:600">${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}</div>
        <div style="font-size:11px;color:var(--gray-400)">${r.days} working day(s)</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        ${leaveTypeBadge(r.leaveType)}
        ${statusBadge(r.status)}
      </div>
    </div>`).join("");
}

// ── History ──────────────────────────────────────────────────────
function renderHistory() {
  const filter     = document.getElementById("historyFilter").value;
  const typeFilter = document.getElementById("historyTypeFilter").value;
  let list = [...myRequests];
  if (filter     !== "all") list = list.filter(r => r.status    === filter);
  if (typeFilter !== "all") list = list.filter(r => r.leaveType === typeFilter);

  const el = document.getElementById("historyList");
  if (!list.length) {
    el.innerHTML = `<div class="list-empty">No requests found.</div>`; return;
  }

  el.innerHTML = list.map(r => `
    <div class="request-item">
      <div class="req-top">
        <span class="req-dates">${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}</span>
        ${statusBadge(r.status)}
      </div>
      <div class="req-meta">
        <span class="req-days">${r.days} working day(s)</span>
        ${leaveTypeBadge(r.leaveType)}
        ${r.customReason ? `<span style="font-size:11px;color:var(--gray-500)">${r.customReason}</span>` : ""}
        ${r.hasClash ? `<span class="clash-flag">⚠️ Clash</span>` : ""}
        ${r.requestPattern ? `<span style="font-size:10px;color:var(--gray-400)">${r.requestPattern}</span>` : ""}
      </div>
      <div class="req-bottom">
        <span class="req-notes">${r.notes||""}</span>
        <div class="req-actions">
          ${r.status === "Pending" ? `
            <button class="btn btn-outline-sm btn-xs" onclick="openEditModal('${r.id}')">Edit</button>
            <button class="btn btn-xs" style="background:var(--red-light);color:var(--red)"
              onclick="cancelRequest('${r.id}')">Cancel</button>` : ""}
        </div>
      </div>
    </div>`).join("");
}

document.getElementById("historyFilter").addEventListener("change", renderHistory);
document.getElementById("historyTypeFilter").addEventListener("change", renderHistory);

// ── Leave type change handlers ────────────────────────────────────
document.getElementById("fLeaveType").addEventListener("change", () => {
  const type = document.getElementById("fLeaveType").value;
  document.getElementById("customReasonGroup").style.display =
    type === "Custom" ? "block" : "none";
  validateDates();
});

document.getElementById("editLeaveType").addEventListener("change", () => {
  const type = document.getElementById("editLeaveType").value;
  document.getElementById("editCustomGroup").style.display =
    type === "Custom" ? "block" : "none";
});

// ── Pattern validation ────────────────────────────────────────────
document.getElementById("fPattern")?.addEventListener("input", () => {
  const val = document.getElementById("fPattern").value.toUpperCase();
  const ok  = /^\d+W\d+O$/.test(val);
  document.getElementById("patternHint").textContent = val
    ? (ok ? "✓ Valid pattern" : "✗ Use format like 6W4O or 3W3O")
    : "";
  document.getElementById("patternHint").style.color = ok ? "var(--green)" : "var(--red)";
  validateDates();
  if (ok) renderCalendarWithPattern(val, getRequestRosterStart());
});

document.getElementById("fRosterStart")?.addEventListener("change", () => {
  validateDates();
  const pat = getRequestPattern();
  if (pat && /^\d+W\d+O$/.test(pat)) renderCalendarWithPattern(pat, getRequestRosterStart());
});

// ── Date validation ───────────────────────────────────────────────
const fStart = document.getElementById("fStartDate");
const fEnd   = document.getElementById("fEndDate");

function getRequestPattern() {
  if (EMP?.dept !== "DO") return null;
  return document.getElementById("fPattern").value.toUpperCase().trim() || EMP?.pattern;
}

function getRequestRosterStart() {
  if (EMP?.dept !== "DO") return null;
  return document.getElementById("fRosterStart").value || EMP?.rosterStart;
}

function validateDates() {
  if (!fStart.value || !fEnd.value || !EMP) return;
  const s = fStart.value, e = fEnd.value;
  const pattern     = getRequestPattern();
  const rosterStart = getRequestRosterStart();

  // Validate start
  const startOk = EMP.dept === "GD"
    ? isGDWorkDay(s)
    : isDOWorkDay(s, pattern, rosterStart);
  document.getElementById("startHint").textContent = startOk
    ? "✓ Valid working day" : "✗ Not a working day for your pattern";
  document.getElementById("startHint").style.color = startOk ? "var(--green)" : "var(--red)";

  // Validate end
  const endOk = EMP.dept === "GD"
    ? isGDWorkDay(e)
    : isDOWorkDay(e, pattern, rosterStart);
  document.getElementById("endHint").textContent = endOk
    ? "✓ Valid working day" : "✗ Not a working day for your pattern";
  document.getElementById("endHint").style.color = endOk ? "var(--green)" : "var(--red)";

  if (!startOk || !endOk || e < s) {
    document.getElementById("daysPreview").style.display = "none"; return;
  }

  const days = countWorkDays(s, e, EMP.dept, pattern, rosterStart);
  document.getElementById("daysPreview").style.display = "block";
  document.getElementById("daysCount").textContent = days;

  // Balance warning for Annual
  const leaveType = document.getElementById("fLeaveType").value;
  const bw  = document.getElementById("balanceWarning");
  const lw  = document.getElementById("limitWarning");
  const rem = (EMP.entitlement || 0) - (EMP.leaveUsed || 0);

  if (leaveType === "Annual" && days > rem) {
    bw.style.display = "block";
    bw.textContent = `⚠️ Only ${rem} annual days remaining but ${days} selected.`;
  } else { bw.style.display = "none"; }

  // Max day warnings for Paternity/Hajj
  const cfg = LEAVE_TYPES[leaveType];
  if (cfg?.maxDays) {
    const used = EMP[balanceField(leaveType)] || 0;
    const available = cfg.maxDays - used;
    if (days > available) {
      lw.style.display = "block";
      lw.textContent = `⚠️ ${leaveType} allowance: ${available} day(s) remaining of ${cfg.maxDays}.`;
    } else { lw.style.display = "none"; }
  } else { lw.style.display = "none"; }

  // Clash check
  const clashing = detectClashes(s, e, allRequests.filter(r => r.employeeId !== ME.uid));
  const cw = document.getElementById("clashWarning");
  if (clashing.length >= 2) {
    cw.style.display = "block";
    document.getElementById("clashMsg").textContent =
      `${clashing.length} other staff on leave at the same time: ${clashing.join(", ")}`;
  } else { cw.style.display = "none"; }
}

fStart.addEventListener("change", validateDates);
fEnd.addEventListener("change",   validateDates);
document.getElementById("fLeaveType").addEventListener("change", validateDates);

// ── Submit request ────────────────────────────────────────────────
document.getElementById("leaveForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("formError");
  errEl.textContent = "";

  const leaveType    = document.getElementById("fLeaveType").value;
  const customReason = document.getElementById("fCustomReason").value.trim();
  const s            = fStart.value;
  const e2           = fEnd.value;
  const notes        = document.getElementById("fNotes").value.trim();
  const pattern      = getRequestPattern();
  const rosterStart  = getRequestRosterStart();

  if (!s || !e2) { errEl.textContent = "Select start and end dates."; return; }
  if (e2 < s)    { errEl.textContent = "End date must be after start date."; return; }

  if (leaveType === "Custom" && !customReason) {
    errEl.textContent = "Please enter a reason for custom leave."; return;
  }

  if (EMP.dept === "DO") {
    if (!pattern || !pattern.match(/^\d+W\d+O$/i)) {
      errEl.textContent = "Enter a valid shift pattern (e.g. 6W4O)."; return;
    }
    if (!rosterStart) {
      errEl.textContent = "Enter your roster cycle start date."; return;
    }
  }

  const startOk = EMP.dept === "GD" ? isGDWorkDay(s) : isDOWorkDay(s, pattern, rosterStart);
  const endOk   = EMP.dept === "GD" ? isGDWorkDay(e2): isDOWorkDay(e2, pattern, rosterStart);
  if (!startOk) { errEl.textContent = "Start date is not a valid working day."; return; }
  if (!endOk)   { errEl.textContent = "End date is not a valid working day."; return; }

  const days = countWorkDays(s, e2, EMP.dept, pattern, rosterStart);
  if (days === 0) { errEl.textContent = "No working days in selected range."; return; }

  // Balance checks
  if (leaveType === "Annual") {
    const rem = (EMP.entitlement || 0) - (EMP.leaveUsed || 0);
    if (days > rem) { errEl.textContent = `Insufficient balance. ${rem} days remaining.`; return; }
  }

  const cfg = LEAVE_TYPES[leaveType];
  if (cfg?.maxDays) {
    const used = EMP[balanceField(leaveType)] || 0;
    if (days > cfg.maxDays - used) {
      errEl.textContent = `${leaveType} allowance exceeded. ${cfg.maxDays - used} day(s) remaining.`; return;
    }
  }

  const clashing = detectClashes(s, e2, allRequests.filter(r => r.employeeId !== ME.uid));
  const hasClash = clashing.length >= 2;

  try {
    await addDoc(collection(db, "leaveRequests"), {
      employeeId:     ME.uid,
      employeeName:   EMP.name,
      employeeDept:   EMP.dept,
      employeeEmail:  EMP.email,
      groupId:        EMP.groupId || null,
      leaveType, customReason: customReason || null,
      requestPattern: EMP.dept === "DO" ? pattern : null,
      requestRosterStart: EMP.dept === "DO" ? rosterStart : null,
      startDate: s, endDate: e2, days, notes,
      status:      "Pending",
      hasClash, clashingWith: clashing,
      submittedAt: serverTimestamp(),
      editedAt:    null,
      cycleId:     EMP.cycleId || null
    });

    await addDoc(collection(db, "emailQueue"), {
      type:    "new_request",
      to:      "managers",
      subject: `New Leave Request — ${EMP.name}`,
      body:    `${EMP.name} submitted a ${leaveType} leave request.\nFrom: ${fmtDate(s)} To: ${fmtDate(e2)}\nDays: ${days}\n${customReason ? "Reason: "+customReason : ""}\nNotes: ${notes||"None"}`,
      sentAt:  serverTimestamp()
    });

    toast("Leave request submitted!");
    document.getElementById("leaveForm").reset();
    document.getElementById("daysPreview").style.display   = "none";
    document.getElementById("clashWarning").style.display  = "none";
    document.getElementById("balanceWarning").style.display= "none";
    document.getElementById("limitWarning").style.display  = "none";
    document.getElementById("startHint").textContent = "";
    document.getElementById("endHint").textContent   = "";
    document.getElementById("customReasonGroup").style.display = "none";

    // Re-prefill pattern
    if (EMP.dept === "DO" && EMP.pattern) {
      document.getElementById("fPattern").value     = EMP.pattern;
      document.getElementById("fRosterStart").value = EMP.rosterStart || "";
    }

    // Switch to history
    switchSection("history");

  } catch(err) {
    errEl.textContent = "Failed to submit. Please try again.";
    console.error(err);
  }
});

// ── Edit request ──────────────────────────────────────────────────
window.openEditModal = (id) => {
  const r = myRequests.find(x => x.id === id);
  if (!r) return;
  document.getElementById("editRequestId").value  = id;
  document.getElementById("editStart").value      = r.startDate;
  document.getElementById("editEnd").value        = r.endDate;
  document.getElementById("editNotes").value      = r.notes || "";
  document.getElementById("editLeaveType").value  = r.leaveType || "Annual";
  document.getElementById("editCustomReason").value = r.customReason || "";
  document.getElementById("editCustomGroup").style.display =
    r.leaveType === "Custom" ? "block" : "none";
  document.getElementById("editError").textContent = "";
  document.getElementById("editModal").style.display = "flex";
};

document.getElementById("editModalClose").addEventListener("click",  () => document.getElementById("editModal").style.display = "none");
document.getElementById("editModalCancel").addEventListener("click", () => document.getElementById("editModal").style.display = "none");

document.getElementById("editForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id           = document.getElementById("editRequestId").value;
  const s            = document.getElementById("editStart").value;
  const e2           = document.getElementById("editEnd").value;
  const notes        = document.getElementById("editNotes").value.trim();
  const leaveType    = document.getElementById("editLeaveType").value;
  const customReason = document.getElementById("editCustomReason").value.trim();
  const errEl        = document.getElementById("editError");
  errEl.textContent  = "";

  if (leaveType === "Custom" && !customReason) {
    errEl.textContent = "Enter a reason for custom leave."; return;
  }
  if (e2 < s) { errEl.textContent = "End must be after start."; return; }

  const orig = myRequests.find(x => x.id === id);
  const pat  = orig?.requestPattern || EMP.pattern;
  const rs   = orig?.requestRosterStart || EMP.rosterStart;
  const days = countWorkDays(s, e2, EMP.dept, pat, rs);
  if (days === 0) { errEl.textContent = "No working days in range."; return; }

  try {
    await updateDoc(doc(db, "leaveRequests", id), {
      startDate: s, endDate: e2, days, notes,
      leaveType, customReason: customReason || null,
      status: "Pending", editedAt: serverTimestamp()
    });

    await addDoc(collection(db, "emailQueue"), {
      type:    "edited_request",
      to:      "managers",
      subject: `Leave Request Edited — ${EMP.name}`,
      body:    `${EMP.name} edited their leave request.\nNew dates: ${fmtDate(s)} – ${fmtDate(e2)}\nDays: ${days}\nType: ${leaveType}`,
      sentAt:  serverTimestamp()
    });

    toast("Request updated. Manager notified.");
    document.getElementById("editModal").style.display = "none";
  } catch(err) {
    errEl.textContent = "Failed to update."; console.error(err);
  }
});

// ── Cancel ───────────────────────────────────────────────────────
window.cancelRequest = async (id) => {
  if (!confirm("Cancel this leave request?")) return;
  try {
    await updateDoc(doc(db, "leaveRequests", id), { status: "Cancelled" });
    toast("Request cancelled.");
  } catch { toast("Failed to cancel.", "error"); }
};

// ── Mini calendar ─────────────────────────────────────────────────
function renderCalendar() {
  if (!EMP) return;
  const el    = document.getElementById("miniCalendar");
  const today = new Date();
  const year  = today.getFullYear();
  const month = today.getMonth();
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel  = today.toLocaleDateString("en-GB", { month:"long", year:"numeric" });
  // Set month label
  const lblEl = document.getElementById("calMonthLabel");
  if (lblEl) lblEl.textContent = monthLabel;

  const takenDates   = new Set();
  const pendingDates = new Set();
  myRequests.forEach(r => {
    if (r.status === "Rejected" || r.status === "Cancelled") return;
    const cur = new Date(r.startDate + "T00:00:00");
    const end = new Date(r.endDate   + "T00:00:00");
    while (cur <= end) {
      const s = cur.toISOString().split("T")[0];
      if (r.status === "Approved") takenDates.add(s);
      else pendingDates.add(s);
      cur.setDate(cur.getDate() + 1);
    }
  });

  const labels = ["Su","Mo","Tu","We","Th","Fr","Sa"];
  let html = labels.map(l => `<div class="cal-day-label">${l}</div>`).join("");
  for (let i = 0; i < firstDay; i++) html += `<div class="cal-day cal-empty"></div>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const isToday = d === today.getDate();
    const pat     = EMP.pattern || "";
    const rs      = EMP.rosterStart || "";
    const isWork  = EMP.dept === "GD"
      ? isGDWorkDay(dateStr)
      : isDOWorkDay(dateStr, pat, rs);
    const isTaken   = takenDates.has(dateStr);
    const isPending = pendingDates.has(dateStr);

    let cls = "cal-day ";
    if (isTaken)        cls += "cal-taken";
    else if (isPending) cls += "cal-pending";
    else if (isWork)    cls += "cal-work";
    else                cls += "cal-off";
    if (isToday)        cls += " cal-today";

    html += `<div class="${cls}" title="${dateStr}">${d}</div>`;
  }
  el.innerHTML = html;
}

function renderCalendarWithPattern(pattern, rosterStart) {
  if (!EMP) return;
  const orig = { pattern: EMP.pattern, rosterStart: EMP.rosterStart };
  EMP.pattern     = pattern;
  EMP.rosterStart = rosterStart;
  renderCalendar();
  EMP.pattern     = orig.pattern;
  EMP.rosterStart = orig.rosterStart;
}

// ── Team ──────────────────────────────────────────────────────────
async function loadTeam() {
  const el = document.getElementById("teamList");
  const gl = document.getElementById("teamGroupLabel");
  if (!EMP.groupId) {
    el.innerHTML = `<div class="list-empty">You are not assigned to a group yet.</div>`; return;
  }
  try {
    const gSnap = await getDoc(doc(db, "groups", EMP.groupId));
    if (gSnap.exists()) gl.textContent = gSnap.data().name || "My Team";

    const q = query(collection(db, "employees"), where("groupId", "==", EMP.groupId));
    const snap = await getDocs(q);
    const members = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(m => m.id !== ME.uid);

    if (!members.length) {
      el.innerHTML = `<div class="list-empty">No other members in your group.</div>`; return;
    }
    const today = todayStr();
    el.innerHTML = members.map(m => {
      const onLeave = allRequests.some(r =>
        r.employeeId === m.id && r.status === "Approved" &&
        r.startDate <= today && r.endDate >= today);
      return `
        <div class="list-item">
          <div style="display:flex;align-items:center;gap:10px">
            <div class="group-avatar">${initials(m.name)}</div>
            <div>
              <div style="font-weight:600">${m.name}</div>
              <div style="font-size:11px;color:var(--gray-400)">${m.dept} · ${m.dept==="DO"?(m.pattern||""):"Mon–Thu"}</div>
            </div>
          </div>
          ${onLeave
            ? `<span class="status-badge sb-approved">On Leave</span>`
            : `<span style="color:var(--gray-300);font-size:12px">Available</span>`}
        </div>`;
    }).join("");
  } catch(err) {
    el.innerHTML = `<div class="list-empty">Could not load team.</div>`; console.error(err);
  }
}

// ── Auto renewal check ────────────────────────────────────────────
function checkRenewal() {
  if (!EMP?.cycleEnd) return;
  const diff = Math.ceil((new Date(EMP.cycleEnd+"T00:00:00") - new Date()) / 86400000);
  if (diff <= 30 && diff >= 0)
    toast(`Your leave cycle expires in ${diff} day(s). Contact your manager to renew.`, "warning");
}

// ── Previous cycles ───────────────────────────────────────────────
document.getElementById("togglePrevCycles").addEventListener("click", async () => {
  const body = document.getElementById("prevCyclesBody");
  const btn  = document.getElementById("togglePrevCycles");
  if (body.style.display === "none") {
    body.style.display = "block"; btn.textContent = "Hide";
    await loadPrevCycles();
  } else { body.style.display = "none"; btn.textContent = "Show"; }
});

async function loadPrevCycles() {
  const el = document.getElementById("prevCyclesList");
  try {
    const q = query(
      collection(db, "cycleHistory"),
      where("employeeId", "==", ME.uid),
      orderBy("archivedAt", "desc")
    );
    const snap = await getDocs(q);
    if (snap.empty) { el.innerHTML = `<div class="list-empty">No previous cycles.</div>`; return; }
    el.innerHTML = snap.docs.map(d => {
      const c = d.data();
      return `<div class="list-item">
        <div>
          <div style="font-weight:600">${fmtDate(c.cycleStart)} – ${fmtDate(c.cycleEnd)}</div>
          <div style="font-size:11px;color:var(--gray-400)">Entitlement: ${c.entitlement} days · Used: ${c.leaveUsed} days</div>
        </div>
      </div>`;
    }).join("");
  } catch(err) {
    el.innerHTML = `<div class="list-empty">Could not load history.</div>`; console.error(err);
  }
}
