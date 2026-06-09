// js/manager.js — Manager portal
import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut,
         createUserWithEmailAndPassword,
         EmailAuthProvider, reauthenticateWithCredential, updatePassword }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth as getSecondAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
         onSnapshot, addDoc, serverTimestamp, query, orderBy, where, writeBatch }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { fmtDate, fmtDateTime, todayStr, cycleEnd, isRenewalDue,
         statusBadge, deptBadge, roleBadge, pbar, toast, initials,
         isGDWorkDay, isDOWorkDay, countWorkDays,
         detectClashes, leaveTypeBadge, LEAVE_TYPES, balanceField }
  from "./utils.js";
import { sendEmail, notifyManagers } from "./email.js";

// Secondary app for creating users without logging out the manager
const secondaryApp = initializeApp({
  apiKey: "AIzaSyDRFzz7OPlRyjJekZh6rbMNz6teQJ6yd_M",
  authDomain: "annual-leave-system-83d7a.firebaseapp.com",
  projectId: "annual-leave-system-83d7a",
  storageBucket: "annual-leave-system-83d7a.firebasestorage.app",
  messagingSenderId: "1047300958404",
  appId: "1:1047300958404:web:61dc1bb5ab1d985f764191"
}, "secondary");
const secondaryAuth = getSecondAuth(secondaryApp);

let MGR = null;
let employees  = [];
let requests   = [];
let groups     = [];
let editingEmpId = null;
let auditItems = [];

// ── Auth guard ───────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { location.href = "../index.html"; return; }
  const uSnap = await getDoc(doc(db, "users", user.uid));
  if (!uSnap.exists() || uSnap.data().role !== "manager") {
    location.href = "staff.html"; return;
  }
  MGR = { uid: user.uid, ...uSnap.data() };
  document.getElementById("navName").textContent = MGR.name || user.email;
  init();
});

function init() {
  listenEmployees();
  listenRequests();
  listenGroups();
  listenAudit();
  // Small delay to ensure MGR is set before loading employee record
  setTimeout(initMyLeave, 500);
}

document.getElementById("logoutBtn").addEventListener("click", async () => {
  try {
    localStorage.clear(); // Clear all cached data
    await signOut(auth);
  } catch(e) { console.error(e); }
  location.href = "../index.html";
});

// ── Tab switching ────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll(".nav-tab,.mob-tab").forEach(t =>
    t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach(p =>
    p.classList.toggle("active", p.id === "tab-" + name));
  // Re-init My Leave if not loaded yet
  if (name === "myleave" && !MGR_EMP) initMyLeave();
  // Reset filters when returning to dashboard
  if (name === "dashboard") {
    document.getElementById("staffSearch").value = "";
    document.getElementById("deptFilter").value  = "all";
    document.getElementById("groupFilter").value = "all";
    renderStaffTable();
  }
  if (name === "schedule") renderSchedule();
}
document.querySelectorAll(".nav-tab,.mob-tab").forEach(t =>
  t.addEventListener("click", () => switchTab(t.dataset.tab)));

// ── Filters ──────────────────────────────────────────────────────
document.getElementById("deptFilter").addEventListener("change",     renderStaffTable);
document.getElementById("groupFilter").addEventListener("change",    renderStaffTable);
document.getElementById("staffSearch").addEventListener("input",     renderStaffTable);
document.getElementById("approvalFilter").addEventListener("change", renderApprovals);
document.getElementById("auditFilter").addEventListener("change",    () => renderAuditLog(auditItems));
document.getElementById("scheduleGroupFilter").addEventListener("change", renderSchedule);
document.getElementById("scheduleMonthFilter").addEventListener("change", renderSchedule);

// ── Live listeners ───────────────────────────────────────────────
function listenEmployees() {
  onSnapshot(collection(db, "employees"), snap => {
    employees = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderStaffTable();
    renderEmpTable();
    updateStats();
  });
}
function listenRequests() {
  onSnapshot(collection(db, "leaveRequests"), snap => {
    requests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderApprovals();
    renderSchedule();
    updateStats();
    const pending = requests.filter(r => r.status === "Pending").length;
    ["approvalsBadge","mobBadge"].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.textContent = pending; el.style.display = pending > 0 ? "inline" : "none"; }
    });
  });
}
function listenGroups() {
  onSnapshot(collection(db, "groups"), snap => {
    groups = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderGroups();
    populateGroupFilters();
    populateScheduleGroupFilter();
    // Re-render tables now that groups are loaded
    if (employees.length > 0) {
      renderStaffTable();
      renderEmpTable();
    }
  });
}
function listenAudit() {
  const q = query(collection(db, "auditLog"), orderBy("at", "desc"));
  onSnapshot(q, snap => {
    auditItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAuditLog(auditItems);
  });
}

// ── Stats ────────────────────────────────────────────────────────
function updateStats() {
  const today = todayStr();
  document.getElementById("statTotal").textContent    = employees.length;
  document.getElementById("statOnLeave").textContent  = requests.filter(r =>
    r.status === "Approved" && r.startDate <= today && r.endDate >= today).length;
  document.getElementById("statPending").textContent  = requests.filter(r => r.status === "Pending").length;
  document.getElementById("statClash").textContent    = requests.filter(r => r.hasClash && r.status === "Pending").length;
  document.getElementById("statRenewals").textContent = employees.filter(isRenewalDue).length;
}

// ── Schedule ─────────────────────────────────────────────────────
function populateScheduleGroupFilter() {
  const sel = document.getElementById("scheduleGroupFilter");
  if (!sel) return;
  sel.innerHTML = `<option value="all">All Groups</option>` +
    groups.map(g => `<option value="${g.id}">${g.name}</option>`).join("");
}

// ── Schedule ─────────────────────────────────────────────────────
function renderStaffTable() {
  const dept   = document.getElementById("deptFilter").value;
  const grp    = document.getElementById("groupFilter").value;
  const search = document.getElementById("staffSearch").value.toLowerCase();
  const today  = todayStr();
  const tbody  = document.getElementById("staffTableBody");

  let emps = [...employees];
  if (dept  !== "all") emps = emps.filter(e => e.dept === dept);
  if (grp   !== "all") emps = emps.filter(e => e.groupId === grp);
  if (search)          emps = emps.filter(e => (e.name||"").toLowerCase().includes(search));
  emps.sort((a, b) => (a.name||"").localeCompare(b.name||""));

  if (!emps.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="tbl-empty">No employees found.</td></tr>`;
    return;
  }

  const onLeaveSet = new Set(requests.filter(r =>
    r.status === "Approved" && r.startDate <= today && r.endDate >= today).map(r => r.employeeId));

  tbody.innerHTML = emps.map(emp => {
    const used   = emp.leaveUsed   || 0;
    const ent    = emp.entitlement || 0;
    const rem    = Math.max(0, ent - used);
    const unpaid = emp.unpaidUsed  || 0;
    const grpName= groups.find(g => g.id === emp.groupId)?.name || "--";
    const cs = emp.cycleStart, ce = emp.cycleEnd || cycleEnd(cs || today);
    const onLeave = onLeaveSet.has(emp.id);
    const renewal = isRenewalDue(emp);

    return `<tr class="row-expand" onclick="expandEmployee('${emp.id}')">
      <td class="col-sticky">
        <div style="display:flex;align-items:center;gap:8px">
          <div class="group-avatar" style="width:30px;height:30px;font-size:11px">${initials(emp.name)}</div>
          <div>
            <div style="font-weight:600">${emp.name||"--"}</div>
            ${onLeave ? `<span style="font-size:10px;color:var(--green)">● On Leave</span>` : ""}
            ${renewal ? `<span style="font-size:10px;color:var(--orange)">⚠ Renewal Due</span>` : ""}
          </div>
        </div>
      </td>
      <td>${deptBadge(emp.dept)}</td>
      <td>${grpName}</td>
      <td>${emp.dept==="DO"?(emp.pattern||"--"):"Mon–Thu"}</td>
      <td>${ent} days</td>
      <td>${used} days</td>
      <td>${rem} days</td>
      <td>${unpaid} days</td>
      <td style="font-size:11px;color:var(--gray-500)">${fmtDate(cs)} – ${fmtDate(ce)}</td>
      <td>${onLeave ? statusBadge("Approved") : `<span style="color:var(--gray-300);font-size:11px">Available</span>`}</td>
    </tr>`;
  }).join("");
}

// ── Expand employee ──────────────────────────────────────────────
window.expandEmployee = (empId) => {
  const emp = employees.find(e => e.id === empId);
  if (!emp) return;
  document.getElementById("expandedLeaveCard").style.display = "block";
  document.getElementById("expandedEmpName").textContent = emp.name + " — Leave Requests";
  document.getElementById("expandedLeaveCard").scrollIntoView({ behavior:"smooth", block:"nearest" });

  const empReqs = requests.filter(r => r.employeeId === empId)
    .sort((a,b) => (b.submittedAt?.seconds||0) - (a.submittedAt?.seconds||0));
  const tbody = document.getElementById("expandedBody");

  if (!empReqs.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="tbl-empty">No requests yet.</td></tr>`; return;
  }
  tbody.innerHTML = empReqs.map((r, i) => `
    <tr>
      <td>${i+1}</td><td>${r.leaveType}</td>
      <td>${fmtDate(r.startDate)}</td><td>${fmtDate(r.endDate)}</td>
      <td>${r.days}</td><td>${statusBadge(r.status)}</td>
      <td>${r.hasClash && r.clashingWith?.length?`<span class="clash-flag" style="font-size:10px">⚠️ ${r.clashingWith.join(', ')}</span>`:`<span class="no-clash">—</span>`}</td>
      <td style="font-size:11px;color:var(--gray-400)">${r.notes||"--"}</td>
      <td>${r.status==="Pending"?`
        <div style="display:flex;gap:4px">
          <button class="btn btn-xs btn-success" onclick="approveReq('${r.id}','${empId}')">✓</button>
          <button class="btn btn-xs btn-danger"  onclick="rejectReq('${r.id}')">✕</button>
        </div>`:
        `<span style="color:var(--gray-300);font-size:11px">${r.status}</span>`}
      </td>
    </tr>`).join("");
};

document.getElementById("closeExpanded").addEventListener("click", () => {
  document.getElementById("expandedLeaveCard").style.display = "none";
});

// ── Approvals ────────────────────────────────────────────────────
function renderApprovals() {
  const filter = document.getElementById("approvalFilter").value;
  const tbody  = document.getElementById("approvalsBody");
  let list = [...requests];
  if (filter !== "all") list = list.filter(r => r.status === filter);
  list.sort((a,b) => {
    // Edit requests first, then pending, then rest
    if (a.editRequested && !b.editRequested) return -1;
    if (b.editRequested && !a.editRequested) return 1;
    if (a.status==="Pending" && b.status!=="Pending") return -1;
    if (b.status==="Pending" && a.status!=="Pending") return 1;
    return (b.submittedAt?.seconds||0)-(a.submittedAt?.seconds||0);
  });

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="tbl-empty">No requests.</td></tr>`; return;
  }
  tbody.innerHTML = list.map(r => `
    <tr>
      <td><strong>${r.employeeName}</strong></td>
      <td>${deptBadge(r.employeeDept)}</td>
      <td>${r.leaveType}</td>
      <td>${fmtDate(r.startDate)}</td><td>${fmtDate(r.endDate)}</td>
      <td>${r.days}</td>
      <td>${r.hasClash && r.clashingWith?.length?`<span class="clash-flag">⚠️ ${r.clashingWith.map(nameOrId => {
        const emp = employees.find(e => e.id === nameOrId || e.name === nameOrId);
        const grp = emp ? (groups.find(g => g.id === emp.groupId)?.name || '') : '';
        const displayName = emp ? emp.name : nameOrId;
        return grp ? displayName + ' (' + grp + ')' : displayName;
      }).join(', ')}</span>`:`<span class="no-clash">—</span>`}</td>
      <td style="font-size:11px;color:var(--gray-400)">${fmtDateTime(r.submittedAt)}</td>
      <td>${statusBadge(r.status)}</td>
      <td>
        ${r.status==="Pending"?`
          <div style="display:flex;gap:4px">
            <button class="btn btn-xs btn-success" onclick="approveReq('${r.id}','${r.employeeId}')">Approve</button>
            <button class="btn btn-xs btn-danger"  onclick="rejectReq('${r.id}')">Reject</button>
          </div>`:
        r.editRequested && r.status==="Approved"?`
          <div style="display:flex;gap:4px;flex-wrap:wrap">
            <span style="font-size:10px;color:var(--orange);font-weight:600">✏️ Edit Requested</span>
            <button class="btn btn-xs btn-success" onclick="allowEdit('${r.id}','${r.employeeEmail}','${r.employeeName}')">Allow Edit</button>
            <button class="btn btn-xs btn-danger"  onclick="denyEdit('${r.id}','${r.employeeEmail}','${r.employeeName}')">Deny</button>
          </div>`:"--"}
      </td>
    </tr>`).join("");
}

// ── Approve / Reject ─────────────────────────────────────────────
window.approveReq = async (reqId, empId) => {
  try {
    const rSnap = await getDoc(doc(db, "leaveRequests", reqId));
    if (!rSnap.exists()) return;
    const r = rSnap.data();
    const batch = writeBatch(db);
    batch.update(doc(db, "leaveRequests", reqId), { status: "Approved" });

    const eSnap = await getDoc(doc(db, "employees", empId));
    if (eSnap.exists()) {
      const fieldMap = {
        Annual:    "leaveUsed",
        Unpaid:    "unpaidUsed",
        Paternity: "paternityUsed",
        Hajj:      "hajjUsed",
        Emergency: "emergencyUsed",
        Custom:    "customUsed"
      };
      const field = fieldMap[r.leaveType] || "customUsed";
      batch.update(doc(db, "employees", empId), {
        [field]: (eSnap.data()[field] || 0) + (r.days || 0)
      });
    }
    batch.set(doc(collection(db,"auditLog")), {
      action:"approved", label:`Approved leave for ${r.employeeName}`,
      detail:`${fmtDate(r.startDate)} – ${fmtDate(r.endDate)} (${r.days} days)`,
      by: MGR.name||MGR.uid, at: serverTimestamp()
    });
    await batch.commit();

    if (r.employeeEmail) sendEmail(
      r.employeeEmail,
      "Leave Request Approved ✓",
      `Hi ${r.employeeName},\n\nYour leave request has been APPROVED.\nDates: ${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}\nDays: ${r.days}\nType: ${r.leaveType}\n\nRegards,\nAnnual Leave System`
    );
    toast(`Approved ${r.days} days for ${r.employeeName}`);
  } catch(err) { toast("Failed to approve.","error"); console.error(err); }
};

window.rejectReq = (reqId) => {
  openPin("Reject this leave request?", async () => {
    try {
      const rSnap = await getDoc(doc(db,"leaveRequests",reqId));
      if (!rSnap.exists()) return;
      const r = rSnap.data();
      const batch = writeBatch(db);
      batch.update(doc(db,"leaveRequests",reqId), { status:"Rejected" });
      batch.set(doc(collection(db,"auditLog")), {
        action:"rejected", label:`Rejected leave for ${r.employeeName}`,
        detail:`${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}`,
        by: MGR.name||MGR.uid, at: serverTimestamp()
      });
      await batch.commit();
      if (r.employeeEmail) sendEmail(
        r.employeeEmail,
        "Leave Request Rejected",
        `Hi ${r.employeeName},\n\nYour leave request from ${fmtDate(r.startDate)} to ${fmtDate(r.endDate)} has been REJECTED.\n\nPlease contact your manager for more information.\n\nRegards,\nAnnual Leave System`
      );
      toast(`Rejected request for ${r.employeeName}`);
    } catch(err) { toast("Failed to reject.","error"); console.error(err); }
  });
};

// ── Employees table ──────────────────────────────────────────────
function renderEmpTable() {
  const tbody = document.getElementById("empTableBody");
  const emps  = [...employees].sort((a,b) => (a.name||"").localeCompare(b.name||""));
  if (!emps.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="tbl-empty">No employees yet.</td></tr>`; return;
  }
  const grpName = (id) => groups.find(g => g.id === id)?.name || "--";
  tbody.innerHTML = emps.map(emp => `
    <tr>
      <td><strong>${emp.name||"--"}</strong></td>
      <td style="font-size:12px;color:var(--gray-500)">${emp.email||"--"}</td>
      <td>${deptBadge(emp.dept)}</td>
      <td>${grpName(emp.groupId)}</td>
      <td>${emp.dept==="DO"?(emp.pattern||"--"):"Mon–Thu"}</td>
      <td>${fmtDate(emp.joinDate)}</td>
      <td>${fmtDate(emp.cycleStart)}</td>
      <td>${emp.entitlement||0} days</td>
      <td>${roleBadge(emp.role||"staff")}</td>
      <td>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          <button class="btn btn-xs btn-success" onclick="openRenewModal('${emp.id}')">Renew</button>
          <button class="btn btn-xs btn-outline-sm" onclick="openEditEmp('${emp.id}')">Edit</button>
          <button class="btn btn-xs btn-danger" onclick="removeEmployee('${emp.id}')">Remove</button>
        </div>
      </td>
    </tr>`).join("");
}

// ── Add / Edit employee ──────────────────────────────────────────
function openEmpModal(title) {
  document.getElementById("empModalTitle").textContent  = title;
  document.getElementById("empFormError").textContent   = "";
  document.getElementById("empFormSubmit").textContent  = editingEmpId ? "Save Changes" : "Add Employee";
  const sel = document.getElementById("efGroup");
  sel.innerHTML = `<option value="">No Group</option>` +
    groups.map(g => `<option value="${g.id}">${g.name}</option>`).join("");
  document.getElementById("empModal").style.display = "flex";
}

document.getElementById("addEmpBtn").addEventListener("click", () => {
  editingEmpId = null;
  document.getElementById("empForm").reset();
  document.getElementById("empFormUid").value = "";
  document.getElementById("efPatternGroup").style.display = "flex";
  document.getElementById("efRosterGroup").style.display  = "flex";
  openEmpModal("Add Employee");
});

window.openEditEmp = (empId) => {
  const emp = employees.find(e => e.id === empId);
  if (!emp) return;
  editingEmpId = empId;
  document.getElementById("empFormUid").value    = empId;
  document.getElementById("efName").value        = emp.name||"";
  document.getElementById("efEmail").value       = emp.email||"";
  document.getElementById("efPassword").value    = "";
  document.getElementById("efRole").value        = emp.role||"staff";
  document.getElementById("efDept").value        = emp.dept||"DO";
  document.getElementById("efPattern").value     = emp.pattern||"";
  document.getElementById("efJoinDate").value    = emp.joinDate||"";
  document.getElementById("efEntitlement").value = emp.entitlement||"";
  document.getElementById("efRosterStart").value = emp.rosterStart||"";
  document.getElementById("efGroup").value       = emp.groupId||"";
  document.getElementById("efPatternGroup").style.display = emp.dept==="DO" ? "flex" : "none";
  document.getElementById("efRosterGroup").style.display  = emp.dept==="DO" ? "flex" : "none";
  openEmpModal("Edit Employee");
};

document.getElementById("efDept").addEventListener("change", e => {
  const isDO = e.target.value === "DO";
  document.getElementById("efPatternGroup").style.display = isDO ? "flex" : "none";
  document.getElementById("efRosterGroup").style.display  = isDO ? "flex" : "none";
});

["empModalClose","empModalCancel"].forEach(id => {
  document.getElementById(id).addEventListener("click", () => {
    document.getElementById("empModal").style.display = "none";
    editingEmpId = null;
  });
});

document.getElementById("empForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("empFormError");
  errEl.textContent = "";

  const name        = document.getElementById("efName").value.trim();
  const email       = document.getElementById("efEmail").value.trim().toLowerCase();
  const password    = document.getElementById("efPassword").value;
  const role        = document.getElementById("efRole").value;
  const dept        = document.getElementById("efDept").value;
  const pattern     = dept==="DO" ? document.getElementById("efPattern").value.trim().toUpperCase() : "";
  const joinDate    = document.getElementById("efJoinDate").value;
  const entitlement = parseInt(document.getElementById("efEntitlement").value);
  const groupId     = document.getElementById("efGroup").value || null;
  const rosterStart = dept==="DO" ? (document.getElementById("efRosterStart").value || joinDate) : null;

  if (!name || !email || !joinDate || !entitlement) {
    errEl.textContent = "Please fill all required fields."; return;
  }
  if (dept==="DO" && !pattern.match(/^\d+W\d+O$/i)) {
    errEl.textContent = "Invalid pattern. Use format like 6W4O or 3W3O."; return;
  }
  if (!editingEmpId && !password) {
    errEl.textContent = "Password required for new employees."; return;
  }
  if (!editingEmpId && password.length < 6) {
    errEl.textContent = "Password must be at least 6 characters."; return;
  }

  // Cycle start = joining date, cycle end = 1 year later
  const cycleStart   = joinDate;
  const cycleEndDate = cycleEnd(joinDate);

  const submitBtn = document.getElementById("empFormSubmit");
  submitBtn.disabled = true;
  submitBtn.textContent = editingEmpId ? "Saving..." : "Adding...";

  try {
    if (!editingEmpId) {
      // Use secondary app to create user — manager stays logged in
      const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
      const uid  = cred.user.uid;
      await secondaryAuth.signOut();

      const batch = writeBatch(db);
      batch.set(doc(db,"users",uid), { name, email, role, dept, createdAt: serverTimestamp() });
      batch.set(doc(db,"employees",uid), {
        name, email, dept, pattern, joinDate,
        cycleStart, cycleEnd: cycleEndDate,
        rosterStart, entitlement,
        leaveUsed: 0, unpaidUsed: 0,
        groupId, role,
        cycleId: `${uid}_${cycleStart}`,
        createdAt: serverTimestamp()
      });
      await batch.commit();

      await addDoc(collection(db,"auditLog"), {
        action:"employee_added", label:`Added ${name}`,
        detail:`${dept} · ${email}`, by: MGR.name||MGR.uid, at: serverTimestamp()
      });
      toast(`${name} added successfully!`);

    } else {
      // Edit existing
      const empData = {
        name, dept, pattern, joinDate,
        cycleStart, cycleEnd: cycleEndDate,
        rosterStart, entitlement, groupId, role
      };
      const batch = writeBatch(db);
      batch.update(doc(db,"employees",editingEmpId), empData);
      batch.update(doc(db,"users",editingEmpId), { name, role, dept });
      await batch.commit();

      await addDoc(collection(db,"auditLog"), {
        action:"employee_edited", label:`Edited ${name}`,
        detail:`${dept} · ${email}`, by: MGR.name||MGR.uid, at: serverTimestamp()
      });
      toast(`${name} updated!`);
    }

    document.getElementById("empModal").style.display = "none";
    editingEmpId = null;

  } catch(err) {
    if (err.code === "auth/email-already-in-use") {
      errEl.textContent = "This email is already registered.";
    } else {
      errEl.textContent = "Error: " + err.message;
    }
    console.error(err);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = editingEmpId ? "Save Changes" : "Add Employee";
  }
});

// ── Remove employee ──────────────────────────────────────────────
window.removeEmployee = (empId) => {
  const emp = employees.find(e => e.id === empId);
  if (!emp) return;
  openPin(`Permanently remove ${emp.name}?`, async () => {
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db,"employees",empId));
      batch.delete(doc(db,"users",empId));
      batch.set(doc(collection(db,"auditLog")), {
        action:"employee_removed", label:`Removed ${emp.name}`,
        detail: emp.email||"", by: MGR.name||MGR.uid, at: serverTimestamp()
      });
      await batch.commit();
      toast(`${emp.name} removed.`);
    } catch(err) { toast("Failed to remove.","error"); console.error(err); }
  });
};

// ── Renew cycle ──────────────────────────────────────────────────
window.openRenewModal = (empId) => {
  const emp = employees.find(e => e.id === empId);
  if (!emp) return;
  document.getElementById("renewEmpId").value = empId;
  document.getElementById("renewInfo").textContent =
    `Renewing: ${emp.name} (${emp.dept}) — Current: ${fmtDate(emp.cycleStart)} – ${fmtDate(emp.cycleEnd)}`;
  const nextStart = emp.cycleEnd
    ? new Date(new Date(emp.cycleEnd+"T00:00:00").getTime()+86400000).toISOString().split("T")[0]
    : todayStr();
  document.getElementById("rfCycleStart").value  = nextStart;
  document.getElementById("rfEntitlement").value = emp.entitlement||0;
  document.getElementById("renewFormError").textContent = "";
  document.getElementById("renewModal").style.display = "flex";
};

["renewModalClose","renewModalCancel"].forEach(id => {
  document.getElementById(id).addEventListener("click", () => {
    document.getElementById("renewModal").style.display = "none";
  });
});

document.getElementById("renewForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const empId   = document.getElementById("renewEmpId").value;
  const newStart= document.getElementById("rfCycleStart").value;
  const newEnt  = parseInt(document.getElementById("rfEntitlement").value);
  const errEl   = document.getElementById("renewFormError");
  errEl.textContent = "";
  if (!newStart || !newEnt) { errEl.textContent = "Fill all fields."; return; }

  const emp = employees.find(e => e.id === empId);
  if (!emp) return;
  try {
    await addDoc(collection(db,"cycleHistory"), {
      employeeId: empId, employeeName: emp.name, dept: emp.dept,
      cycleStart: emp.cycleStart, cycleEnd: emp.cycleEnd,
      entitlement: emp.entitlement, leaveUsed: emp.leaveUsed||0,
      unpaidUsed: emp.unpaidUsed||0, archivedAt: serverTimestamp()
    });
    const newEnd = cycleEnd(newStart);
    await updateDoc(doc(db,"employees",empId), {
      cycleStart: newStart, cycleEnd: newEnd,
      entitlement: newEnt, leaveUsed: 0, unpaidUsed: 0,
      cycleId: `${empId}_${newStart}`
    });
    await addDoc(collection(db,"auditLog"), {
      action:"cycle_renewed", label:`Renewed cycle for ${emp.name}`,
      detail:`${fmtDate(newStart)} – ${fmtDate(newEnd)} · ${newEnt} days`,
      by: MGR.name||MGR.uid, at: serverTimestamp()
    });
    toast(`Cycle renewed for ${emp.name}!`);
    document.getElementById("renewModal").style.display = "none";
  } catch(err) { document.getElementById("renewFormError").textContent = "Failed: "+err.message; }
});

// ── Groups ───────────────────────────────────────────────────────
function populateGroupFilters() {
  const sel = document.getElementById("groupFilter");
  sel.innerHTML = `<option value="all">All Groups</option>` +
    groups.map(g => `<option value="${g.id}">${g.name}</option>`).join("");
  // Also populate schedule group filter
  const ssel = document.getElementById("scheduleGroupFilter");
  if (ssel) {
    ssel.innerHTML = `<option value="all">All Groups</option>` +
      groups.map(g => `<option value="${g.id}">${g.name}</option>`).join("");
  }
}

// ── Schedule ─────────────────────────────────────────────────────
function renderGroups() {
  const el = document.getElementById("groupsGrid");
  if (!groups.length) {
    el.innerHTML = `<div class="list-empty">No groups yet. Create one to assign staff.</div>`; return;
  }
  el.innerHTML = groups.map(g => {
    const members = employees.filter(e => e.groupId === g.id);
    return `<div class="group-card">
      <div class="group-card-head">
        <span class="group-card-name">${g.name}</span>
        <button class="btn btn-xs btn-ghost" onclick="removeGroup('${g.id}')">Remove</button>
      </div>
      <div class="group-card-body">
        ${g.description?`<div style="font-size:12px;color:var(--gray-400);margin-bottom:6px">${g.description}</div>`:""}
        ${members.length ? members.map(m=>`
          <div class="group-member">
            <div class="group-avatar">${initials(m.name)}</div>
            <div><div>${m.name}</div><div style="font-size:11px;color:var(--gray-400)">${m.dept}</div></div>
          </div>`).join("") :
          `<div style="font-size:12px;color:var(--gray-400)">No members assigned yet.</div>`}
      </div>
    </div>`;
  }).join("");
}

document.getElementById("addGroupBtn").addEventListener("click", () => {
  document.getElementById("groupForm").reset();
  document.getElementById("groupFormError").textContent = "";
  document.getElementById("groupModal").style.display = "flex";
});
["groupModalClose","groupModalCancel"].forEach(id => {
  document.getElementById(id).addEventListener("click", () =>
    document.getElementById("groupModal").style.display = "none");
});
document.getElementById("groupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("gfName").value.trim();
  const desc = document.getElementById("gfDesc").value.trim();
  if (!name) { document.getElementById("groupFormError").textContent = "Name required."; return; }
  try {
    await addDoc(collection(db,"groups"), { name, description:desc, createdAt:serverTimestamp() });
    toast(`Group "${name}" created!`);
    document.getElementById("groupModal").style.display = "none";
  } catch(err) { document.getElementById("groupFormError").textContent = "Failed: "+err.message; }
});

window.removeGroup = async (groupId) => {
  if (!confirm("Remove this group? Members won't be deleted.")) return;
  try {
    await deleteDoc(doc(db,"groups",groupId));
    toast("Group removed.");
  } catch { toast("Failed.","error"); }
};

// ── Audit log ────────────────────────────────────────────────────
function renderAuditLog(items) {
  const filter = document.getElementById("auditFilter").value;
  const el     = document.getElementById("auditList");
  const list   = filter==="all" ? items : items.filter(i => i.action===filter);
  const icons  = { approved:"✅", rejected:"❌", employee_added:"👤",
                   employee_removed:"🗑", employee_edited:"✏️", cycle_renewed:"🔄" };
  if (!list.length) { el.innerHTML=`<div class="list-empty">No entries.</div>`; return; }
  el.innerHTML = list.map(a => `
    <div class="audit-item">
      <div class="audit-icon">${icons[a.action]||"📋"}</div>
      <div class="audit-content">
        <div class="audit-action">${a.label}</div>
        <div class="audit-meta">${a.detail||""} · by ${a.by} · ${fmtDateTime(a.at)}</div>
      </div>
    </div>`).join("");
}

// ── Schedule ─────────────────────────────────────────────────────
function renderSchedule() {
  const tbody    = document.getElementById("scheduleBody");
  if (!tbody) return;
  const groupF   = document.getElementById("scheduleGroupFilter")?.value || "all";
  const monthF   = document.getElementById("scheduleMonthFilter")?.value || "all";
  const today    = todayStr();

  // Get all approved leave that hasn't ended yet
  let list = requests.filter(r => r.status === "Approved" && r.endDate >= today);

  // Filter by group
  if (groupF !== "all") {
    list = list.filter(r => {
      const emp = employees.find(e => e.id === r.employeeId);
      return emp?.groupId === groupF;
    });
  }

  // Filter by month (start date month)
  if (monthF !== "all") {
    list = list.filter(r => {
      const m = new Date(r.startDate + "T00:00:00").getMonth();
      return m === parseInt(monthF);
    });
  }

  // Sort by start date
  list.sort((a,b) => a.startDate.localeCompare(b.startDate));

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="tbl-empty">No upcoming approved leave.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(r => {
    const emp     = employees.find(e => e.id === r.employeeId);
    const grpName = emp ? (groups.find(g => g.id === emp.groupId)?.name || "--") : "--";
    const isOnLeave = r.startDate <= today && r.endDate >= today;
    return `<tr>
      <td><strong>${r.employeeName}</strong></td>
      <td>${deptBadge(r.employeeDept || emp?.dept || "--")}</td>
      <td>${grpName}</td>
      <td>${r.leaveType}</td>
      <td>${fmtDate(r.startDate)}</td>
      <td>${fmtDate(r.endDate)}</td>
      <td>${r.days} days</td>
      <td>${isOnLeave
        ? `<span class="status-badge sb-approved">● On Leave Now</span>`
        : `<span class="status-badge" style="background:var(--blue-light);color:var(--blue)">Upcoming</span>`}
      </td>
    </tr>`;
  }).join("");
}

// ── Allow / Deny Edit ────────────────────────────────────────────
window.allowEdit = async (reqId, empEmail, empName) => {
  try {
    await updateDoc(doc(db, "leaveRequests", reqId), {
      status: "EditAllowed",
      editRequested: false
    });
    if (empEmail) sendEmail(
      empEmail,
      "Edit Request Approved",
      `Hi ${empName},

Your request to edit your leave has been approved.
Please log in and make your changes from My History.

Regards,
Annual Leave System`
    );
    toast("Edit allowed — staff can now edit their request.");
  } catch(err) { toast("Failed.", "error"); console.error(err); }
};

window.denyEdit = async (reqId, empEmail, empName) => {
  try {
    await updateDoc(doc(db, "leaveRequests", reqId), {
      editRequested: false
    });
    if (empEmail) sendEmail(
      empEmail,
      "Edit Request Denied",
      `Hi ${empName},

Your request to edit your approved leave has been denied.
Please contact your manager for further information.

Regards,
Annual Leave System`
    );
    toast("Edit request denied.");
  } catch(err) { toast("Failed.", "error"); console.error(err); }
};

// ── MY LEAVE ─────────────────────────────────────────────────────
let MGR_EMP = null;
let MGR_MY_REQUESTS = [];

async function initMyLeave() {
  console.log("initMyLeave called, MGR.uid =", MGR?.uid);
  if (!MGR?.uid) { console.log("MGR not ready"); setTimeout(initMyLeave, 1000); return; }
  // Load manager's own employee record
  const eSnap = await getDoc(doc(db, "employees", MGR.uid));
  console.log("Employee snap exists:", eSnap.exists(), "data:", eSnap.data());
  if (!eSnap.exists()) {
    console.log("No employee record found for UID:", MGR.uid);
    document.getElementById("mgr-historyList").innerHTML = '<div class="list-empty">No employee record found. Please add yourself as an employee first.</div>';
    return;
  }
  MGR_EMP = { id: eSnap.id, ...eSnap.data() };
  console.log("MGR_EMP loaded:", MGR_EMP);

  // Show pattern fields if DO
  if (MGR_EMP.dept === "DO") {
    document.getElementById("mgr-doPatternFields").style.display = "block";
    if (MGR_EMP.pattern)     document.getElementById("mgr-fPattern").value     = MGR_EMP.pattern;
    if (MGR_EMP.rosterStart) document.getElementById("mgr-fRosterStart").value = MGR_EMP.rosterStart;
  }

  renderMgrBalance();

  // Listen to own requests
  const q = query(collection(db,"leaveRequests"), where("employeeId","==",MGR.uid), orderBy("submittedAt","desc"));
  onSnapshot(q, snap => {
    MGR_MY_REQUESTS = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderMgrHistory();
  });

  // Date change listeners
  document.getElementById("mgr-fStartDate").addEventListener("change", mgrValidateDates);
  document.getElementById("mgr-fEndDate").addEventListener("change",   mgrValidateDates);
  document.getElementById("mgr-fLeaveType").addEventListener("change", () => {
    document.getElementById("mgr-customReasonGroup").style.display =
      document.getElementById("mgr-fLeaveType").value === "Custom" ? "block" : "none";
    mgrValidateDates();
  });
  document.getElementById("mgr-fPattern")?.addEventListener("input", mgrValidateDates);
  document.getElementById("mgr-fRosterStart")?.addEventListener("change", mgrValidateDates);
}

function renderMgrBalance() {
  if (!MGR_EMP) return;
  const used = MGR_EMP.leaveUsed||0, ent = MGR_EMP.entitlement||0;
  const rem  = Math.max(0, ent-used);
  const pct  = ent>0 ? Math.min(100,Math.round(used/ent*100)) : 0;
  const other= (MGR_EMP.unpaidUsed||0)+(MGR_EMP.paternityUsed||0)+(MGR_EMP.hajjUsed||0)+(MGR_EMP.emergencyUsed||0)+(MGR_EMP.customUsed||0);
  document.getElementById("mgr-bcEntitlement").textContent = ent;
  document.getElementById("mgr-bcUsed").textContent        = used;
  document.getElementById("mgr-bcRemaining").textContent   = rem;
  document.getElementById("mgr-bcOther").textContent       = other;
  document.getElementById("mgr-progressPct").textContent   = pct+"%";
  document.getElementById("mgr-progressLabel").textContent = `${used} of ${ent} annual days used`;
  const fill = document.getElementById("mgr-progressFill");
  fill.style.width = pct+"%";
  fill.className = "progress-fill"+(pct>=90?" danger":pct>=70?" warn":"");
  const cs=MGR_EMP.cycleStart, ce=MGR_EMP.cycleEnd||cycleEnd(cs||todayStr());
  document.getElementById("mgr-cycleInfo").textContent = `Cycle: ${fmtDate(cs)} – ${fmtDate(ce)} | ${MGR_EMP.dept} Staff`;
}

function mgrGetPattern() {
  if (MGR_EMP?.dept !== "DO") return null;
  return (document.getElementById("mgr-fPattern")?.value.toUpperCase().trim()) || MGR_EMP?.pattern;
}
function mgrGetRosterStart() {
  if (MGR_EMP?.dept !== "DO") return null;
  return document.getElementById("mgr-fRosterStart")?.value || MGR_EMP?.rosterStart;
}
function mgrIsWorkDay(dateStr) {
  if (!MGR_EMP) return false;
  if (MGR_EMP.dept==="GD") return isGDWorkDay(dateStr);
  return isDOWorkDay(dateStr, mgrGetPattern(), mgrGetRosterStart());
}

function mgrValidateDates() {
  const s = document.getElementById("mgr-fStartDate").value;
  const e = document.getElementById("mgr-fEndDate").value;
  if (!s || !e || !MGR_EMP) return;
  const startOk = mgrIsWorkDay(s), endOk = mgrIsWorkDay(e);
  document.getElementById("mgr-startHint").textContent = startOk?"✓ Valid working day":"✗ Not a working day";
  document.getElementById("mgr-startHint").style.color = startOk?"var(--green)":"var(--red)";
  document.getElementById("mgr-endHint").textContent   = endOk?"✓ Valid working day":"✗ Not a working day";
  document.getElementById("mgr-endHint").style.color   = endOk?"var(--green)":"var(--red)";
  if (!startOk||!endOk||e<s) { document.getElementById("mgr-daysPreview").style.display="none"; return; }
  const days = countWorkDays(s,e,MGR_EMP.dept,mgrGetPattern(),mgrGetRosterStart());
  document.getElementById("mgr-daysPreview").style.display="block";
  document.getElementById("mgr-daysCount").textContent=days;
  const leaveType=document.getElementById("mgr-fLeaveType").value;
  const rem=(MGR_EMP.entitlement||0)-(MGR_EMP.leaveUsed||0);
  const bw=document.getElementById("mgr-balanceWarning");
  if (leaveType==="Annual"&&days>rem){bw.style.display="block";bw.textContent=`⚠️ Only ${rem} annual days remaining.`;}
  else bw.style.display="none";
}

document.getElementById("mgr-leaveForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!MGR_EMP) return;
  const errEl=document.getElementById("mgr-formError");
  errEl.textContent="";
  const leaveType=document.getElementById("mgr-fLeaveType").value;
  const customReason=document.getElementById("mgr-fCustomReason").value.trim();
  const s=document.getElementById("mgr-fStartDate").value;
  const e2=document.getElementById("mgr-fEndDate").value;
  const notes=document.getElementById("mgr-fNotes").value.trim();
  const pattern=mgrGetPattern(), rosterStart=mgrGetRosterStart();
  if (!s||!e2){errEl.textContent="Select start and end dates.";return;}
  if (e2<s){errEl.textContent="End date must be after start date.";return;}
  if (leaveType==="Custom"&&!customReason){errEl.textContent="Enter a reason for custom leave.";return;}
  if (!mgrIsWorkDay(s)){errEl.textContent="Start date is not a valid working day.";return;}
  if (!mgrIsWorkDay(e2)){errEl.textContent="End date is not a valid working day.";return;}
  const days=countWorkDays(s,e2,MGR_EMP.dept,pattern,rosterStart);
  if (days===0){errEl.textContent="No working days in selected range.";return;}
  if (leaveType==="Annual"){
    const rem=(MGR_EMP.entitlement||0)-(MGR_EMP.leaveUsed||0);
    if (days>rem){errEl.textContent=`Insufficient balance. ${rem} days remaining.`;return;}
  }
  try {
    await addDoc(collection(db,"leaveRequests"),{
      employeeId:MGR.uid, employeeName:MGR_EMP.name, employeeDept:MGR_EMP.dept,
      employeeEmail:MGR_EMP.email, groupId:MGR_EMP.groupId||null,
      leaveType, customReason:customReason||null,
      requestPattern:MGR_EMP.dept==="DO"?pattern:null,
      requestRosterStart:MGR_EMP.dept==="DO"?rosterStart:null,
      startDate:s, endDate:e2, days, notes, status:"Pending",
      hasClash:false, clashingWith:[],
      submittedAt:serverTimestamp(), editedAt:null, cycleId:MGR_EMP.cycleId||null
    });
    toast(`Leave request submitted — ${days} day(s)`);
    document.getElementById("mgr-leaveForm").reset();
    document.getElementById("mgr-daysPreview").style.display="none";
    document.getElementById("mgr-balanceWarning").style.display="none";
    document.getElementById("mgr-startHint").textContent="";
    document.getElementById("mgr-endHint").textContent="";
    document.getElementById("mgr-customReasonGroup").style.display="none";
  } catch(err){errEl.textContent="Failed to submit.";console.error(err);}
});

function renderMgrHistory() {
  const el=document.getElementById("mgr-historyList");
  if (!MGR_MY_REQUESTS.length){el.innerHTML=`<div class="list-empty">No leave requests yet.</div>`;return;}
  el.innerHTML=MGR_MY_REQUESTS.map(r=>`
    <div class="request-item">
      <div class="req-top">
        <span class="req-dates">${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}</span>
        ${statusBadge(r.status)}
      </div>
      <div class="req-meta">
        <span class="req-days">${r.days} working day(s)</span>
        ${leaveTypeBadge(r.leaveType)}
        ${r.customReason?`<span style="font-size:11px;color:var(--gray-500)">${r.customReason}</span>`:""}
      </div>
      <div class="req-notes">${r.notes||""}</div>
    </div>`).join("");
}

// ── Manager Change Password ──────────────────────────────────────
document.getElementById("mgrChangePwBtn").addEventListener("click", () => {
  document.getElementById("mgrChangePwForm").reset();
  document.getElementById("mgrChangePwError").textContent = "";
  document.getElementById("mgrChangePwSuccess").textContent = "";
  document.getElementById("mgrChangePwModal").style.display = "flex";
});
document.getElementById("mgrChangePwClose").addEventListener("click",  () => document.getElementById("mgrChangePwModal").style.display = "none");
document.getElementById("mgrChangePwCancel").addEventListener("click", () => document.getElementById("mgrChangePwModal").style.display = "none");
document.getElementById("mgrChangePwForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const currentPw = document.getElementById("mgrCurrentPw").value;
  const newPw     = document.getElementById("mgrNewPw").value;
  const confirmPw = document.getElementById("mgrConfirmPw").value;
  const errEl     = document.getElementById("mgrChangePwError");
  const succEl    = document.getElementById("mgrChangePwSuccess");
  errEl.textContent = ""; succEl.textContent = "";
  if (newPw.length < 6) { errEl.textContent = "New password must be at least 6 characters."; return; }
  if (newPw !== confirmPw) { errEl.textContent = "Passwords do not match."; return; }
  try {
    const credential = EmailAuthProvider.credential(auth.currentUser.email, currentPw);
    await reauthenticateWithCredential(auth.currentUser, credential);
    await updatePassword(auth.currentUser, newPw);
    succEl.textContent = "Password updated successfully!";
    document.getElementById("mgrChangePwForm").reset();
  } catch(err) {
    errEl.textContent = err.code === "auth/wrong-password" ? "Current password is incorrect." : "Failed to update password.";
  }
});

// ── PIN confirmation ─────────────────────────────────────────────
let pinCallback = null;

function openPin(message, callback) {
  pinCallback = callback;
  document.getElementById("pinMessage").textContent = message;
  document.getElementById("pinInput").value = "";
  document.getElementById("pinError").textContent = "";
  document.getElementById("pinModal").style.display = "flex";
  setTimeout(() => document.getElementById("pinInput").focus(), 100);
}

["pinModalClose","pinCancel"].forEach(id => {
  document.getElementById(id).addEventListener("click", () => {
    document.getElementById("pinModal").style.display = "none";
    pinCallback = null;
  });
});

document.getElementById("pinConfirm").addEventListener("click", async () => {
  const pw    = document.getElementById("pinInput").value;
  const errEl = document.getElementById("pinError");
  if (!pw) { errEl.textContent = "Enter your password."; return; }
  try {
    const credential = EmailAuthProvider.credential(auth.currentUser.email, pw);
    await reauthenticateWithCredential(auth.currentUser, credential);
    document.getElementById("pinModal").style.display = "none";
    if (pinCallback) pinCallback();
    pinCallback = null;
  } catch { errEl.textContent = "Incorrect password."; }
});
