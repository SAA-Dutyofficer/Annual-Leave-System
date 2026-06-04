// js/email.js — EmailJS integration
const EMAILJS_SERVICE_ID  = "service_texz1xi";
const EMAILJS_TEMPLATE_ID = "template_hw6nsqa";
const EMAILJS_PUBLIC_KEY  = "gOtQEpuKt1GJE1U5a";

// Manager emails — notified on new/edited requests and self-renewals
const MANAGER_EMAILS = [
  "Aman.hamza@sharjahairport.ae",
  "Jeremy.Mitchell@sharjahairport.ae",
  "Godfrey.Monteiro@sharjahairport.ae",
  "salim.alabdulsalam@sharjahairport.ae"
];

// Load EmailJS SDK once
function loadEmailJS() {
  return new Promise((resolve) => {
    if (window.emailjs) { resolve(); return; }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";
    script.onload = () => {
      window.emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
      resolve();
    };
    document.head.appendChild(script);
  });
}

// Send single email
export async function sendEmail(to_email, subject, message) {
  if (!to_email) return;
  try {
    await loadEmailJS();
    await window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      to_email,
      subject,
      message
    });
  } catch(err) {
    console.warn("Email failed:", err);
  }
}

// Notify all managers
export async function notifyManagers(subject, message) {
  for (const email of MANAGER_EMAILS) {
    await sendEmail(email, subject, message);
  }
}
