// changepass.js
// Client-side change-password helper
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  updatePassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { firebaseConfig } from "../firebase-config.js";

// initialize (safe to call even if already initialized elsewhere)
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Helper: Validate password (same rules as backend)
function validatePassword(password) {
  if (!password || password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long' };
  }
  
  if (!/[a-zA-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain letters (a-z, A-Z)' };
  }
  
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain numbers (0-9)' };
  }
  
  return { valid: true };
}

// Show error message below input
function showError(elementId, message) {
  const errorDiv = document.getElementById(elementId);
  if (errorDiv) {
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
  }
}

// Clear error message
function clearError(elementId) {
  const errorDiv = document.getElementById(elementId);
  if (errorDiv) {
    errorDiv.textContent = '';
    errorDiv.style.display = 'none';
  }
}

// Clear all error messages
function clearAllErrors() {
  clearError('new-pass-error');
  clearError('confirm-pass-error');
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("pass-form");
  const newPassEl = document.getElementById("new-pass");
  const confirmPassEl = document.getElementById("confirm-pass");
  const submitBtn = document.getElementById("confirm-btn");

  function setLoading(loading, text = "Confirm") {
    if (!submitBtn) return;
    submitBtn.disabled = !!loading;
    if (loading) {
      if (!submitBtn.dataset.orig) submitBtn.dataset.orig = submitBtn.textContent;
      submitBtn.textContent = text;
    } else {
      submitBtn.textContent = submitBtn.dataset.orig || text;
    }
  }

  async function clearForceFlagOnServer(uid) {
    // attempt to call server route authenticated with ID token
    if (!auth.currentUser) return;
    try {
      const idToken = await auth.currentUser.getIdToken(true); // force refresh for freshest token
      await fetch("/auth/clear-force-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + idToken
        },
        body: JSON.stringify({ uid })
      });
    } catch (e) {
      // non-fatal, but log
      console.warn("clearForceFlagOnServer failed (non-fatal):", e);
    }
  }

  form?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    
    // Clear previous errors
    clearAllErrors();
    
    if (!newPassEl || !confirmPassEl) {
      alert("Missing form fields.");
      return;
    }

    const newPass = newPassEl.value || "";
    const confirmPass = confirmPassEl.value || "";
    
    let hasError = false;

    // Validate new password
    if (!newPass) {
      showError('new-pass-error', 'New password is required');
      hasError = true;
    } else {
      const validation = validatePassword(newPass);
      if (!validation.valid) {
        showError('new-pass-error', validation.error);
        hasError = true;
      }
    }

    // Validate confirm password
    if (!confirmPass) {
      showError('confirm-pass-error', 'Please confirm your new password');
      hasError = true;
    } else if (newPass !== confirmPass) {
      showError('confirm-pass-error', 'Passwords do not match');
      hasError = true;
    }

    // If there are validation errors, stop here
    if (hasError) {
      return;
    }

    setLoading(true, "Updating password…");

    try {
      const user = auth.currentUser;
      if (!user) {
        alert("No authenticated user found. Please sign in again.");
        setLoading(false);
        return;
      }

      // attempt to update password
      try {
        await updatePassword(user, newPass); // modular function: updatePassword(user, newPassword)
      } catch (updErr) {
        console.error("updatePassword error:", updErr);
        // common case: requires recent login
        if (updErr && updErr.code === "auth/requires-recent-login") {
          alert("For security, please sign in again and then change your password.");
          // optionally redirect to login page
          try { await signOut(auth); } catch(_) {}
          window.location.href = "/login"; // send them back to login so they reauthenticate
          return;
        }
        // other firebase auth errors
        const msg = (updErr && (updErr.message || updErr.code)) ? (updErr.message || updErr.code) : "Failed to change password.";
        alert("Failed to change password. " + msg);
        setLoading(false);
        return;
      }

      // If password updated successfully, clear forcePasswordChange on server
      try {
        await clearForceFlagOnServer(user.uid);
      } catch (e) {
        console.warn("clearForceFlagOnServer threw:", e);
      }

      // Sign the user out and send them to login page
      try {
        await signOut(auth);
      } catch (signErr) {
        console.warn("Sign out after password change failed:", signErr);
      }

      alert("Password changed successfully. Please sign in with your new password.");
      window.location.href ="../login/login.html";

    } catch (err) {
      console.error("changepass error", err);
      alert("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  });
});
