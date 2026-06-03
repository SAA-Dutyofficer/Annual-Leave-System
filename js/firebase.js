// js/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDRFzz7OPlRyjJekZh6rbMNz6teQJ6yd_M",
  authDomain: "annual-leave-system-83d7a.firebaseapp.com",
  projectId: "annual-leave-system-83d7a",
  storageBucket: "annual-leave-system-83d7a.firebasestorage.app",
  messagingSenderId: "1047300958404",
  appId: "1:1047300958404:web:61dc1bb5ab1d985f764191"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Enable offline persistence
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === 'failed-precondition') {
    console.warn('Offline persistence unavailable: multiple tabs open');
  } else if (err.code === 'unimplemented') {
    console.warn('Offline persistence not supported in this browser');
  }
});

// Online/offline indicator
window.addEventListener('online', () => {
  document.querySelectorAll('.offline-dot,.offline-indicator').forEach(el => el.style.display = 'none');
});
window.addEventListener('offline', () => {
  document.querySelectorAll('.offline-dot').forEach(el => el.style.display = 'inline');
  document.querySelectorAll('.offline-indicator').forEach(el => el.style.display = 'block');
});
