// staff.js - Staff portal logic
import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  doc, getDoc, collection, query, where,
  onSnapshot, addDoc, serverTimestamp, getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  formatDate, calcWorkingDays, isGDWorkingDay,
  isDOWorkingDay, showToast, statusBadge, detectClash
} from "./utils.js";

let currentUser = null;
let currentEmployee = null;

// Auth guard
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "../index.html"; return; }
  currentUser = user;

  // Get user profile
  const userSnap = await getDoc(doc(db, "users", user.uid));
  if (!userSnap.exists()) { window.location.href = "../index.html"; return; }
  const userData = userSnap.data();

  // Managers shouldn't be here
  if (userData.role === "manager") {
    window.location.href = "manager.html"; return;
  }

  document.getElementById("navUserName").textContent = userData.name || user.email;

  // Get employee data
  const empSnap = await getDoc(doc(db, "employees", user.uid));
  if (empSnap.exists()) {
    currentEmployee = { id: empSnap.id, ...empSnap.data() };
    renderBalanceCards();
    loadMyRequests();
  }
});

// Logout
document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "../index.html";
});

// Render balance cards
function renderBalanceCards() {
  const emp = currentEmployee;
  const used = emp.leaveUsed || 0;
  const entitlement = emp.entitlement || 0;
  const remaining = entitlement - used;

  document.getElementById("statEntitlement").textContent = entitlement;
  document.getElementById("statUsed").textContent = used;
  document.getElementById("statRemaining").textContent = remaining;
  document.getElementById("statDept").textContent = emp.dept === "DO" ? "DO Shift Worker" : "GD Ground Duties";

  if (emp.cycleStart && emp.cycleEnd) {
    document.getElementById("statCycle").textContent =
      formatDate(emp.cycleStart) + " – " + formatDate(emp.cycleEnd);
  }
}

// Load my requests in real time
function loadMyRequests() {
  const tbody = document.getElementById("myRequestsBody");
  const q = query(
    collection(db, "leaveRequests"),
    where("employeeId", "==", currentUser.uid)
  );

  onSnapshot(q, (snap) => {
    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-row">No leave requests yet.</td></tr>`;
      return;
    }

    // Sort by submitted date desc
    const requests = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0));

    tbody.innerHTML = requests.map(r => `
      <tr>
        <td>${formatDate(r.startDate)}</td>
        <td>${formatDate(r.endDate)}</td>
        <td>${r.days || "--"}</td>
        <td>${r.leaveType || "Annual"}</td>
        <td>${statusBadge(r.status)}</td>
        <td>${r.notes || "--"}</td>
      </tr>
    `).join("");
  });
}

// Leave request form
document.getElementById("leaveRequestForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("requestError");
  const infoEl = document.getElementById("requestInfo");
  errorEl.textContent = "";
  infoEl.textContent = "";

  const leaveType = document.getElementById("leaveType").value;
  const startDate = document.getElementById("leaveStart").value;
  const endDate = document.getElementById("leaveEnd").value;
  const notes = document.getElementById("leaveNotes").value.trim();

  if (!startDate || !endDate) {
    errorEl.textContent = "Please select start and end dates.";
    return;
  }

  if (endDate < startDate) {
    errorEl.textContent = "End date cannot be before start date.";
    return;
  }

  // Validate working days
  const emp = currentEmployee;
  if (emp.dept === "GD") {
    if (!isGDWorkingDay(startDate)) {
      errorEl.textContent = "Start date must be a working day (Mon–Thu).";
      return;
    }
    if (!isGDWorkingDay(endDate)) {
      errorEl.textContent = "End date must be a working day (Mon–Thu).";
      return;
    }
  } else {
    if (!isDOWorkingDay(startDate, emp.pattern, emp.rosterStart)) {
      errorEl.textContent = "Start date is not a working day for your shift pattern.";
      return;
    }
  }

  // Calculate days
  const days = calcWorkingDays(startDate, endDate, emp.dept, emp.pattern, emp.rosterStart);
  if (days === 0) {
    errorEl.textContent = "No working days in selected range.";
    return;
  }

  // Check annual leave balance
  if (leaveType === "Annual") {
    const remaining = (emp.entitlement || 0) - (emp.leaveUsed || 0);
    if (days > remaining) {
      errorEl.textContent = `Insufficient balance. You have ${remaining} days remaining but requested ${days} days.`;
      return;
    }
  }

  // Clash check - get all approved/pending requests
  const allReqSnap = await getDocs(collection(db, "leaveRequests"));
  const allRequests = allReqSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const clashing = detectClash(startDate, endDate, allRequests);
  const hasClash = clashing.length >= 2;

  try {
    await addDoc(collection(db, "leaveRequests"), {
      employeeId: currentUser.uid,
      employeeName: emp.name,
      employeeDept: emp.dept,
      leaveType,
      startDate,
      endDate,
      days,
      notes,
      status: "Pending",
      hasClash,
      clashingWith: clashing,
      submittedAt: serverTimestamp(),
      cycleId: emp.cycleId || null
    });

    showToast("Leave request submitted successfully!");
    infoEl.textContent = `Request submitted: ${days} working day(s). Your manager will review it.`;
    document.getElementById("leaveRequestForm").reset();
  } catch (err) {
    errorEl.textContent = "Failed to submit request. Please try again.";
    console.error(err);
  }
});
