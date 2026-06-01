// manager.js - Manager portal logic
import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged, signOut, createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc,
  onSnapshot, query, where, addDoc, serverTimestamp,
  orderBy, writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  formatDate, calcWorkingDays, showToast,
  statusBadge, deptBadge, progressBar, detectClash
} from "./utils.js";

let currentManager = null;
let allEmployees = [];
let allRequests = [];
let renewTarget = null;

// Auth guard
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "../index.html"; return; }

  const userSnap = await getDoc(doc(db, "users", user.uid));
  if (!userSnap.exists() || userSnap.data().role !== "manager") {
    window.location.href = "staff.html"; return;
  }

  currentManager = { uid: user.uid, ...userSnap.data() };
  document.getElementById("navUserName").textContent = currentManager.name || user.email;

  loadDashboard();
  loadApprovals();
  loadEmployees();
});

// Logout
document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "../index.html";
});

// Tab switching
document.querySelectorAll(".nav-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".nav-tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
  });
});

// Dept filter
document.getElementById("deptFilter").addEventListener("change", () => renderDashboardTable());

// ============================================================
// DASHBOARD
// ============================================================

function loadDashboard() {
  onSnapshot(collection(db, "employees"), (snap) => {
    allEmployees = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateSummaryCards();
    renderDashboardTable();
  });

  onSnapshot(collection(db, "leaveRequests"), (snap) => {
    allRequests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateSummaryCards();
  });
}

function updateSummaryCards() {
  document.getElementById("totalStaff").textContent = allEmployees.length;

  const today = new Date().toISOString().split("T")[0];
  const onLeave = allRequests.filter(r =>
    r.status === "Approved" &&
    r.startDate <= today && r.endDate >= today
  ).length;
  document.getElementById("onLeaveToday").textContent = onLeave;

  const pending = allRequests.filter(r => r.status === "Pending").length;
  document.getElementById("pendingCount").textContent = pending;
  document.getElementById("pendingBadge").textContent = pending;

  const clashes = allRequests.filter(r => r.hasClash && r.status === "Pending").length;
  document.getElementById("clashCount").textContent = clashes;
}

function renderDashboardTable() {
  const dept = document.getElementById("deptFilter").value;
  const tbody = document.getElementById("dashboardTableBody");

  let emps = allEmployees;
  if (dept !== "all") emps = emps.filter(e => e.dept === dept);
  emps = emps.sort((a, b) => a.name.localeCompare(b.name));

  if (emps.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-row">No employees found.</td></tr>`;
    return;
  }

  tbody.innerHTML = emps.map(emp => {
    const used = emp.leaveUsed || 0;
    const ent = emp.entitlement || 0;
    const rem = ent - used;
    const cycleStr = emp.cycleStart && emp.cycleEnd
      ? formatDate(emp.cycleStart) + " – " + formatDate(emp.cycleEnd)
      : "--";

    return `
      <tr>
        <td><strong>${emp.name}</strong></td>
        <td>${deptBadge(emp.dept)}</td>
        <td>${ent} days</td>
        <td>${used} days</td>
        <td>${rem} days</td>
        <td>${progressBar(used, ent)}</td>
        <td style="font-size:11px;color:var(--gray-500)">${cycleStr}</td>
      </tr>
    `;
  }).join("");
}

// ============================================================
// APPROVALS
// ============================================================

function loadApprovals() {
  onSnapshot(collection(db, "leaveRequests"), (snap) => {
    allRequests = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const sorted = [...allRequests].sort((a, b) => {
      // Pending first, then by date
      if (a.status === "Pending" && b.status !== "Pending") return -1;
      if (b.status === "Pending" && a.status !== "Pending") return 1;
      return (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0);
    });

    const tbody = document.getElementById("approvalsTableBody");

    if (sorted.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty-row">No leave requests yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = sorted.map(r => {
      const clashHtml = r.hasClash
        ? `<span class="clash-badge">⚠️ ${r.clashingWith?.length || 0} clash</span>`
        : `<span class="no-clash">None</span>`;

      const actionHtml = r.status === "Pending"
        ? `<div class="action-btns">
            <button class="btn btn-success" onclick="approveRequest('${r.id}')">Approve</button>
            <button class="btn btn-danger" onclick="rejectRequest('${r.id}')">Reject</button>
           </div>`
        : `<span style="color:var(--gray-400);font-size:12px">${r.status}</span>`;

      return `
        <tr>
          <td><strong>${r.employeeName}</strong></td>
          <td>${deptBadge(r.employeeDept)}</td>
          <td>${formatDate(r.startDate)}</td>
          <td>${formatDate(r.endDate)}</td>
          <td>${r.days || "--"}</td>
          <td>${r.leaveType || "Annual"}</td>
          <td>${clashHtml}</td>
          <td>${statusBadge(r.status)}</td>
          <td>${actionHtml}</td>
        </tr>
      `;
    }).join("");
  });
}

// Approve request
window.approveRequest = async (requestId) => {
  try {
    const reqSnap = await getDoc(doc(db, "leaveRequests", requestId));
    if (!reqSnap.exists()) return;
    const req = reqSnap.data();

    const batch = writeBatch(db);

    // Update request status
    batch.update(doc(db, "leaveRequests", requestId), { status: "Approved" });

    // Update employee leave balance if Annual
    if (req.leaveType === "Annual") {
      const empRef = doc(db, "employees", req.employeeId);
      const empSnap = await getDoc(empRef);
      if (empSnap.exists()) {
        const currentUsed = empSnap.data().leaveUsed || 0;
        batch.update(empRef, { leaveUsed: currentUsed + (req.days || 0) });
      }
    }

    await batch.commit();
    showToast(`Approved ${req.days} days for ${req.employeeName}`);

    // Send email notification (via Firestore trigger if set up)
    await addDoc(collection(db, "emailQueue"), {
      to: req.employeeEmail || "",
      subject: "Leave Request Approved",
      body: `Hi ${req.employeeName},\n\nYour leave request from ${formatDate(req.startDate)} to ${formatDate(req.endDate)} (${req.days} days) has been APPROVED.\n\nLeave Type: ${req.leaveType}\n\nRegards,\nLeave Manager`,
      sentAt: serverTimestamp()
    });

  } catch (err) {
    showToast("Failed to approve request.", "error");
    console.error(err);
  }
};

// Reject request
window.rejectRequest = async (requestId) => {
  if (!confirm("Are you sure you want to reject this request?")) return;

  try {
    const reqSnap = await getDoc(doc(db, "leaveRequests", requestId));
    if (!reqSnap.exists()) return;
    const req = reqSnap.data();

    await updateDoc(doc(db, "leaveRequests", requestId), { status: "Rejected" });
    showToast(`Rejected request for ${req.employeeName}`);

    // Send email notification
    await addDoc(collection(db, "emailQueue"), {
      to: req.employeeEmail || "",
      subject: "Leave Request Rejected",
      body: `Hi ${req.employeeName},\n\nYour leave request from ${formatDate(req.startDate)} to ${formatDate(req.endDate)} has been REJECTED.\n\nPlease contact your manager for more information.\n\nRegards,\nLeave Manager`,
      sentAt: serverTimestamp()
    });

  } catch (err) {
    showToast("Failed to reject request.", "error");
    console.error(err);
  }
};

// ============================================================
// EMPLOYEES
// ============================================================

function loadEmployees() {
  onSnapshot(collection(db, "employees"), (snap) => {
    allEmployees = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderEmployeesTable();
  });
}

function renderEmployeesTable() {
  const tbody = document.getElementById("employeesTableBody");
  const emps = [...allEmployees].sort((a, b) => a.name.localeCompare(b.name));

  if (emps.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-row">No employees yet. Add your first employee.</td></tr>`;
    return;
  }

  tbody.innerHTML = emps.map(emp => `
    <tr>
      <td><strong>${emp.name}</strong></td>
      <td>${emp.email || "--"}</td>
      <td>${deptBadge(emp.dept)}</td>
      <td>${emp.dept === "DO" ? (emp.pattern || "--") : "Mon–Thu"}</td>
      <td>${emp.entitlement || 0} days</td>
      <td>${formatDate(emp.cycleStart)}</td>
      <td>
        <div class="action-btns">
          <button class="btn btn-warning" onclick="openRenewModal('${emp.id}')">Renew</button>
          <button class="btn btn-outline-dark btn-sm" onclick="editEmployee('${emp.id}')">Edit</button>
          <button class="btn btn-danger" onclick="removeEmployee('${emp.id}')">Remove</button>
        </div>
      </td>
    </tr>
  `).join("");
}

// ============================================================
// ADD EMPLOYEE MODAL
// ============================================================

document.getElementById("addEmployeeBtn").addEventListener("click", () => {
  document.getElementById("modalTitle").textContent = "Add New Employee";
  document.getElementById("addEmployeeForm").reset();
  document.getElementById("addEmpError").textContent = "";
  document.getElementById("addEmployeeModal").classList.add("active");
});

document.getElementById("closeModal").addEventListener("click", closeAddModal);
document.getElementById("cancelModal").addEventListener("click", closeAddModal);
document.getElementById("addEmployeeModal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeAddModal();
});

function closeAddModal() {
  document.getElementById("addEmployeeModal").classList.remove("active");
}

// Show/hide pattern field based on dept
document.getElementById("empDept").addEventListener("change", (e) => {
  document.getElementById("patternGroup").style.display =
    e.target.value === "DO" ? "block" : "none";
});

document.getElementById("addEmployeeForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("addEmpError");
  errorEl.textContent = "";

  const name = document.getElementById("empName").value.trim();
  const email = document.getElementById("empEmail").value.trim();
  const password = document.getElementById("empPassword").value;
  const dept = document.getElementById("empDept").value;
  const pattern = dept === "DO" ? document.getElementById("empPattern").value.trim().toUpperCase() : "";
  const joinDate = document.getElementById("empJoinDate").value;
  const cycleStart = document.getElementById("empCycleStart").value;
  const entitlement = parseInt(document.getElementById("empEntitlement").value);

  if (!name || !email || !password || !joinDate || !cycleStart || !entitlement) {
    errorEl.textContent = "Please fill in all required fields.";
    return;
  }

  if (dept === "DO" && (!pattern || !pattern.match(/\d+W\d+O/i))) {
    errorEl.textContent = "Invalid shift pattern. Use format like 6W4O.";
    return;
  }

  try {
    // Create Firebase Auth user
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const uid = cred.user.uid;

    // Calculate cycle end (1 year from cycle start)
    const cycleEnd = new Date(cycleStart);
    cycleEnd.setFullYear(cycleEnd.getFullYear() + 1);
    cycleEnd.setDate(cycleEnd.getDate() - 1);
    const cycleEndStr = cycleEnd.toISOString().split("T")[0];

    const batch = writeBatch(db);

    // User record (role)
    batch.set(doc(db, "users", uid), {
      name, email, role: "staff", dept, createdAt: serverTimestamp()
    });

    // Employee record
    batch.set(doc(db, "employees", uid), {
      name, email, dept, pattern, joinDate,
      cycleStart, cycleEnd: cycleEndStr,
      entitlement, leaveUsed: 0,
      rosterStart: dept === "DO" ? cycleStart : null,
      cycleId: `${uid}_${cycleStart}`,
      createdAt: serverTimestamp()
    });

    await batch.commit();

    showToast(`${name} added successfully!`);
    closeAddModal();

  } catch (err) {
    if (err.code === "auth/email-already-in-use") {
      errorEl.textContent = "This email is already registered.";
    } else {
      errorEl.textContent = "Failed to add employee: " + err.message;
    }
    console.error(err);
  }
});

// ============================================================
// RENEW MODAL
// ============================================================

window.openRenewModal = (empId) => {
  const emp = allEmployees.find(e => e.id === empId);
  if (!emp) return;
  renewTarget = emp;

  document.getElementById("renewEmpInfo").textContent =
    `Renewing cycle for: ${emp.name} (${emp.dept})`;
  document.getElementById("renewEntitlement").value = emp.entitlement || 0;

  // Suggest next cycle start
  const nextStart = emp.cycleEnd
    ? new Date(new Date(emp.cycleEnd).getTime() + 86400000).toISOString().split("T")[0]
    : new Date().toISOString().split("T")[0];
  document.getElementById("renewCycleStart").value = nextStart;

  document.getElementById("renewError").textContent = "";
  document.getElementById("renewModal").classList.add("active");
};

document.getElementById("closeRenewModal").addEventListener("click", closeRenewModal);
document.getElementById("cancelRenewModal").addEventListener("click", closeRenewModal);

function closeRenewModal() {
  document.getElementById("renewModal").classList.remove("active");
  renewTarget = null;
}

document.getElementById("renewForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!renewTarget) return;

  const errorEl = document.getElementById("renewError");
  errorEl.textContent = "";

  const newEntitlement = parseInt(document.getElementById("renewEntitlement").value);
  const newCycleStart = document.getElementById("renewCycleStart").value;

  if (!newEntitlement || !newCycleStart) {
    errorEl.textContent = "Please fill in all fields.";
    return;
  }

  try {
    const cycleEnd = new Date(newCycleStart);
    cycleEnd.setFullYear(cycleEnd.getFullYear() + 1);
    cycleEnd.setDate(cycleEnd.getDate() - 1);
    const cycleEndStr = cycleEnd.toISOString().split("T")[0];

    // Archive old cycle
    const oldCycle = {
      employeeId: renewTarget.id,
      employeeName: renewTarget.name,
      dept: renewTarget.dept,
      cycleStart: renewTarget.cycleStart,
      cycleEnd: renewTarget.cycleEnd,
      entitlement: renewTarget.entitlement,
      leaveUsed: renewTarget.leaveUsed || 0,
      archivedAt: serverTimestamp()
    };
    await addDoc(collection(db, "cycleHistory"), oldCycle);

    // Update employee with new cycle
    await updateDoc(doc(db, "employees", renewTarget.id), {
      cycleStart: newCycleStart,
      cycleEnd: cycleEndStr,
      entitlement: newEntitlement,
      leaveUsed: 0,
      cycleId: `${renewTarget.id}_${newCycleStart}`
    });

    showToast(`Cycle renewed for ${renewTarget.name}!`);
    closeRenewModal();

  } catch (err) {
    errorEl.textContent = "Failed to renew cycle: " + err.message;
    console.error(err);
  }
});

// Remove employee
window.removeEmployee = async (empId) => {
  const emp = allEmployees.find(e => e.id === empId);
  if (!emp) return;
  if (!confirm(`Permanently remove ${emp.name} and all their data?`)) return;

  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, "employees", empId));
    batch.delete(doc(db, "users", empId));
    await batch.commit();
    showToast(`${emp.name} removed.`);
  } catch (err) {
    showToast("Failed to remove employee.", "error");
    console.error(err);
  }
};

// Edit employee (basic - opens modal prefilled)
window.editEmployee = async (empId) => {
  const emp = allEmployees.find(e => e.id === empId);
  if (!emp) return;

  document.getElementById("modalTitle").textContent = "Edit Employee";
  document.getElementById("empName").value = emp.name || "";
  document.getElementById("empEmail").value = emp.email || "";
  document.getElementById("empPassword").value = "••••••••";
  document.getElementById("empDept").value = emp.dept || "DO";
  document.getElementById("empPattern").value = emp.pattern || "";
  document.getElementById("empJoinDate").value = emp.joinDate || "";
  document.getElementById("empCycleStart").value = emp.cycleStart || "";
  document.getElementById("empEntitlement").value = emp.entitlement || 0;

  document.getElementById("patternGroup").style.display =
    emp.dept === "DO" ? "block" : "none";

  document.getElementById("addEmployeeModal").classList.add("active");
};
