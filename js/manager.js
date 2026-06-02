// js/manager.js — Manager portal
import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut,
         createUserWithEmailAndPassword, signInWithEmailAndPassword,
         EmailAuthProvider, reauthenticateWithCredential }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
         onSnapshot, addDoc, serverTimestamp, query, orderBy, where, writeBatch }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { fmtDate, fmtDateTime, todayStr, cycleEnd, isRenewalDue,
         countWorkDays, statusBadge, deptBadge, roleBadge, pbar,
         toast, initials }
  from "./utils.js";

let MGR = null;
let employees  = [];
let requests   = [];
let groups     = [];
let editingEmpId = null;

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
}

// ── Sign out ─────────────────────────────────────────────────────
document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  location.href = "../index.html";
});

// ── Tab switching (desktop + mobile) ────────────────────────────
function switchTab(name) {
  document.querySelectorAll(".nav-tab,.mob-tab").forEach(t => {
    t.classList.toggle("active", t.dataset.tab === name);
  });
  document.querySelectorAll(".tab-panel").forEach(p => {
    p.classList.toggle("active", p.id === "tab-" + name);
  });
}
document.querySelectorAll(".nav-tab,.mob-tab").forEach(t => {
  t.addEventListener("click", () => switchTab(t.dataset.tab));
});

// ── Filters ──────────────────────────────────────────────────────
document.getElementById("deptFilter").addEventListener("change",     renderStaffTable);
document.getElementById("groupFilter").addEventListener("change",    renderStaffTable);
document.getElementById("staffSearch").addEventListener("input",     renderStaffTable);
document.getElementById("approvalFilter").addEventListener("change", renderApprovals);

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
    updateStats();
    const pending = requests.filter(r => r.status === "Pending").length;
    ["approvalsBadge","mobBadge"].forEach(id => {
      const el = document.getElementById(id);
      el.textContent = pending;
      el.style.display = pending > 0 ? "inline" : "none";
    });
  });
}

function listenGroups() {
  onSnapshot(collection(db, "groups"), snap => {
    groups = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderGroups();
    populateGroupFilters();
  });
}

function listenAudit() {
  const q = query(collection(db, "auditLog"), orderBy("at", "desc"));
  onSnapshot(q, snap => {
    renderAuditLog(snap.docs.map(d => ({ id: d.id, ...d.data() })));
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

// ── Staff table (Excel-style) ────────────────────────────────────
function renderStaffTable() {
  const dept    = document.getElementById("deptFilter").value;
  const grp     = document.getElementById("groupFilter").value;
  const search  = document.getElementById("staffSearch").value.toLowerCase();
  const today   = todayStr();
  const tbody   = document.getElementById("staffTableBody");

  let emps = [...employees];
  if (dept  !== "all") emps = emps.filter(e => e.dept === dept);
  if (grp   !== "all") emps = emps.filter(e => e.groupId === grp);
  if (search)          emps = emps.filter(e => e.name.toLowerCase().includes(search));
  emps.sort((a, b) => a.name.localeCompare(b.name));

  if (!emps.length) {
    tbody.innerHTML = `<tr><td colspan="12" class="tbl-empty">No employees found.</td></tr>`;
    return;
  }

  const today_onLeave = new Set(
    requests.filter(r => r.status === "Approved" && r.startDate <= today && r.endDate >= today)
            .map(r => r.employeeId)
  );

  tbody.innerHTML = emps.map(emp => {
    const used    = emp.leaveUsed   || 0;
    const ent     = emp.entitlement || 0;
    const rem     = Math.max(0, ent - used);
    const unpaid  = emp.unpaidUsed  || 0;
    const grpName = groups.find(g => g.id === emp.groupId)?.name || "--";
    const cs      = emp.cycleStart, ce = emp.cycleEnd || cycleEnd(cs || today);
    const onLeave = today_onLeave.has(emp.id);
    const renewal = isRenewalDue(emp);

    return `<tr class="row-expand" onclick="expandEmployee('${emp.id}')">
      <td class="col-sticky">
        <div style="display:flex;align-items:center;gap:8px">
          <div class="group-avatar" style="width:30px;height:30px;font-size:11px">${initials(emp.name)}</div>
          <div>
            <div style="font-weight:600">${emp.name}</div>
            ${onLeave ? `<span style="font-size:10px;color:var(--green)">● On Leave</span>` : ""}
            ${renewal ? `<span style="font-size:10px;color:var(--orange)">⚠ Renewal Due</span>` : ""}
          </div>
        </div>
      </td>
      <td>${deptBadge(emp.dept)}</td>
      <td>${grpName}</td>
      <td>${emp.dept === "DO" ? (emp.pattern || "--") : "Mon–Thu"}</td>
      <td>${ent} days</td>
      <td>${used} days</td>
      <td>${rem} days</td>
      <td>${unpaid} days</td>
      <td>${pbar(used, ent)}</td>
      <td style="font-size:11px;color:var(--gray-500)">${fmtDate(cs)} – ${fmtDate(ce)}</td>
      <td>${onLeave ? statusBadge("Approved") : `<span style="color:var(--gray-300);font-size:11px">Available</span>`}</td>
      <td onclick="event.stopPropagation()">
        <div style="display:flex;gap:4px">
          <button class="btn btn-xs btn-success" onclick="openRenewModal('${emp.id}')">Renew</button>
          <button class="btn btn-xs btn-outline" onclick="openEditEmp('${emp.id}')">Edit</button>
          <button class="btn btn-xs btn-danger" onclick="removeEmployee('${emp.id}')">✕</button>
        </div>
      </td>
    </tr>`;
  }).join("");
}

// ── Expand employee leave rows ───────────────────────────────────
window.expandEmployee = (empId) => {
  const emp = employees.find(e => e.id === empId);
  if (!emp) return;

  const card = document.getElementById("expandedLeaveCard");
  card.style.display = "block";
  document.getElementById("expandedEmpName").textContent = emp.name + " — Leave Requests";
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });

  const empReqs = requests
    .filter(r => r.employeeId === empId)
    .sort((a, b) => (b.submittedAt?.seconds||0) - (a.submittedAt?.seconds||0));

  const tbody = document.getElementById("expandedBody");
  if (!empReqs.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="tbl-empty">No requests yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = empReqs.map((r, i) => `
    <tr>
      <td>Request ${i+1}</td>
      <td>${r.leaveType}</td>
      <td>${fmtDate(r.startDate)}</td>
      <td>${fmtDate(r.endDate)}</td>
      <td>${r.days}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${r.hasClash ? `<span class="clash-flag">⚠️ ${r.clashingWith?.length||0}</span>` : `<span class="no-clash">None</span>`}</td>
      <td style="font-size:11px;color:var(--gray-400)">${r.notes||"--"}</td>
      <td>
        ${r.status === "Pending" ? `
          <div style="display:flex;gap:4px">
            <button class="btn btn-xs btn-success" onclick="approveReq('${r.id}','${empId}')">✓</button>
            <button class="btn btn-xs btn-danger"  onclick="rejectReq('${r.id}')">✕</button>
          </div>` : `<span style="color:var(--gray-300);font-size:11px">${r.status}</span>`}
      </td>
    </tr>`).join("");
};

document.getElementById("closeExpanded").addEventListener("click", () => {
  document.getElementById("expandedLeaveCard").style.display = "none";
});

// ── Approvals table ──────────────────────────────────────────────
function renderApprovals() {
  const filter = document.getElementById("approvalFilter").value;
  const tbody  = document.getElementById("approvalsBody");
  let list = [...requests];
  if (filter !== "all") list = list.filter(r => r.status === filter);
  list.sort((a, b) => {
    if (a.status === "Pending" && b.status !== "Pending") return -1;
    if (b.status === "Pending" && a.status !== "Pending") return 1;
    return (b.submittedAt?.seconds||0) - (a.submittedAt?.seconds||0);
  });

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="11" class="tbl-empty">No requests.</td></tr>`;
    return;
  }

  const grpName = (id) => groups.find(g => g.id === id)?.name || "--";
  const empGrp  = (empId) => {
    const e = employees.find(x => x.id === empId);
    return e ? grpName(e.groupId) : "--";
  };

  tbody.innerHTML = list.map(r => `
    <tr>
      <td><strong>${r.employeeName}</strong></td>
      <td>${deptBadge(r.employeeDept)}</td>
      <td>${empGrp(r.employeeId)}</td>
      <td>${r.leaveType}</td>
      <td>${fmtDate(r.startDate)}</td>
      <td>${fmtDate(r.endDate)}</td>
      <td>${r.days}</td>
      <td>${r.hasClash ? `<span class="clash-flag">⚠️ ${r.clashingWith?.join(", ")}</span>` : `<span class="no-clash">None</span>`}</td>
      <td style="font-size:11px;color:var(--gray-400)">${fmtDateTime(r.submittedAt)}</td>
      <td>${statusBadge(r.status)}</td>
      <td>
        ${r.status === "Pending" ? `
          <div style="display:flex;gap:4px">
            <button class="btn btn-xs btn-success" onclick="approveReq('${r.id}','${r.employeeId}')">Approve</button>
            <button class="btn btn-xs btn-danger"  onclick="rejectReq('${r.id}')">Reject</button>
          </div>` : "--"}
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

    // Update balance
    if (r.leaveType === "Annual") {
      const eSnap = await getDoc(doc(db, "employees", empId));
      if (eSnap.exists()) {
        batch.update(doc(db, "employees", empId), {
          leaveUsed: (eSnap.data().leaveUsed || 0) + (r.days || 0)
        });
      }
    } else {
      const eSnap = await getDoc(doc(db, "employees", empId));
      if (eSnap.exists()) {
        batch.update(doc(db, "employees", empId), {
          unpaidUsed: (eSnap.data().unpaidUsed || 0) + (r.days || 0)
        });
      }
    }

    // Audit log
    batch.set(doc(collection(db, "auditLog")), {
      action:    "approved",
      label:     `Approved leave for ${r.employeeName}`,
      detail:    `${fmtDate(r.startDate)} – ${fmtDate(r.endDate)} (${r.days} days)`,
      by:        MGR.name || MGR.uid,
      at:        serverTimestamp()
    });

    await batch.commit();

    // Email staff
    await addDoc(collection(db, "emailQueue"), {
      type:    "approved",
      to:      r.employeeEmail || "",
      subject: "Leave Request Approved ✓",
      body:    `Hi ${r.employeeName},\n\nYour leave request has been APPROVED.\nDates: ${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}\nDays: ${r.days}\nType: ${r.leaveType}\n\nRegards,\nLeave Manager`,
      sentAt:  serverTimestamp()
    });

    toast(`Approved ${r.days} days for ${r.employeeName}`);
  } catch (err) { toast("Failed to approve.", "error"); console.error(err); }
};

window.rejectReq = (reqId) => {
  openPin("Reject this leave request? The employee will be notified.", async () => {
    try {
      const rSnap = await getDoc(doc(db, "leaveRequests", reqId));
      if (!rSnap.exists()) return;
      const r = rSnap.data();

      const batch = writeBatch(db);
      batch.update(doc(db, "leaveRequests", reqId), { status: "Rejected" });
      batch.set(doc(collection(db, "auditLog")), {
        action: "rejected",
        label:  `Rejected leave for ${r.employeeName}`,
        detail: `${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}`,
        by:     MGR.name || MGR.uid,
        at:     serverTimestamp()
      });
      await batch.commit();

      await addDoc(collection(db, "emailQueue"), {
        type:    "rejected",
        to:      r.employeeEmail || "",
        subject: "Leave Request Rejected",
        body:    `Hi ${r.employeeName},\n\nYour leave request from ${fmtDate(r.startDate)} to ${fmtDate(r.endDate)} has been REJECTED.\n\nPlease contact your manager for more information.\n\nRegards,\nLeave Manager`,
        sentAt:  serverTimestamp()
      });

      toast(`Rejected request for ${r.employeeName}`);
    } catch (err) { toast("Failed to reject.", "error"); console.error(err); }
  });
};

// ── Employees table ──────────────────────────────────────────────
function renderEmpTable() {
  const tbody = document.getElementById("empTableBody");
  const emps  = [...employees].sort((a,b) => a.name.localeCompare(b.name));
  if (!emps.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="tbl-empty">No employees yet.</td></tr>`;
    return;
  }
  const grpName = (id) => groups.find(g => g.id === id)?.name || "--";
  tbody.innerHTML = emps.map(emp => `
    <tr>
      <td><strong>${emp.name}</strong></td>
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
          <button class="btn btn-xs btn-outline" onclick="openEditEmp('${emp.id}')">Edit</button>
          <button class="btn btn-xs btn-danger"  onclick="removeEmployee('${emp.id}')">Remove</button>
        </div>
      </td>
    </tr>`).join("");
}

// ── Add / Edit employee modal ────────────────────────────────────
function openEmpModal(title = "Add Employee") {
  document.getElementById("empModalTitle").textContent = title;
  document.getElementById("empFormError").textContent  = "";
  document.getElementById("empFormSubmit").textContent = editingEmpId ? "Save Changes" : "Add Employee";
  // Populate group dropdown
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
  document.getElementById("empFormUid").value   = empId;
  document.getElementById("efName").value       = emp.name || "";
  document.getElementById("efEmail").value      = emp.email || "";
  document.getElementById("efPassword").value   = "";
  document.getElementById("efRole").value       = emp.role || "staff";
  document.getElementById("efDept").value       = emp.dept || "DO";
  document.getElementById("efPattern").value    = emp.pattern || "";
  document.getElementById("efJoinDate").value   = emp.joinDate || "";
  document.getElementById("efCycleStart").value = emp.cycleStart || "";
  document.getElementById("efEntitlement").value= emp.entitlement || "";
  document.getElementById("efRosterStart").value= emp.rosterStart || "";
  document.getElementById("efPatternGroup").style.display = emp.dept === "DO" ? "flex" : "none";
  document.getElementById("efRosterGroup").style.display  = emp.dept === "DO" ? "flex" : "none";
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
  const email       = document.getElementById("efEmail").value.trim();
  const password    = document.getElementById("efPassword").value;
  const role        = document.getElementById("efRole").value;
  const dept        = document.getElementById("efDept").value;
  const pattern     = dept === "DO" ? document.getElementById("efPattern").value.trim().toUpperCase() : "";
  const joinDate    = document.getElementById("efJoinDate").value;
  const cycleStart  = document.getElementById("efCycleStart").value;
  const entitlement = parseInt(document.getElementById("efEntitlement").value);
  const groupId     = document.getElementById("efGroup").value || null;
  const rosterStart = dept === "DO" ? (document.getElementById("efRosterStart").value || cycleStart) : null;

  if (!name || !email || !joinDate || !cycleStart || !entitlement) {
    errEl.textContent = "Please fill all required fields."; return;
  }
  if (dept === "DO" && !pattern.match(/^\d+W\d+O$/i)) {
    errEl.textContent = "Invalid shift pattern. Use format like 6W4O."; return;
  }
  if (!editingEmpId && !password) {
    errEl.textContent = "Password is required for new employees."; return;
  }

  const cycleEndDate = cycleEnd(cycleStart);

  try {
    if (!editingEmpId) {
      // CREATE new employee
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const uid  = cred.user.uid;
      const batch = writeBatch(db);

      batch.set(doc(db, "users", uid), { name, email, role, dept, createdAt: serverTimestamp() });
      batch.set(doc(db, "employees", uid), {
        name, email, dept, pattern, joinDate, cycleStart,
        cycleEnd: cycleEndDate, rosterStart,
        entitlement, leaveUsed: 0, unpaidUsed: 0,
        groupId, role,
        cycleId: `${uid}_${cycleStart}`,
        createdAt: serverTimestamp()
      });

      await batch.commit();

      await addDoc(collection(db, "auditLog"), {
        action: "employee_added",
        label:  `Added employee ${name}`,
        detail: `${dept} · ${email}`,
        by:     MGR.name || MGR.uid,
        at:     serverTimestamp()
      });

      toast(`${name} added successfully!`);

    } else {
      // UPDATE existing employee
      const batch = writeBatch(db);
      const empData = {
        name, dept, pattern, joinDate, cycleStart,
        cycleEnd: cycleEndDate, rosterStart,
        entitlement, groupId, role
      };
      batch.update(doc(db, "employees", editingEmpId), empData);
      batch.update(doc(db, "users", editingEmpId), { name, role, dept });
      await batch.commit();

      await addDoc(collection(db, "auditLog"), {
        action: "employee_edited",
        label:  `Edited employee ${name}`,
        detail: `${dept} · ${email}`,
        by:     MGR.name || MGR.uid,
        at:     serverTimestamp()
      });

      toast(`${name} updated successfully!`);
    }

    document.getElementById("empModal").style.display = "none";
    editingEmpId = null;
  } catch (err) {
    if (err.code === "auth/email-already-in-use") {
      errEl.textContent = "Email already registered.";
    } else {
      errEl.textContent = "Error: " + err.message;
    }
    console.error(err);
  }
});

// ── Remove employee ──────────────────────────────────────────────
window.removeEmployee = (empId) => {
  const emp = employees.find(e => e.id === empId);
  if (!emp) return;
  openPin(`Permanently remove ${emp.name} and all their data?`, async () => {
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, "employees", empId));
      batch.delete(doc(db, "users",     empId));
      batch.set(doc(collection(db, "auditLog")), {
        action: "employee_removed",
        label:  `Removed employee ${emp.name}`,
        detail: emp.email || "",
        by:     MGR.name || MGR.uid,
        at:     serverTimestamp()
      });
      await batch.commit();
      toast(`${emp.name} removed.`);
    } catch (err) { toast("Failed to remove.", "error"); console.error(err); }
  });
};

// ── Renew cycle modal ────────────────────────────────────────────
window.openRenewModal = (empId) => {
  const emp = employees.find(e => e.id === empId);
  if (!emp) return;
  document.getElementById("renewEmpId").value = empId;
  document.getElementById("renewInfo").textContent =
    `Renewing: ${emp.name} (${emp.dept}) — Current cycle: ${fmtDate(emp.cycleStart)} – ${fmtDate(emp.cycleEnd)}`;
  const nextStart = emp.cycleEnd
    ? new Date(new Date(emp.cycleEnd+"T00:00:00").getTime()+86400000).toISOString().split("T")[0]
    : todayStr();
  document.getElementById("rfCycleStart").value   = nextStart;
  document.getElementById("rfEntitlement").value  = emp.entitlement || 0;
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
  const empId       = document.getElementById("renewEmpId").value;
  const newStart    = document.getElementById("rfCycleStart").value;
  const newEnt      = parseInt(document.getElementById("rfEntitlement").value);
  const errEl       = document.getElementById("renewFormError");
  errEl.textContent = "";
  if (!newStart || !newEnt) { errEl.textContent = "Fill all fields."; return; }

  const emp = employees.find(e => e.id === empId);
  if (!emp) return;

  try {
    // Archive old cycle
    await addDoc(collection(db, "cycleHistory"), {
      employeeId:  empId,
      employeeName:emp.name,
      dept:        emp.dept,
      cycleStart:  emp.cycleStart,
      cycleEnd:    emp.cycleEnd,
      entitlement: emp.entitlement,
      leaveUsed:   emp.leaveUsed || 0,
      unpaidUsed:  emp.unpaidUsed || 0,
      archivedAt:  serverTimestamp()
    });

    const newEnd = cycleEnd(newStart);
    await updateDoc(doc(db, "employees", empId), {
      cycleStart:  newStart,
      cycleEnd:    newEnd,
      entitlement: newEnt,
      leaveUsed:   0,
      unpaidUsed:  0,
      cycleId:     `${empId}_${newStart}`
    });

    await addDoc(collection(db, "auditLog"), {
      action: "cycle_renewed",
      label:  `Renewed cycle for ${emp.name}`,
      detail: `New cycle: ${fmtDate(newStart)} – ${fmtDate(newEnd)} · ${newEnt} days`,
      by:     MGR.name || MGR.uid,
      at:     serverTimestamp()
    });

    toast(`Cycle renewed for ${emp.name}!`);
    document.getElementById("renewModal").style.display = "none";
  } catch (err) {
    errEl.textContent = "Failed: " + err.message;
    console.error(err);
  }
});

// ── Groups ───────────────────────────────────────────────────────
function populateGroupFilters() {
  const sel = document.getElementById("groupFilter");
  sel.innerHTML = `<option value="all">All Groups</option>` +
    groups.map(g => `<option value="${g.id}">${g.name}</option>`).join("");
}

function renderGroups() {
  const el = document.getElementById("groupsGrid");
  if (!groups.length) {
    el.innerHTML = `<div class="list-empty">No groups yet. Create one to assign staff.</div>`;
    return;
  }
  el.innerHTML = groups.map(g => {
    const members = employees.filter(e => e.groupId === g.id);
    return `
      <div class="group-card">
        <div class="group-card-head">
          <span class="group-card-name">${g.name}</span>
          <div style="display:flex;gap:6px">
            <button class="btn btn-xs btn-ghost" onclick="removeGroup('${g.id}')">Remove</button>
          </div>
        </div>
        <div class="group-card-body">
          ${g.description ? `<div style="font-size:12px;color:var(--gray-400);margin-bottom:4px">${g.description}</div>` : ""}
          ${members.length ? members.map(m => `
            <div class="group-member">
              <div class="group-avatar">${initials(m.name)}</div>
              <div>
                <div>${m.name}</div>
                <div style="font-size:11px;color:var(--gray-400)">${m.dept}</div>
              </div>
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
  document.getElementById(id).addEventListener("click", () => {
    document.getElementById("groupModal").style.display = "none";
  });
});

document.getElementById("groupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("gfName").value.trim();
  const desc = document.getElementById("gfDesc").value.trim();
  if (!name) { document.getElementById("groupFormError").textContent = "Name required."; return; }
  try {
    await addDoc(collection(db, "groups"), { name, description: desc, createdAt: serverTimestamp() });
    toast(`Group "${name}" created!`);
    document.getElementById("groupModal").style.display = "none";
  } catch (err) {
    document.getElementById("groupFormError").textContent = "Failed: " + err.message;
  }
});

window.removeGroup = async (groupId) => {
  if (!confirm("Remove this group? Members won't be deleted.")) return;
  try {
    await deleteDoc(doc(db, "groups", groupId));
    toast("Group removed.");
  } catch { toast("Failed to remove group.", "error"); }
};

// ── Audit log ────────────────────────────────────────────────────
function renderAuditLog(items) {
  const filter = document.getElementById("auditFilter").value;
  const el     = document.getElementById("auditList");
  let list = items;
  if (filter !== "all") list = items.filter(i => i.action === filter);

  const icons = {
    approved:         "✅",
    rejected:         "❌",
    employee_added:   "👤",
    employee_removed: "🗑",
    employee_edited:  "✏️",
    cycle_renewed:    "🔄"
  };

  if (!list.length) {
    el.innerHTML = `<div class="list-empty">No audit entries.</div>`;
    return;
  }
  el.innerHTML = list.map(a => `
    <div class="audit-item">
      <div class="audit-icon">${icons[a.action]||"📋"}</div>
      <div class="audit-content">
        <div class="audit-action">${a.label}</div>
        <div class="audit-meta">${a.detail||""} · by ${a.by} · ${fmtDateTime(a.at)}</div>
      </div>
    </div>`).join("");
}

document.getElementById("auditFilter").addEventListener("change", () => {
  // Re-render with current data — listener will fire naturally
});

// ── PIN confirmation modal ───────────────────────────────────────
let pinCallback = null;

function openPin(message, callback) {
  pinCallback = callback;
  document.getElementById("pinMessage").textContent = message;
  document.getElementById("pinInput").value  = "";
  document.getElementById("pinError").textContent = "";
  document.getElementById("pinModal").style.display = "flex";
  document.getElementById("pinInput").focus();
}

document.getElementById("pinModalClose").addEventListener("click", closePinModal);
document.getElementById("pinCancel").addEventListener("click",    closePinModal);
function closePinModal() {
  document.getElementById("pinModal").style.display = "none";
  pinCallback = null;
}

document.getElementById("pinConfirm").addEventListener("click", async () => {
  const pw    = document.getElementById("pinInput").value;
  const errEl = document.getElementById("pinError");
  if (!pw) { errEl.textContent = "Enter your password."; return; }

  try {
    const credential = EmailAuthProvider.credential(auth.currentUser.email, pw);
    await reauthenticateWithCredential(auth.currentUser, credential);
    closePinModal();
    if (pinCallback) pinCallback();
  } catch {
    errEl.textContent = "Incorrect password.";
  }
});
