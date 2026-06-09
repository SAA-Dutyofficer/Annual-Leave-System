// js/auth.js
import { auth, db } from "./firebase.js";
import { signInWithEmailAndPassword, onAuthStateChanged,
         sendPasswordResetEmail }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Only redirect if already logged in and on login page
onAuthStateChanged(auth, async (user) => {
  if (!user) { clearCache(); return; }
  if (window.location.pathname.includes("/pages/")) return;

  // Always fetch fresh role — don't rely on cache for redirect
  try {
    const role = await getRole(user.uid);
    setCache(user.uid, role);
    redirect(role);
  } catch {
    // If Firestore fails, go to login
    clearCache();
  }
});

// Login
document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("loginError");
  const btn   = document.getElementById("loginBtn");
  const txtEl = btn.querySelector(".btn-text");
  const ldrEl = btn.querySelector(".btn-loader");
  errEl.textContent = "";
  txtEl.textContent = "Signing in…";
  ldrEl.style.display = "inline";
  btn.disabled = true;

  try {
    const email = document.getElementById("loginEmail").value.trim();
    const pass  = document.getElementById("loginPassword").value;
    const cred  = await signInWithEmailAndPassword(auth, email, pass);
    const role  = await getRole(cred.user.uid);
    setCache(cred.user.uid, role);
    redirect(role);
  } catch(err) {
    const code = err.code;
    errEl.textContent =
      code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found"
        ? "Incorrect email or password."
        : code === "auth/too-many-requests"
        ? "Too many attempts. Please try again later."
        : "Sign in failed. Please try again.";
    txtEl.textContent = "Sign In";
    ldrEl.style.display = "none";
    btn.disabled = false;
  }
});

// Toggle password
document.getElementById("togglePw").addEventListener("click", () => {
  const inp = document.getElementById("loginPassword");
  inp.type = inp.type === "password" ? "text" : "password";
});

// Forgot password
document.getElementById("forgotLink").addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("loginView").style.display  = "none";
  document.getElementById("resetView").style.display  = "block";
  const email = document.getElementById("loginEmail").value.trim();
  if (email) document.getElementById("resetEmail").value = email;
});

document.getElementById("backToLogin").addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("resetView").style.display  = "none";
  document.getElementById("loginView").style.display  = "block";
  document.getElementById("resetError").textContent   = "";
  document.getElementById("resetSuccess").textContent = "";
});

document.getElementById("resetForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email  = document.getElementById("resetEmail").value.trim();
  const errEl  = document.getElementById("resetError");
  const succEl = document.getElementById("resetSuccess");
  errEl.textContent = ""; succEl.textContent = "";
  try {
    await sendPasswordResetEmail(auth, email);
    succEl.textContent = "Reset link sent! Check your email inbox.";
  } catch(err) {
    errEl.textContent = err.code === "auth/user-not-found"
      ? "No account found with this email."
      : "Failed to send reset email. Please try again.";
  }
});

async function getRole(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? (snap.data().role || "staff") : "staff";
}

function redirect(role) {
  window.location.href = role === "manager" ? "pages/manager.html" : "pages/staff.html";
}

function setCache(uid, role) {
  try { localStorage.setItem("als_uid", uid); localStorage.setItem("als_role", role); } catch {}
}

function clearCache() {
  try { localStorage.clear(); } catch {}
}
