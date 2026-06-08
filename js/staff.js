// js/staff.js
import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut,
         EmailAuthProvider, reauthenticateWithCredential, updatePassword }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, collection, query, where, onSnapshot,
         addDoc, updateDoc, serverTimestamp, getDocs, orderBy }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { fmtDate, todayStr, cycleEnd,
         isGDWorkDay, isDOWorkDay, countWorkDays,
         detectClashes, statusBadge, leaveTypeBadge,
         LEAVE_TYPES, balanceField, toast, initials }
  from "./utils.js";
import { sendEmail, notifyManagers } from "./email.js";

let ME = null;
let EMP = null;
let myRequests = [];
let allRequests = [];

// Calendar state
let calViewYear  = new Date().getFullYear();
let calViewMonth = new Date().getMonth();
let calStartDate = null;
let calEndDate   = null;
let calSelectingEnd = false;

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
  if (!eSnap.exists()) { toast("Employee record not found. Contact your manager.", "error"); return; }
  EMP = { id: eSnap.id, ...eSnap.data() };

  // Restore last used pattern/roster from previous requests
  await restoreLastRoster();

  if (EMP.dept === "DO") {
    document.getElementById("doPatternFields").style.display = "block";
  }
  // GD staff: calendar renders automatically with Mon-Thu working days
  // No pattern needed — isGDWorkDay handles Mon-Thu automatically

  renderBalance();
  renderDualCalendar();
  listenMyRequests();
  listenAllRequests();
  listenForAutoRenewal();
  loadTeam();
  checkRenewal();
});

// ── Restore last roster from previous request ────────────────────
async function restoreLastRoster() {
  if (EMP.dept !== "DO") return;
  try {
    const q = query(
      collection(db, "leaveRequests"),
      where("employeeId", "==", ME.uid),
      orderBy("submittedAt", "desc")
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      const last = snap.docs[0].data();
      if (last.requestPattern)     { EMP._lastPattern     = last.requestPattern;     }
      if (last.requestRosterStart) { EMP._lastRosterStart = last.requestRosterStart; }
    }
  } catch {}

  // Set form values: last used takes priority over employee default
  const pattern     = EMP._lastPattern     || EMP.pattern     || "";
  const rosterStart = EMP._lastRosterStart || EMP.rosterStart || "";
  if (pattern)     document.getElementById("fPattern").value     = pattern;
  if (rosterStart) document.getElementById("fRosterStart").value = rosterStart;
}

// ── Sign out ─────────────────────────────────────────────────────
document.getElementById("logoutBtn").addEventListener("click", async () => {
  localStorage.removeItem("als_role");
  localStorage.removeItem("als_uid");
  localStorage.removeItem("als_uid");
  localStorage.removeItem("als_role");
  await signOut(auth);
  location.href = "../index.html";
});

// ── Navigation ────────────────────────────────────────────────────
function switchSection(name) {
  document.querySelectorAll(".bnav-item").forEach(b => b.classList.toggle("active", b.dataset.section === name));
  document.querySelectorAll(".nav-tab[data-section]").forEach(t => t.classList.toggle("active", t.dataset.section === name));
  document.querySelectorAll(".page-section").forEach(s => s.classList.remove("active"));
  document.getElementById("section-" + name).classList.add("active");
  if (name === "request") renderDualCalendar();
}
document.querySelectorAll(".bnav-item").forEach(b => b.addEventListener("click", () => switchSection(b.dataset.section)));
document.querySelectorAll(".nav-tab[data-section]").forEach(t => t.addEventListener("click", () => switchSection(t.dataset.section)));

// ── Balance ───────────────────────────────────────────────────────
function renderBalance() {
  const used = EMP.leaveUsed || 0, ent = EMP.entitlement || 0;
  const remaining = Math.max(0, ent - used);
  const pct = ent > 0 ? Math.min(100, Math.round(used / ent * 100)) : 0;
  const other = (EMP.unpaidUsed||0)+(EMP.paternityUsed||0)+(EMP.hajjUsed||0)+(EMP.emergencyUsed||0)+(EMP.customUsed||0);
  document.getElementById("bcEntitlement").textContent = ent;
  document.getElementById("bcUsed").textContent        = used;
  document.getElementById("bcRemaining").textContent   = remaining;
  document.getElementById("bcOther").textContent       = other;
  document.getElementById("progressPct").textContent   = pct + "%";
  document.getElementById("progressLabel").textContent = `${used} of ${ent} annual days used`;
  document.getElementById("ltUnpaid").textContent      = `${EMP.unpaidUsed||0} days`;
  document.getElementById("ltPaternity").textContent   = `${EMP.paternityUsed||0} / 4 days`;
  document.getElementById("ltHajj").textContent        = `${EMP.hajjUsed||0} / 30 days`;
  document.getElementById("ltEmergency").textContent   = `${EMP.emergencyUsed||0} days`;
  document.getElementById("ltCustom").textContent      = `${EMP.customUsed||0} days`;
  const fill = document.getElementById("progressFill");
  fill.style.width = pct + "%";
  fill.className = "progress-fill" + (pct >= 90 ? " danger" : pct >= 70 ? " warn" : "");
  const cs = EMP.cycleStart, ce = EMP.cycleEnd || cycleEnd(cs || todayStr());
  document.getElementById("cycleInfo").textContent = `Cycle: ${fmtDate(cs)} – ${fmtDate(ce)} | ${EMP.dept} Staff`;
}

// ── Requests ──────────────────────────────────────────────────────
function listenMyRequests() {
  const q = query(collection(db,"leaveRequests"), where("employeeId","==",ME.uid), orderBy("submittedAt","desc"));
  onSnapshot(q, snap => {
    myRequests = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderHistory(); renderUpcoming(); renderDualCalendar();
  });
}
function listenAllRequests() {
  onSnapshot(collection(db,"leaveRequests"), snap => {
    allRequests = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    // Refresh team view if loaded
    if (EMP && EMP.groupId) loadTeam();
  });
}

// ── Auto-renewal listener ─────────────────────────────────────────
function listenForAutoRenewal() {
  const empRef = doc(db, "employees", ME.uid);
  onSnapshot(empRef, async (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    EMP = { id: snap.id, ...data };
    renderBalance();
    const used = data.leaveUsed || 0, ent = data.entitlement || 0;
    if (used >= ent && ent > 0 && !window._renewalPrompted) {
      window._renewalPrompted = true;
      showSelfRenewalModal(data);
    }
  });
}

async function showSelfRenewalModal(empData) {
  const joinDate = new Date(empData.joinDate + "T00:00:00");
  const today    = new Date();
  let nextAnniv  = new Date(today.getFullYear(), joinDate.getMonth(), joinDate.getDate());
  if (nextAnniv <= today) nextAnniv.setFullYear(nextAnniv.getFullYear() + 1);
  const nextAnnivStr = nextAnniv.toISOString().split("T")[0];

  const overlay = document.createElement("div");
  overlay.id = "renewalModal";
  overlay.className = "modal-bg";
  overlay.style.display = "flex";
  overlay.innerHTML = `
    <div class="modal-box modal-sm">
      <div class="modal-hd"><span>🔄 Leave Balance Renewed</span></div>
      <div class="modal-bd">
        <div class="renew-info">
          Your annual leave balance has reached 0.<br><br>
          Your new cycle will start from your joining date anniversary:<br>
          <strong>${fmtDate(nextAnnivStr)}</strong><br><br>
          You can request leave on or after this date in the new cycle.
        </div>
        <div class="field-group">
          <label>New Cycle Entitlement (days) *</label>
          <input type="number" id="selfRenewalDays" placeholder="e.g. 30" min="1" style="font-size:16px;padding:12px;"/>
        </div>
        <div class="form-error" id="selfRenewalError"></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-primary btn-block" id="selfRenewalConfirm">Renew My Cycle</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById("selfRenewalConfirm").addEventListener("click", async () => {
    const days = parseInt(document.getElementById("selfRenewalDays").value);
    const errEl = document.getElementById("selfRenewalError");
    if (!days || days < 1) { errEl.textContent = "Please enter a valid number of days."; return; }
    const btn = document.getElementById("selfRenewalConfirm");
    btn.disabled = true; btn.textContent = "Renewing...";
    try {
      const cycleStartNew = nextAnnivStr;
      const cycleEndNew   = cycleEnd(cycleStartNew);
      await addDoc(collection(db, "cycleHistory"), {
        employeeId: ME.uid, employeeName: EMP.name, dept: EMP.dept,
        cycleStart: EMP.cycleStart, cycleEnd: EMP.cycleEnd,
        entitlement: EMP.entitlement, leaveUsed: EMP.leaveUsed||0,
        unpaidUsed: EMP.unpaidUsed||0, archivedAt: serverTimestamp()
      });
      await updateDoc(doc(db, "employees", ME.uid), {
        cycleStart: cycleStartNew, cycleEnd: cycleEndNew,
        entitlement: days, leaveUsed: 0, unpaidUsed: 0,
        paternityUsed: 0, hajjUsed: 0, emergencyUsed: 0, customUsed: 0,
        cycleId: `${ME.uid}_${cycleStartNew}`
      });
      await addDoc(collection(db, "auditLog"), {
        action: "cycle_renewed", label: `Self-renewal by ${EMP.name}`,
        detail: `New cycle: ${fmtDate(cycleStartNew)} – ${fmtDate(cycleEndNew)} · ${days} days`,
        by: EMP.name, at: serverTimestamp()
      });
      // Notify managers of self-renewal
      notifyManagers(
        `Self-Renewal — ${EMP.name}`,
        `${EMP.name} has self-renewed their leave cycle.\nNew cycle: ${fmtDate(cycleStartNew)} – ${fmtDate(cycleEndNew)}\nNew entitlement: ${days} days\n\nThis was automatic when their balance reached 0.`
      );
      toast("Your leave cycle has been renewed! You now have " + days + " days.");
      overlay.remove();
      window._renewalPrompted = false;
    } catch(err) {
      errEl.textContent = "Failed to renew. Please try again.";
      btn.disabled = false; btn.textContent = "Renew My Cycle";
      console.error(err);
    }
  });
}

// ── Upcoming ─────────────────────────────────────────────────────
function renderUpcoming() {
  const today = todayStr();
  const upcoming = myRequests.filter(r => r.status==="Approved" && r.endDate>=today)
    .sort((a,b) => a.startDate.localeCompare(b.startDate)).slice(0,5);
  const el = document.getElementById("upcomingLeave");
  if (!upcoming.length) { el.innerHTML=`<div class="list-empty">No upcoming approved leave.</div>`; return; }
  el.innerHTML = upcoming.map(r => `
    <div class="list-item">
      <div>
        <div style="font-weight:600">${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}</div>
        <div style="font-size:11px;color:var(--gray-400)">${r.days} working day(s)</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">${leaveTypeBadge(r.leaveType)}${statusBadge(r.status)}</div>
    </div>`).join("");
}

// ── History ──────────────────────────────────────────────────────
function renderHistory() {
  const filter = document.getElementById("historyFilter").value;
  const typeFilter = document.getElementById("historyTypeFilter").value;
  let list = [...myRequests];
  if (filter !== "all") list = list.filter(r => r.status === filter);
  if (typeFilter !== "all") list = list.filter(r => r.leaveType === typeFilter);
  const el = document.getElementById("historyList");
  if (!list.length) { el.innerHTML=`<div class="list-empty">No requests found.</div>`; return; }
  el.innerHTML = list.map(r => `
    <div class="request-item">
      <div class="req-top">
        <span class="req-dates">${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}</span>
        ${statusBadge(r.status)}
      </div>
      <div class="req-meta">
        <span class="req-days">${r.days} working day(s)</span>
        ${leaveTypeBadge(r.leaveType)}
        ${r.customReason?`<span style="font-size:11px;color:var(--gray-500)">${r.customReason}</span>`:""}
        ${r.hasClash?`<span class="clash-flag">⚠️ Clash</span>`:""}
        ${r.requestPattern?`<span style="font-size:10px;color:var(--gray-400)">${r.requestPattern}</span>`:""}
      </div>
      <div class="req-bottom">
        <span class="req-notes">${r.notes||""}</span>
        <div class="req-actions">
          ${r.status==="Pending"?`
            <button class="btn btn-outline-sm btn-xs" onclick="openEditModal('${r.id}')">Edit</button>
            <button class="btn btn-xs" style="background:var(--red-light);color:var(--red)" onclick="cancelRequest('${r.id}')">Cancel</button>`:""}
          ${r.status==="Approved" && !r.editRequested?`
            <button class="btn btn-outline-sm btn-xs" onclick="requestEdit('${r.id}')">Request Edit</button>`:""}
          ${r.status==="Approved" && r.editRequested?`
            <span style="font-size:11px;color:var(--orange)">⏳ Edit Requested</span>`:""}
          ${r.status==="EditAllowed"?`
            <button class="btn btn-outline-sm btn-xs" onclick="openEditModal('${r.id}')">Edit Now</button>`:""}
        </div>
      </div>
    </div>`).join("");
}
document.getElementById("historyFilter").addEventListener("change", renderHistory);
document.getElementById("historyTypeFilter").addEventListener("change", renderHistory);

// ── Leave type handlers ───────────────────────────────────────────
document.getElementById("fLeaveType").addEventListener("change", () => {
  document.getElementById("customReasonGroup").style.display =
    document.getElementById("fLeaveType").value === "Custom" ? "block" : "none";
  updateFormFromCalendar();
});
document.getElementById("editLeaveType").addEventListener("change", () => {
  document.getElementById("editCustomGroup").style.display =
    document.getElementById("editLeaveType").value === "Custom" ? "block" : "none";
});

// ── Pattern handlers ──────────────────────────────────────────────
document.getElementById("fPattern")?.addEventListener("input", () => {
  const val = document.getElementById("fPattern").value.toUpperCase();
  const ok = /^\d+W\d+O$/.test(val);
  document.getElementById("patternHint").textContent = val ? (ok?"✓ Valid pattern":"✗ Use format like 6W4O"): "";
  document.getElementById("patternHint").style.color = ok ? "var(--green)" : "var(--red)";
  if (ok) renderDualCalendar();
});
document.getElementById("fRosterStart")?.addEventListener("change", () => {
  const rs = document.getElementById("fRosterStart").value;
  if (rs) {
    const d = new Date(rs + "T00:00:00");
    calViewYear  = d.getFullYear();
    calViewMonth = d.getMonth();
  }
  renderDualCalendar();
});

// ── Helpers ───────────────────────────────────────────────────────
function getRequestPattern() {
  if (EMP?.dept !== "DO") return null;
  return (document.getElementById("fPattern")?.value.toUpperCase().trim()) || EMP?.pattern;
}
function getRequestRosterStart() {
  if (EMP?.dept !== "DO") return null;
  return document.getElementById("fRosterStart")?.value || EMP?.rosterStart;
}
function isWorkDay(dateStr) {
  if (!EMP) return false;
  if (EMP.dept === "GD") return isGDWorkDay(dateStr);
  return isDOWorkDay(dateStr, getRequestPattern(), getRequestRosterStart());
}

// ── Dual Calendar ─────────────────────────────────────────────────
function renderDualCalendar() {
  const cal1 = document.getElementById("cal1");
  const cal2 = document.getElementById("cal2");
  if (!cal1 || !cal2) return;

  // Month 1
  cal1.innerHTML = buildMonthHTML(calViewYear, calViewMonth);
  // Month 2
  let m2 = calViewMonth + 1, y2 = calViewYear;
  if (m2 > 11) { m2 = 0; y2++; }
  cal2.innerHTML = buildMonthHTML(y2, m2);

  // Update nav label
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const lbl = document.getElementById("calNavLabel");
  if (lbl) lbl.textContent = `${months[calViewMonth]} ${calViewYear}  –  ${months[m2]} ${y2}`;

  // Attach click handlers
  document.querySelectorAll(".cal-day.cal-work, .cal-day.cal-taken, .cal-day.cal-pending").forEach(el => {
    el.addEventListener("click", () => {
      const dateStr = el.dataset.date;
      if (!dateStr || !isWorkDay(dateStr)) return;
      handleCalendarDayClick(dateStr);
    });
  });

  updateFormFromCalendar();
}

function buildMonthHTML(year, month) {
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const today  = new Date();
  const todayStr2 = todayStr();

  // Build taken/pending sets
  const takenDates   = new Set();
  const pendingDates = new Set();
  myRequests.forEach(r => {
    if (r.status === "Rejected" || r.status === "Cancelled") return;
    const cur = new Date(r.startDate + "T00:00:00");
    const end = new Date(r.endDate   + "T00:00:00");
    while (cur <= end) {
      // Use local date to avoid UTC timezone shift
      const s = cur.getFullYear() + "-" +
        String(cur.getMonth()+1).padStart(2,"0") + "-" +
        String(cur.getDate()).padStart(2,"0");
      if (r.status === "Approved") takenDates.add(s); else pendingDates.add(s);
      cur.setDate(cur.getDate() + 1);
    }
  });

  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let html = `<div class="cal-month-label">${months[month]} ${year}</div>`;
  html += `<div class="cal-grid">`;
  ["Su","Mo","Tu","We","Th","Fr","Sa"].forEach(l => {
    html += `<div class="cal-day-label">${l}</div>`;
  });

  for (let i = 0; i < firstDay; i++) html += `<div class="cal-day cal-empty"></div>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const isToday = dateStr === todayStr2;
    const isWork  = isWorkDay(dateStr);
    const isTaken   = takenDates.has(dateStr);
    const isPending = pendingDates.has(dateStr);

    // Check if in selected range
    const inRange = calStartDate && calEndDate && dateStr >= calStartDate && dateStr <= calEndDate;
    const isStart = dateStr === calStartDate;
    const isEnd   = dateStr === calEndDate;

    let cls = "cal-day ";
    if (isStart || isEnd)   cls += "cal-selected";
    else if (inRange)       cls += "cal-in-range";
    else if (isTaken)       cls += "cal-taken";
    else if (isPending)     cls += "cal-pending";
    else if (isWork)        cls += "cal-work";
    else                    cls += "cal-off";
    if (isToday)            cls += " cal-today";

    const clickable = isWork && !isTaken;
    html += `<div class="${cls}" data-date="${dateStr}" ${clickable?"style='cursor:pointer'":""}>${d}</div>`;
  }
  html += `</div>`;
  return html;
}

function handleCalendarDayClick(dateStr) {
  if (!calStartDate || calSelectingEnd === false && calStartDate && calEndDate) {
    // Start fresh selection
    calStartDate    = dateStr;
    calEndDate      = null;
    calSelectingEnd = true;
  } else if (calSelectingEnd) {
    if (dateStr < calStartDate) {
      calEndDate   = calStartDate;
      calStartDate = dateStr;
    } else {
      calEndDate = dateStr;
    }
    calSelectingEnd = false;
  }
  renderDualCalendar();
  updateFormFromCalendar();
  updateDaysPreview();
}

function updateFormFromCalendar() {
  if (calStartDate) document.getElementById("fStartDate").value = calStartDate;
  if (calEndDate)   document.getElementById("fEndDate").value   = calEndDate;

  // Show start/end hints
  if (calStartDate) {
    const ok = isWorkDay(calStartDate);
    document.getElementById("startHint").textContent = ok ? "✓ Valid working day" : "✗ Not a working day";
    document.getElementById("startHint").style.color = ok ? "var(--green)" : "var(--red)";
  }
  if (calEndDate) {
    const ok = isWorkDay(calEndDate);
    document.getElementById("endHint").textContent = ok ? "✓ Valid working day" : "✗ Not a working day";
    document.getElementById("endHint").style.color = ok ? "var(--green)" : "var(--red)";
  }

  updateDaysPreview();
}

function updateDaysPreview() {
  if (!calStartDate || !calEndDate || !EMP) {
    document.getElementById("daysPreview").style.display = "none";
    return;
  }
  const s = calStartDate, e = calEndDate;
  const pattern = getRequestPattern(), rosterStart = getRequestRosterStart();
  const days = countWorkDays(s, e, EMP.dept, pattern, rosterStart);
  document.getElementById("daysPreview").style.display = "block";
  document.getElementById("daysCount").textContent = days;

  // Balance warnings
  const leaveType = document.getElementById("fLeaveType").value;
  const rem = (EMP.entitlement||0) - (EMP.leaveUsed||0);
  const bw = document.getElementById("balanceWarning");
  if (leaveType==="Annual" && days>rem) { bw.style.display="block"; bw.textContent=`⚠️ Only ${rem} annual days remaining.`; } else bw.style.display="none";
  const cfg = LEAVE_TYPES[leaveType];
  const lw = document.getElementById("limitWarning");
  if (cfg?.maxDays) {
    const avail = cfg.maxDays-(EMP[balanceField(leaveType)]||0);
    if (days>avail) { lw.style.display="block"; lw.textContent=`⚠️ ${leaveType} allowance: ${avail} day(s) remaining.`; } else lw.style.display="none";
  } else lw.style.display="none";

  // Clash — group only
  const groupRequests = allRequests.filter(r => r.employeeId!==ME.uid && r.groupId===EMP.groupId && EMP.groupId);
  const clashing = detectClashesWithDates(s, e, groupRequests);
  const cw = document.getElementById("clashWarning");
  if (clashing.length > 0) {
    cw.style.display="block";
    document.getElementById("clashMsg").innerHTML = clashing.map(c =>
      `⚠️ <strong>${c.name}</strong> is on leave: ${fmtDate(c.startDate)} – ${fmtDate(c.endDate)}`
    ).join("<br/>");
  } else cw.style.display="none";
}

// Also allow manual date input to update calendar
document.getElementById("fStartDate").addEventListener("change", () => {
  const val = document.getElementById("fStartDate").value;
  if (val) {
    calStartDate = val;
    const d = new Date(val + "T00:00:00");
    calViewYear = d.getFullYear(); calViewMonth = d.getMonth();
    renderDualCalendar();
  }
});
document.getElementById("fEndDate").addEventListener("change", () => {
  const val = document.getElementById("fEndDate").value;
  if (val) { calEndDate = val; renderDualCalendar(); }
});

// Nav buttons
document.getElementById("calPrev")?.addEventListener("click", () => {
  calViewMonth--; if (calViewMonth < 0) { calViewMonth = 11; calViewYear--; }
  renderDualCalendar();
});
document.getElementById("calNext")?.addEventListener("click", () => {
  calViewMonth++; if (calViewMonth > 11) { calViewMonth = 0; calViewYear++; }
  renderDualCalendar();
});

// ── Submit ────────────────────────────────────────────────────────
document.getElementById("leaveForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("formError");
  errEl.textContent = "";
  const leaveType    = document.getElementById("fLeaveType").value;
  const customReason = document.getElementById("fCustomReason").value.trim();
  const s            = calStartDate || document.getElementById("fStartDate").value;
  const e2           = calEndDate   || document.getElementById("fEndDate").value;
  const notes        = document.getElementById("fNotes").value.trim();
  const pattern      = getRequestPattern();
  const rosterStart  = getRequestRosterStart();

  if (!s || !e2) { errEl.textContent="Select start and end dates on the calendar."; return; }
  if (e2 < s)    { errEl.textContent="End date must be after start date."; return; }
  if (leaveType==="Custom" && !customReason) { errEl.textContent="Enter a reason for custom leave."; return; }
  if (EMP.dept==="DO") {
    if (!pattern?.match(/^\d+W\d+O$/i)) { errEl.textContent="Enter a valid shift pattern (e.g. 6W4O)."; return; }
    if (!rosterStart) { errEl.textContent="Enter your roster cycle start date."; return; }
  }
  if (!isWorkDay(s))  { errEl.textContent="Start date is not a valid working day."; return; }
  if (!isWorkDay(e2)) { errEl.textContent="End date is not a valid working day."; return; }

  const days = countWorkDays(s, e2, EMP.dept, pattern, rosterStart);
  if (days===0) { errEl.textContent="No working days in selected range."; return; }
  if (leaveType==="Annual") {
    const rem = (EMP.entitlement||0)-(EMP.leaveUsed||0);
    if (days>rem) { errEl.textContent=`Insufficient balance. ${rem} days remaining.`; return; }
  }
  const cfg = LEAVE_TYPES[leaveType];
  if (cfg?.maxDays) {
    const avail = cfg.maxDays-(EMP[balanceField(leaveType)]||0);
    if (days>avail) { errEl.textContent=`${leaveType} allowance exceeded. ${avail} day(s) remaining.`; return; }
  }
  const groupReqs = allRequests.filter(r => r.employeeId!==ME.uid && r.groupId===EMP.groupId && EMP.groupId);
  const clashDetails = detectClashesWithDates(s, e2, groupReqs);
  const hasClash = clashDetails.length > 0;

  // Show clash confirm if there are clashes
  if (hasClash) {
    const clashNames = clashDetails.map(c => `${c.name} (${fmtDate(c.startDate)} – ${fmtDate(c.endDate)})`).join(", ");
    const proceed = await showClashConfirm(clashNames);
    if (!proceed) return;
  }

  try {
    await addDoc(collection(db,"leaveRequests"), {
      employeeId: ME.uid, employeeName: EMP.name, employeeDept: EMP.dept, employeeEmail: EMP.email,
      groupId: EMP.groupId||null, leaveType, customReason: customReason||null,
      requestPattern: EMP.dept==="DO"?pattern:null, requestRosterStart: EMP.dept==="DO"?rosterStart:null,
      startDate: s, endDate: e2, days, notes, status: "Pending",
      hasClash: hasClash, clashingWith: clashDetails.map(c => c.name),
      submittedAt: serverTimestamp(), editedAt: null, cycleId: EMP.cycleId||null
    });
    // Notify managers of new request
    notifyManagers(
      `New Leave Request — ${EMP.name}`,
      `${EMP.name} submitted a ${leaveType} leave request.\nFrom: ${fmtDate(s)} To: ${fmtDate(e2)}\nDays: ${days}${customReason?"\nReason: "+customReason:""}\nNotes: ${notes||"None"}`
    );
    toast("Leave request submitted!");
    document.getElementById("leaveForm").reset();
    calStartDate = null; calEndDate = null; calSelectingEnd = false;
    document.getElementById("customReasonGroup").style.display="none";
    ["daysPreview","clashWarning","balanceWarning","limitWarning"].forEach(id => document.getElementById(id).style.display="none");
    document.getElementById("startHint").textContent=""; document.getElementById("endHint").textContent="";

    // Restore pattern fields
    if (EMP.dept==="DO") {
      document.getElementById("fPattern").value     = pattern;
      document.getElementById("fRosterStart").value = rosterStart;
    }
    renderDualCalendar();
    switchSection("history");
  } catch(err) { errEl.textContent="Failed to submit. Please try again."; console.error(err); }
});

// ── Edit ──────────────────────────────────────────────────────────
window.openEditModal = (id) => {
  const r = myRequests.find(x => x.id===id);
  if (!r) return;
  document.getElementById("editRequestId").value  = id;
  document.getElementById("editStart").value      = r.startDate;
  document.getElementById("editEnd").value        = r.endDate;
  document.getElementById("editNotes").value      = r.notes||"";
  document.getElementById("editLeaveType").value  = r.leaveType||"Annual";
  document.getElementById("editCustomReason").value = r.customReason||"";
  document.getElementById("editCustomGroup").style.display = r.leaveType==="Custom"?"block":"none";
  document.getElementById("editError").textContent = "";
  document.getElementById("editModal").style.display = "flex";
};
document.getElementById("editModalClose").addEventListener("click",  () => document.getElementById("editModal").style.display="none");
document.getElementById("editModalCancel").addEventListener("click", () => document.getElementById("editModal").style.display="none");
document.getElementById("editForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id=document.getElementById("editRequestId").value, s=document.getElementById("editStart").value,
        e2=document.getElementById("editEnd").value, notes=document.getElementById("editNotes").value.trim(),
        leaveType=document.getElementById("editLeaveType").value, customReason=document.getElementById("editCustomReason").value.trim(),
        errEl=document.getElementById("editError");
  errEl.textContent="";
  if (leaveType==="Custom"&&!customReason){errEl.textContent="Enter a reason.";return;}
  if (e2<s){errEl.textContent="End must be after start.";return;}
  const orig=myRequests.find(x=>x.id===id);
  const days=countWorkDays(s,e2,EMP.dept,orig?.requestPattern||EMP.pattern,orig?.requestRosterStart||EMP.rosterStart);
  if (days===0){errEl.textContent="No working days in range.";return;}
  try {
    await updateDoc(doc(db,"leaveRequests",id),{startDate:s,endDate:e2,days,notes,leaveType,customReason:customReason||null,status:"Pending",editedAt:serverTimestamp()});
    notifyManagers(`Leave Request Edited — ${EMP.name}`, `${EMP.name} edited their leave request.\nNew dates: ${fmtDate(s)} – ${fmtDate(e2)}\nDays: ${days}\nType: ${leaveType}`);
    toast("Request updated. Manager notified.");
    document.getElementById("editModal").style.display="none";
  } catch(err){errEl.textContent="Failed to update.";console.error(err);}
});

// ── Cancel ────────────────────────────────────────────────────────
window.cancelRequest = async (id) => {
  if (!confirm("Cancel this leave request?")) return;
  try { await updateDoc(doc(db,"leaveRequests",id),{status:"Cancelled"}); toast("Request cancelled."); }
  catch { toast("Failed to cancel.","error"); }
};

// ── Request Edit ─────────────────────────────────────────────────
window.requestEdit = async (id) => {
  if (!confirm("Request manager approval to edit this leave?")) return;
  try {
    await updateDoc(doc(db, "leaveRequests", id), {
      editRequested: true,
      editRequestedAt: serverTimestamp()
    });
    notifyManagers(
      `Edit Request — ${EMP.name}`,
      `${EMP.name} has requested to edit their approved leave request.
Please review and allow or deny the edit in the Approvals tab.`
    );
    toast("Edit request sent to manager.");
  } catch { toast("Failed to send request.", "error"); }
};

// ── Change Password ───────────────────────────────────────────────
document.getElementById("changePwBtn").addEventListener("click", () => {
  document.getElementById("changePwForm").reset();
  document.getElementById("changePwError").textContent="";
  document.getElementById("changePwSuccess").textContent="";
  document.getElementById("changePwModal").style.display="flex";
});
document.getElementById("changePwClose").addEventListener("click",  () => document.getElementById("changePwModal").style.display="none");
document.getElementById("changePwCancel").addEventListener("click", () => document.getElementById("changePwModal").style.display="none");
document.getElementById("changePwForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const currentPw=document.getElementById("currentPw").value, newPw=document.getElementById("newPw").value,
        confirmPw=document.getElementById("confirmPw").value, errEl=document.getElementById("changePwError"),
        succEl=document.getElementById("changePwSuccess");
  errEl.textContent=""; succEl.textContent="";
  if (newPw.length<6){errEl.textContent="New password must be at least 6 characters.";return;}
  if (newPw!==confirmPw){errEl.textContent="Passwords do not match.";return;}
  try {
    const credential=EmailAuthProvider.credential(auth.currentUser.email,currentPw);
    await reauthenticateWithCredential(auth.currentUser,credential);
    await updatePassword(auth.currentUser,newPw);
    succEl.textContent="Password updated successfully!";
    document.getElementById("changePwForm").reset();
  } catch(err){errEl.textContent=err.code==="auth/wrong-password"?"Current password is incorrect.":"Failed to update password.";}
});

// ── Clash helpers ────────────────────────────────────────────────
function detectClashesWithDates(newStart, newEnd, requests) {
  const clashes = [];
  const seen = new Set();
  for (const r of requests) {
    if (r.status === "Rejected" || r.status === "Cancelled") continue;
    if (r.endDate < newStart || r.startDate > newEnd) continue;
    if (seen.has(r.employeeId)) continue;
    seen.add(r.employeeId);
    clashes.push({ name: r.employeeName, startDate: r.startDate, endDate: r.endDate });
  }
  return clashes;
}

function showClashConfirm(clashNames) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-bg";
    overlay.style.display = "flex";
    overlay.innerHTML = `
      <div class="modal-box modal-sm">
        <div class="modal-hd"><span>⚠️ Leave Clash Detected</span></div>
        <div class="modal-bd">
          <div style="background:var(--orange-light);color:var(--orange);padding:12px 14px;border-radius:6px;margin-bottom:14px;font-size:13px;">
            The following teammate(s) from your group are on leave during the same period:<br/><br/>
            <strong>${clashNames}</strong>
          </div>
          <p style="font-size:14px;color:var(--gray-700);margin:0 0 16px;">Do you still want to submit this request?</p>
          <div class="modal-actions">
            <button type="button" class="btn btn-outline" id="clashCancelBtn">Cancel</button>
            <button type="button" class="btn btn-primary" id="clashContinueBtn">Yes, Submit Anyway</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById("clashContinueBtn").addEventListener("click", () => { overlay.remove(); resolve(true); });
    document.getElementById("clashCancelBtn").addEventListener("click",   () => { overlay.remove(); resolve(false); });
  });
}

// ── Team ──────────────────────────────────────────────────────────
async function loadTeam() {
  const el=document.getElementById("teamList"), gl=document.getElementById("teamGroupLabel");
  if (!EMP.groupId){el.innerHTML=`<div class="list-empty">You are not assigned to a group yet.</div>`;return;}
  try {
    const gSnap=await getDoc(doc(db,"groups",EMP.groupId));
    if (gSnap.exists()) gl.textContent=gSnap.data().name||"My Team";
    const q=query(collection(db,"employees"),where("groupId","==",EMP.groupId));
    const snap=await getDocs(q);
    const members=snap.docs.map(d=>({id:d.id,...d.data()})).filter(m=>m.id!==ME.uid);
    if (!members.length){el.innerHTML=`<div class="list-empty">No other members in your group.</div>`;return;}
    const today2=todayStr();
    el.innerHTML=members.map(m=>{
      // Get this member's requests
      const memberReqs = allRequests
        .filter(r => r.employeeId===m.id && r.endDate>=today2 && (r.status==="Approved"||r.status==="Pending"))
        .sort((a,b)=>a.startDate.localeCompare(b.startDate));

      const onLeave = memberReqs.some(r=>r.status==="Approved"&&r.startDate<=today2&&r.endDate>=today2);

      // Build leave summary
      const leaveSummary = memberReqs.map(r => {
        const icon = r.status==="Approved" ? "✅" : "⏳";
        const label = r.status==="Approved" ? "Approved" : "Pending";
        return `<div class="team-leave-item">
          <span class="team-leave-icon">${icon}</span>
          <span class="team-leave-dates">${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}</span>
          <span class="team-leave-days">${r.days} day(s)</span>
          <span class="team-leave-type">${r.leaveType}</span>
          <span class="status-badge ${r.status==="Approved"?"sb-approved":"sb-pending"}" style="font-size:10px;padding:2px 6px">${label}</span>
        </div>`;
      }).join("") || `<div class="team-leave-none">No upcoming leave</div>`;

      return `<div class="team-member-card">
        <div class="team-member-top">
          <div style="display:flex;align-items:center;gap:10px">
            <div class="group-avatar">${initials(m.name)}</div>
            <div>
              <div style="font-weight:600;font-size:14px">${m.name}</div>
              <div style="font-size:11px;color:var(--gray-400)">${m.dept} · ${m.dept==="DO"?(m.pattern||"--"):"Mon–Thu"}</div>
            </div>
          </div>
          ${onLeave
            ?`<span class="status-badge sb-approved">● On Leave</span>`
            :`<span class="status-badge sb-cancelled">Available</span>`}
        </div>
        <div class="team-leave-list">${leaveSummary}</div>
      </div>`;
    }).join("");
  } catch(err){el.innerHTML=`<div class="list-empty">Could not load team.</div>`;console.error(err);}
}

// ── Renewal check ─────────────────────────────────────────────────
function checkRenewal() {
  if (!EMP?.cycleEnd) return;
  const diff=Math.ceil((new Date(EMP.cycleEnd+"T00:00:00")-new Date())/86400000);
  if (diff<=30&&diff>=0) toast(`Your leave cycle expires in ${diff} day(s). Contact your manager to renew.`,"warning");
}

// ── Previous cycles ───────────────────────────────────────────────
document.getElementById("togglePrevCycles").addEventListener("click", async () => {
  const body=document.getElementById("prevCyclesBody"), btn=document.getElementById("togglePrevCycles");
  if (body.style.display==="none"){body.style.display="block";btn.textContent="Hide";await loadPrevCycles();}
  else{body.style.display="none";btn.textContent="Show";}
});
async function loadPrevCycles() {
  const el=document.getElementById("prevCyclesList");
  try {
    const q=query(collection(db,"cycleHistory"),where("employeeId","==",ME.uid),orderBy("archivedAt","desc"));
    const snap=await getDocs(q);
    if (snap.empty){el.innerHTML=`<div class="list-empty">No previous cycles.</div>`;return;}
    el.innerHTML=snap.docs.map(d=>{const c=d.data();return`<div class="list-item"><div><div style="font-weight:600">${fmtDate(c.cycleStart)} – ${fmtDate(c.cycleEnd)}</div><div style="font-size:11px;color:var(--gray-400)">Entitlement: ${c.entitlement} days · Used: ${c.leaveUsed} days</div></div></div>`;}).join("");
  } catch{el.innerHTML=`<div class="list-empty">Could not load history.</div>`;}
}
