// js/staff.js — Staff portal
import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, collection, query, where, onSnapshot,
         addDoc, updateDoc, serverTimestamp, getDocs, orderBy }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { fmtDate, todayStr, addDays, cycleEnd,
         isGDWorkDay, isDOWorkDay, countWorkDays,
         detectClashes, statusBadge, toast, initials }
  from "./utils.js";

let ME = null;       // current user auth
let EMP = null;      // employee Firestore doc
let myRequests = []; // live list of own requests
let allRequests = []; // for clash check

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
    toast("Your employee record was not found. Contact your manager.", "error");
    return;
  }
  EMP = { id: eSnap.id, ...eSnap.data() };

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

// ── Bottom nav ───────────────────────────────────────────────────
document.querySelectorAll(".bnav-item").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".bnav-item").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".page-section").forEach(s => s.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("section-" + btn.dataset.section).classList.add("active");
  });
});

// ── Balance display ──────────────────────────────────────────────
function renderBalance() {
  const used      = EMP.leaveUsed    || 0;
  const ent       = EMP.entitlement  || 0;
  const unpaid    = EMP.unpaidUsed   || 0;
  const remaining = Math.max(0, ent - used);
  const pct       = ent > 0 ? Math.min(100, Math.round(used / ent * 100)) : 0;

  document.getElementById("bcEntitlement").textContent = ent;
  document.getElementById("bcUsed").textContent        = used;
  document.getElementById("bcRemaining").textContent   = remaining;
  document.getElementById("bcUnpaid").textContent      = unpaid;
  document.getElementById("progressPct").textContent   = pct + "%";
  document.getElementById("progressLabel").textContent = `${used} of ${ent} days used`;

  const fill = document.getElementById("progressFill");
  fill.style.width = pct + "%";
  fill.className   = "progress-fill" + (pct >= 90 ? " danger" : pct >= 70 ? " warn" : "");

  const cs = EMP.cycleStart, ce = EMP.cycleEnd || cycleEnd(cs || todayStr());
  document.getElementById("cycleInfo").textContent =
    `Cycle: ${fmtDate(cs)} – ${fmtDate(ce)} | ${EMP.dept} Staff`;
}

// ── Listen to my requests ────────────────────────────────────────
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
  });
}

function listenAllRequests() {
  onSnapshot(collection(db, "leaveRequests"), snap => {
    allRequests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  });
}

// ── Upcoming leave ───────────────────────────────────────────────
function renderUpcoming() {
  const today = todayStr();
  const upcoming = myRequests
    .filter(r => r.status === "Approved" && r.endDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(0, 5);

  const el = document.getElementById("upcomingLeave");
  if (!upcoming.length) {
    el.innerHTML = `<div class="list-empty">No upcoming approved leave.</div>`;
    return;
  }
  el.innerHTML = upcoming.map(r => `
    <div class="list-item">
      <div>
        <div style="font-weight:600">${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}</div>
        <div style="font-size:11px;color:var(--gray-400)">${r.days} working day(s) · ${r.leaveType}</div>
      </div>
      ${statusBadge(r.status)}
    </div>`).join("");
}

// ── History list ─────────────────────────────────────────────────
function renderHistory() {
  const filter = document.getElementById("historyFilter").value;
  let list = [...myRequests];
  if (filter !== "all") list = list.filter(r => r.status === filter);

  const el = document.getElementById("historyList");
  if (!list.length) {
    el.innerHTML = `<div class="list-empty">No requests found.</div>`;
    return;
  }

  el.innerHTML = list.map(r => `
    <div class="request-item">
      <div class="req-top">
        <span class="req-dates">${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}</span>
        ${statusBadge(r.status)}
      </div>
      <div class="req-meta">
        <span class="req-days">${r.days} working day(s)</span>
        <span class="dept-badge db-${EMP.dept}">${r.leaveType}</span>
        ${r.hasClash ? `<span class="clash-flag">⚠️ Clash</span>` : ""}
      </div>
      <div class="req-bottom">
        <span class="req-notes">${r.notes || ""}</span>
        <div class="req-actions">
          ${r.status === "Pending" ? `
            <button class="btn btn-outline btn-xs" onclick="openEditModal('${r.id}')">Edit</button>
            <button class="btn btn-xs" style="background:var(--red-light);color:var(--red)"
              onclick="cancelRequest('${r.id}')">Cancel</button>` : ""}
        </div>
      </div>
    </div>`).join("");
}

document.getElementById("historyFilter").addEventListener("change", renderHistory);

// ── Leave request form ───────────────────────────────────────────
const fStart = document.getElementById("fStartDate");
const fEnd   = document.getElementById("fEndDate");

function validateDates() {
  if (!fStart.value || !fEnd.value || !EMP) return;
  const s = fStart.value, e = fEnd.value;

  // Validate start
  const startOk = EMP.dept === "GD"
    ? isGDWorkDay(s)
    : isDOWorkDay(s, EMP.pattern, EMP.rosterStart);
  document.getElementById("startHint").textContent = startOk
    ? "✓ Valid working day" : "✗ Not a working day for your schedule";
  document.getElementById("startHint").style.color = startOk ? "var(--green)" : "var(--red)";

  // Validate end
  const endOk = EMP.dept === "GD"
    ? isGDWorkDay(e)
    : isDOWorkDay(e, EMP.pattern, EMP.rosterStart);
  document.getElementById("endHint").textContent = endOk
    ? "✓ Valid working day" : "✗ Not a working day for your schedule";
  document.getElementById("endHint").style.color = endOk ? "var(--green)" : "var(--red)";

  if (!startOk || !endOk || e < s) {
    document.getElementById("daysPreview").style.display = "none";
    return;
  }

  const days = countWorkDays(s, e, EMP.dept, EMP.pattern, EMP.rosterStart);
  const prev = document.getElementById("daysPreview");
  prev.style.display = "block";
  document.getElementById("daysCount").textContent = days;

  // Balance warning
  const leaveType = document.getElementById("fLeaveType").value;
  const bw = document.getElementById("balanceWarning");
  const rem = (EMP.entitlement || 0) - (EMP.leaveUsed || 0);
  if (leaveType === "Annual" && days > rem) {
    bw.style.display = "block";
    bw.textContent = `⚠️ You only have ${rem} days remaining but selected ${days} days.`;
  } else {
    bw.style.display = "none";
  }

  // Clash check
  const clashing = detectClashes(s, e, allRequests.filter(r => r.employeeId !== ME.uid));
  const cw = document.getElementById("clashWarning");
  if (clashing.length >= 2) {
    cw.style.display = "block";
    document.getElementById("clashMsg").textContent =
      `${clashing.length} other staff on leave same time: ${clashing.join(", ")}`;
  } else {
    cw.style.display = "none";
  }
}

fStart.addEventListener("change", validateDates);
fEnd.addEventListener("change", validateDates);
document.getElementById("fLeaveType").addEventListener("change", validateDates);

document.getElementById("leaveForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("formError");
  errEl.textContent = "";

  const leaveType = document.getElementById("fLeaveType").value;
  const s = fStart.value, e2 = fEnd.value;
  const notes = document.getElementById("fNotes").value.trim();

  if (!s || !e2) { errEl.textContent = "Select start and end dates."; return; }
  if (e2 < s)    { errEl.textContent = "End date must be after start date."; return; }

  const startOk = EMP.dept === "GD" ? isGDWorkDay(s) : isDOWorkDay(s, EMP.pattern, EMP.rosterStart);
  const endOk   = EMP.dept === "GD" ? isGDWorkDay(e2): isDOWorkDay(e2, EMP.pattern, EMP.rosterStart);
  if (!startOk) { errEl.textContent = "Start date is not a valid working day."; return; }
  if (!endOk)   { errEl.textContent = "End date is not a valid working day."; return; }

  const days = countWorkDays(s, e2, EMP.dept, EMP.pattern, EMP.rosterStart);
  if (days === 0) { errEl.textContent = "No working days in selected range."; return; }

  const rem = (EMP.entitlement || 0) - (EMP.leaveUsed || 0);
  if (leaveType === "Annual" && days > rem) {
    errEl.textContent = `Insufficient balance. ${rem} days remaining, ${days} requested.`; return;
  }

  const clashing = detectClashes(s, e2, allRequests.filter(r => r.employeeId !== ME.uid));
  const hasClash = clashing.length >= 2;

  try {
    await addDoc(collection(db, "leaveRequests"), {
      employeeId:   ME.uid,
      employeeName: EMP.name,
      employeeDept: EMP.dept,
      employeeEmail:EMP.email,
      groupId:      EMP.groupId || null,
      leaveType, startDate: s, endDate: e2, days, notes,
      status:      "Pending",
      hasClash,
      clashingWith: clashing,
      submittedAt:  serverTimestamp(),
      editedAt:     null,
      cycleId:      EMP.cycleId || null
    });

    // Queue notification email to managers
    await addDoc(collection(db, "emailQueue"), {
      type:    "new_request",
      to:      "managers",
      subject: `New Leave Request — ${EMP.name}`,
      body:    `${EMP.name} submitted a leave request:\nType: ${leaveType}\nFrom: ${fmtDate(s)} To: ${fmtDate(e2)}\nDays: ${days}\nNotes: ${notes || "None"}`,
      sentAt:  serverTimestamp()
    });

    toast("Leave request submitted successfully!");
    document.getElementById("leaveForm").reset();
    document.getElementById("daysPreview").style.display = "none";
    document.getElementById("clashWarning").style.display = "none";
    document.getElementById("balanceWarning").style.display = "none";
    document.getElementById("startHint").textContent = "";
    document.getElementById("endHint").textContent = "";

    // Switch to history tab
    document.querySelectorAll(".bnav-item").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".page-section").forEach(s => s.classList.remove("active"));
    document.querySelector('[data-section="history"]').classList.add("active");
    document.getElementById("section-history").classList.add("active");

  } catch (err) {
    errEl.textContent = "Failed to submit. Please try again.";
    console.error(err);
  }
});

// ── Edit request ─────────────────────────────────────────────────
window.openEditModal = (id) => {
  const r = myRequests.find(x => x.id === id);
  if (!r) return;
  document.getElementById("editRequestId").value = id;
  document.getElementById("editStart").value = r.startDate;
  document.getElementById("editEnd").value   = r.endDate;
  document.getElementById("editNotes").value = r.notes || "";
  document.getElementById("editError").textContent = "";
  document.getElementById("editModal").style.display = "flex";
};

document.getElementById("editModalClose").addEventListener("click",  () => document.getElementById("editModal").style.display = "none");
document.getElementById("editModalCancel").addEventListener("click", () => document.getElementById("editModal").style.display = "none");

document.getElementById("editForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id    = document.getElementById("editRequestId").value;
  const s     = document.getElementById("editStart").value;
  const e2    = document.getElementById("editEnd").value;
  const notes = document.getElementById("editNotes").value.trim();
  const errEl = document.getElementById("editError");
  errEl.textContent = "";

  if (e2 < s) { errEl.textContent = "End must be after start."; return; }

  const days = countWorkDays(s, e2, EMP.dept, EMP.pattern, EMP.rosterStart);
  if (days === 0) { errEl.textContent = "No working days in range."; return; }

  try {
    await updateDoc(doc(db, "leaveRequests", id), {
      startDate: s, endDate: e2, days, notes,
      status: "Pending",
      editedAt: serverTimestamp()
    });

    // Notify managers of edit
    await addDoc(collection(db, "emailQueue"), {
      type:    "edited_request",
      to:      "managers",
      subject: `Leave Request Edited — ${EMP.name}`,
      body:    `${EMP.name} edited their leave request:\nNew dates: ${fmtDate(s)} – ${fmtDate(e2)}\nDays: ${days}`,
      sentAt:  serverTimestamp()
    });

    toast("Request updated. Manager notified.");
    document.getElementById("editModal").style.display = "none";
  } catch (err) {
    errEl.textContent = "Failed to update.";
    console.error(err);
  }
});

// ── Cancel request ───────────────────────────────────────────────
window.cancelRequest = async (id) => {
  if (!confirm("Cancel this leave request?")) return;
  try {
    await updateDoc(doc(db, "leaveRequests", id), { status: "Cancelled" });
    toast("Request cancelled.");
  } catch { toast("Failed to cancel.", "error"); }
};

// ── Mini calendar ────────────────────────────────────────────────
function renderCalendar() {
  if (!EMP) return;
  const el = document.getElementById("miniCalendar");
  const today = new Date();
  const year  = today.getFullYear();
  const month = today.getMonth();
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Approved/pending dates for this employee
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

  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) html += `<div class="cal-day cal-empty"></div>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const isToday = d === today.getDate();
    const isWork  = EMP.dept === "GD"
      ? isGDWorkDay(dateStr)
      : isDOWorkDay(dateStr, EMP.pattern, EMP.rosterStart);
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

// ── Team view ────────────────────────────────────────────────────
async function loadTeam() {
  const el = document.getElementById("teamList");
  const gl = document.getElementById("teamGroupLabel");

  if (!EMP.groupId) {
    el.innerHTML = `<div class="list-empty">You are not assigned to a group yet.</div>`;
    return;
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
        r.startDate <= today && r.endDate >= today
      );
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
  } catch (err) {
    console.error(err);
    el.innerHTML = `<div class="list-empty">Could not load team.</div>`;
  }
}

// ── Auto renewal check ───────────────────────────────────────────
function checkRenewal() {
  if (!EMP || !EMP.cycleEnd) return;
  const end  = new Date(EMP.cycleEnd + "T00:00:00");
  const diff = Math.ceil((end - new Date()) / 86400000);
  if (diff <= 30 && diff >= 0) {
    toast(`Your leave cycle expires in ${diff} day(s). Contact your manager to renew.`, "warning");
  }
}

// ── Previous cycles toggle ───────────────────────────────────────
document.getElementById("togglePrevCycles").addEventListener("click", async () => {
  const body = document.getElementById("prevCyclesBody");
  const btn  = document.getElementById("togglePrevCycles");
  if (body.style.display === "none") {
    body.style.display = "block";
    btn.textContent = "Hide";
    await loadPrevCycles();
  } else {
    body.style.display = "none";
    btn.textContent = "Show";
  }
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
  } catch (err) {
    el.innerHTML = `<div class="list-empty">Could not load history.</div>`;
    console.error(err);
  }
}
