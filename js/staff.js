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
  if (!eSnap.exists()) { toast("Employee record not found. Contact your manager.", "error"); return; }
  EMP = { id: eSnap.id, ...eSnap.data() };
  if (EMP.dept === "DO") {
    document.getElementById("doPatternFields").style.display = "block";
    if (EMP.pattern)     document.getElementById("fPattern").value     = EMP.pattern;
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
  await signOut(auth); location.href = "../index.html";
});

// ── Navigation ────────────────────────────────────────────────────
function switchSection(name) {
  document.querySelectorAll(".bnav-item").forEach(b => b.classList.toggle("active", b.dataset.section === name));
  document.querySelectorAll(".nav-tab[data-section]").forEach(t => t.classList.toggle("active", t.dataset.section === name));
  document.querySelectorAll(".page-section").forEach(s => s.classList.remove("active"));
  document.getElementById("section-" + name).classList.add("active");
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
    renderHistory(); renderUpcoming(); renderCalendar();
  });
}
function listenAllRequests() {
  onSnapshot(collection(db,"leaveRequests"), snap => {
    allRequests = snap.docs.map(d => ({ id:d.id, ...d.data() }));
  });
}

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
        </div>
      </div>
    </div>`).join("");
}
document.getElementById("historyFilter").addEventListener("change", renderHistory);
document.getElementById("historyTypeFilter").addEventListener("change", renderHistory);

// ── Leave type / pattern handlers ─────────────────────────────────
document.getElementById("fLeaveType").addEventListener("change", () => {
  document.getElementById("customReasonGroup").style.display =
    document.getElementById("fLeaveType").value === "Custom" ? "block" : "none";
  validateDates();
});
document.getElementById("editLeaveType").addEventListener("change", () => {
  document.getElementById("editCustomGroup").style.display =
    document.getElementById("editLeaveType").value === "Custom" ? "block" : "none";
});
document.getElementById("fPattern")?.addEventListener("input", () => {
  const val = document.getElementById("fPattern").value.toUpperCase();
  const ok = /^\d+W\d+O$/.test(val);
  document.getElementById("patternHint").textContent = val ? (ok?"✓ Valid pattern":"✗ Use format like 6W4O"): "";
  document.getElementById("patternHint").style.color = ok ? "var(--green)" : "var(--red)";
  validateDates();
  const startDate = document.getElementById("fStartDate").value;
  if (ok) renderCalendarWithPattern(val, getRequestRosterStart(), startDate||null);
});
document.getElementById("fRosterStart")?.addEventListener("change", () => {
  validateDates();
  const pat = getRequestPattern();
  const startDate = document.getElementById("fStartDate").value;
  if (pat && /^\d+W\d+O$/.test(pat)) renderCalendarWithPattern(pat, getRequestRosterStart(), startDate||null);
});

// ── Date validation ───────────────────────────────────────────────
function getRequestPattern() {
  if (EMP?.dept !== "DO") return null;
  return (document.getElementById("fPattern")?.value.toUpperCase().trim()) || EMP?.pattern;
}
function getRequestRosterStart() {
  if (EMP?.dept !== "DO") return null;
  return document.getElementById("fRosterStart")?.value || EMP?.rosterStart;
}

function validateDates() {
  const s = document.getElementById("fStartDate").value;
  const e = document.getElementById("fEndDate").value;
  if (!s || !e || !EMP) return;
  const pattern = getRequestPattern(), rosterStart = getRequestRosterStart();
  const startOk = EMP.dept==="GD" ? isGDWorkDay(s) : isDOWorkDay(s, pattern, rosterStart);
  const endOk   = EMP.dept==="GD" ? isGDWorkDay(e) : isDOWorkDay(e, pattern, rosterStart);
  document.getElementById("startHint").textContent = startOk ? "✓ Valid working day" : "✗ Not a working day";
  document.getElementById("startHint").style.color = startOk ? "var(--green)" : "var(--red)";
  document.getElementById("endHint").textContent   = endOk   ? "✓ Valid working day" : "✗ Not a working day";
  document.getElementById("endHint").style.color   = endOk   ? "var(--green)" : "var(--red)";
  if (!startOk || !endOk || e < s) { document.getElementById("daysPreview").style.display="none"; return; }
  const days = countWorkDays(s, e, EMP.dept, pattern, rosterStart);
  document.getElementById("daysPreview").style.display = "block";
  document.getElementById("daysCount").textContent = days;
  const leaveType = document.getElementById("fLeaveType").value;
  const rem = (EMP.entitlement||0) - (EMP.leaveUsed||0);
  const bw = document.getElementById("balanceWarning");
  if (leaveType==="Annual" && days>rem) { bw.style.display="block"; bw.textContent=`⚠️ Only ${rem} annual days remaining.`; } else bw.style.display="none";
  const cfg = LEAVE_TYPES[leaveType];
  const lw = document.getElementById("limitWarning");
  if (cfg?.maxDays) {
    const avail = cfg.maxDays - (EMP[balanceField(leaveType)]||0);
    if (days>avail) { lw.style.display="block"; lw.textContent=`⚠️ ${leaveType} allowance: ${avail} day(s) remaining of ${cfg.maxDays}.`; } else lw.style.display="none";
  } else lw.style.display="none";
  const clashing = detectClashes(s, e, allRequests.filter(r => r.employeeId!==ME.uid));
  const cw = document.getElementById("clashWarning");
  if (clashing.length>=2) { cw.style.display="block"; document.getElementById("clashMsg").textContent=`${clashing.length} other staff on leave: ${clashing.join(", ")}`; } else cw.style.display="none";

  // Update calendar to show the month of selected start date
  const pat = getRequestPattern(), rs = getRequestRosterStart();
  if (pat && /^\d+W\d+O$/.test(pat)) {
    renderCalendarWithPattern(pat, rs, s);
  } else if (EMP.dept === "GD") {
    renderCalendar(s);
  }
}
document.getElementById("fStartDate").addEventListener("change", validateDates);
document.getElementById("fEndDate").addEventListener("change",   validateDates);
document.getElementById("fLeaveType").addEventListener("change", validateDates);

// ── Submit ────────────────────────────────────────────────────────
document.getElementById("leaveForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("formError");
  errEl.textContent = "";
  const leaveType    = document.getElementById("fLeaveType").value;
  const customReason = document.getElementById("fCustomReason").value.trim();
  const s            = document.getElementById("fStartDate").value;
  const e2           = document.getElementById("fEndDate").value;
  const notes        = document.getElementById("fNotes").value.trim();
  const pattern      = getRequestPattern();
  const rosterStart  = getRequestRosterStart();

  if (!s || !e2) { errEl.textContent="Select start and end dates."; return; }
  if (e2 < s)    { errEl.textContent="End date must be after start date."; return; }
  if (leaveType==="Custom" && !customReason) { errEl.textContent="Enter a reason for custom leave."; return; }
  if (EMP.dept==="DO") {
    if (!pattern?.match(/^\d+W\d+O$/i)) { errEl.textContent="Enter a valid shift pattern (e.g. 6W4O)."; return; }
    if (!rosterStart) { errEl.textContent="Enter your roster cycle start date."; return; }
  }
  const startOk = EMP.dept==="GD" ? isGDWorkDay(s) : isDOWorkDay(s, pattern, rosterStart);
  const endOk   = EMP.dept==="GD" ? isGDWorkDay(e2): isDOWorkDay(e2, pattern, rosterStart);
  if (!startOk) { errEl.textContent="Start date is not a valid working day."; return; }
  if (!endOk)   { errEl.textContent="End date is not a valid working day."; return; }
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
  const clashing = detectClashes(s, e2, allRequests.filter(r => r.employeeId!==ME.uid));
  try {
    await addDoc(collection(db,"leaveRequests"), {
      employeeId: ME.uid, employeeName: EMP.name, employeeDept: EMP.dept, employeeEmail: EMP.email,
      groupId: EMP.groupId||null, leaveType, customReason: customReason||null,
      requestPattern: EMP.dept==="DO"?pattern:null, requestRosterStart: EMP.dept==="DO"?rosterStart:null,
      startDate: s, endDate: e2, days, notes, status: "Pending",
      hasClash: clashing.length>=2, clashingWith: clashing,
      submittedAt: serverTimestamp(), editedAt: null, cycleId: EMP.cycleId||null
    });
    await addDoc(collection(db,"emailQueue"), {
      type:"new_request", to:"managers", subject:`New Leave Request — ${EMP.name}`,
      body:`${EMP.name} submitted a ${leaveType} leave request.\nFrom: ${fmtDate(s)} To: ${fmtDate(e2)}\nDays: ${days}${customReason?"\nReason: "+customReason:""}\nNotes: ${notes||"None"}`,
      sentAt: serverTimestamp()
    });
    toast("Leave request submitted!");
    document.getElementById("leaveForm").reset();
    ["daysPreview","clashWarning","balanceWarning","limitWarning"].forEach(id => document.getElementById(id).style.display="none");
    document.getElementById("startHint").textContent=""; document.getElementById("endHint").textContent="";
    document.getElementById("customReasonGroup").style.display="none";
    if (EMP.dept==="DO" && EMP.pattern) {
      document.getElementById("fPattern").value = EMP.pattern;
      document.getElementById("fRosterStart").value = EMP.rosterStart||"";
    }
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
    await addDoc(collection(db,"emailQueue"),{type:"edited_request",to:"managers",subject:`Leave Request Edited — ${EMP.name}`,body:`${EMP.name} edited their leave request.\nNew dates: ${fmtDate(s)} – ${fmtDate(e2)}\nDays: ${days}\nType: ${leaveType}`,sentAt:serverTimestamp()});
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
  const currentPw = document.getElementById("currentPw").value;
  const newPw     = document.getElementById("newPw").value;
  const confirmPw = document.getElementById("confirmPw").value;
  const errEl     = document.getElementById("changePwError");
  const succEl    = document.getElementById("changePwSuccess");
  errEl.textContent=""; succEl.textContent="";
  if (newPw.length < 6) { errEl.textContent="New password must be at least 6 characters."; return; }
  if (newPw !== confirmPw) { errEl.textContent="Passwords do not match."; return; }
  try {
    const credential = EmailAuthProvider.credential(auth.currentUser.email, currentPw);
    await reauthenticateWithCredential(auth.currentUser, credential);
    await updatePassword(auth.currentUser, newPw);
    succEl.textContent="Password updated successfully!";
    document.getElementById("changePwForm").reset();
  } catch(err) {
    errEl.textContent = err.code==="auth/wrong-password" ? "Current password is incorrect." : "Failed to update password. Try again.";
  }
});

// ── Calendar ──────────────────────────────────────────────────────
function renderCalendar(targetDateStr) {
  if (!EMP) return;
  const el=document.getElementById("miniCalendar");
  const refDate = targetDateStr ? new Date(targetDateStr+"T00:00:00") : new Date();
  const today=new Date();
  const year=refDate.getFullYear(), month=refDate.getMonth();
  const firstDay=new Date(year,month,1).getDay(), daysInMonth=new Date(year,month+1,0).getDate();
  const lblEl=document.getElementById("calMonthLabel");
  if (lblEl) lblEl.textContent=refDate.toLocaleDateString("en-GB",{month:"long",year:"numeric"});
  const takenDates=new Set(), pendingDates=new Set();
  myRequests.forEach(r => {
    if (r.status==="Rejected"||r.status==="Cancelled") return;
    const cur=new Date(r.startDate+"T00:00:00"), end=new Date(r.endDate+"T00:00:00");
    while (cur<=end) {
      const s=cur.toISOString().split("T")[0];
      if (r.status==="Approved") takenDates.add(s); else pendingDates.add(s);
      cur.setDate(cur.getDate()+1);
    }
  });
  const labels=["Su","Mo","Tu","We","Th","Fr","Sa"];
  let html=labels.map(l=>`<div class="cal-day-label">${l}</div>`).join("");
  for (let i=0;i<firstDay;i++) html+=`<div class="cal-day cal-empty"></div>`;
  for (let d=1;d<=daysInMonth;d++) {
    const dateStr=`${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const isToday=d===today.getDate() && month===today.getMonth() && year===today.getFullYear();
    const isWork=EMP.dept==="GD" ? isGDWorkDay(dateStr) : isDOWorkDay(dateStr, EMP.pattern||"", EMP.rosterStart||"");
    const isTaken=takenDates.has(dateStr), isPending=pendingDates.has(dateStr);
    let cls="cal-day ";
    if (isTaken) cls+="cal-taken"; else if (isPending) cls+="cal-pending"; else if (isWork) cls+="cal-work"; else cls+="cal-off";
    if (isToday) cls+=" cal-today";
    html+=`<div class="${cls}" title="${dateStr}">${d}</div>`;
  }
  el.innerHTML=html;
}

function renderCalendarWithPattern(pattern, rosterStart, targetDate) {
  if (!EMP) return;
  const orig={pattern:EMP.pattern, rosterStart:EMP.rosterStart};
  EMP.pattern=pattern; EMP.rosterStart=rosterStart;
  renderCalendar(targetDate);
  EMP.pattern=orig.pattern; EMP.rosterStart=orig.rosterStart;
}

// ── Team ──────────────────────────────────────────────────────────
async function loadTeam() {
  const el=document.getElementById("teamList"), gl=document.getElementById("teamGroupLabel");
  if (!EMP.groupId) { el.innerHTML=`<div class="list-empty">You are not assigned to a group yet.</div>`; return; }
  try {
    const gSnap=await getDoc(doc(db,"groups",EMP.groupId));
    if (gSnap.exists()) gl.textContent=gSnap.data().name||"My Team";
    const q=query(collection(db,"employees"),where("groupId","==",EMP.groupId));
    const snap=await getDocs(q);
    const members=snap.docs.map(d=>({id:d.id,...d.data()})).filter(m=>m.id!==ME.uid);
    if (!members.length) { el.innerHTML=`<div class="list-empty">No other members in your group.</div>`; return; }
    const today=todayStr();
    el.innerHTML=members.map(m => {
      const onLeave=allRequests.some(r=>r.employeeId===m.id&&r.status==="Approved"&&r.startDate<=today&&r.endDate>=today);
      return `<div class="list-item">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="group-avatar">${initials(m.name)}</div>
          <div><div style="font-weight:600">${m.name}</div><div style="font-size:11px;color:var(--gray-400)">${m.dept} · ${m.dept==="DO"?(m.pattern||""):"Mon–Thu"}</div></div>
        </div>
        ${onLeave?`<span class="status-badge sb-approved">On Leave</span>`:`<span style="color:var(--gray-300);font-size:12px">Available</span>`}
      </div>`;
    }).join("");
  } catch(err) { el.innerHTML=`<div class="list-empty">Could not load team.</div>`; }
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
  if (body.style.display==="none") { body.style.display="block"; btn.textContent="Hide"; await loadPrevCycles(); }
  else { body.style.display="none"; btn.textContent="Show"; }
});
async function loadPrevCycles() {
  const el=document.getElementById("prevCyclesList");
  try {
    const q=query(collection(db,"cycleHistory"),where("employeeId","==",ME.uid),orderBy("archivedAt","desc"));
    const snap=await getDocs(q);
    if (snap.empty) { el.innerHTML=`<div class="list-empty">No previous cycles.</div>`; return; }
    el.innerHTML=snap.docs.map(d=>{const c=d.data();return`<div class="list-item"><div><div style="font-weight:600">${fmtDate(c.cycleStart)} – ${fmtDate(c.cycleEnd)}</div><div style="font-size:11px;color:var(--gray-400)">Entitlement: ${c.entitlement} days · Used: ${c.leaveUsed} days</div></div></div>`;}).join("");
  } catch { el.innerHTML=`<div class="list-empty">Could not load history.</div>`; }
}
