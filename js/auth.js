// auth.js - Handles login and routing
import { auth, db } from "./firebase.js";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// If already logged in, redirect
onAuthStateChanged(auth, async (user) => {
  if (user) {
    const role = await getUserRole(user.uid);
    if (role === "manager") {
      window.location.href = "pages/manager.html";
    } else {
      window.location.href = "pages/staff.html";
    }
  }
});

// Login form
document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errorEl = document.getElementById("loginError");
  errorEl.textContent = "";

  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const role = await getUserRole(cred.user.uid);
    if (role === "manager") {
      window.location.href = "pages/manager.html";
    } else {
      window.location.href = "pages/staff.html";
    }
  } catch (err) {
    errorEl.textContent = "Invalid email or password. Please try again.";
  }
});

async function getUserRole(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) return snap.data().role || "staff";
  } catch {}
  return "staff";
}
