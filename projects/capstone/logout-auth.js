// capstone/logout-auth.js
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

export async function logoutAndRedirect(loginPath = "/login/login.html") {
  try {
    const auth = getAuth();
    let tokenToRevoke = null;

    // prefer Firebase client ID token if signed in
    try {
      if (auth && auth.currentUser) {
        tokenToRevoke = await auth.currentUser.getIdToken().catch(() => null);
      }
    } catch (e) {
      // ignore, fallback to localStorage/sessionStorage token (legacy)
    }
    // fallback: if legacy server JWT exists in sessionStorage/localStorage, use it
    try {
      if (!tokenToRevoke && typeof sessionStorage !== "undefined") {
        tokenToRevoke = sessionStorage.getItem("serverToken") || null;
      }
    } catch (e) {
      // ignore storage issues
    }
    try {
      if (!tokenToRevoke && typeof localStorage !== "undefined") {
        tokenToRevoke = localStorage.getItem("token") || null;
      }
    } catch (e) {}

    // Remove any existing legacy tokens from storage (we are moving away from them)
    try { sessionStorage.removeItem("serverToken"); } catch (e) {}
    try { localStorage.removeItem("token"); } catch (e) {}
    try { sessionStorage.removeItem("idToken"); } catch (e) {}
    try { sessionStorage.removeItem("verifyEmail"); } catch (e) {}

    // Attempt to hit server logout endpoint (best-effort)
    try {
      // Send credentials so server can read and clear cookie __session
      await fetch("/auth/logout", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          // If we have a token, include it in body for servers that expect it (server also reads cookie)
        },
        body: JSON.stringify({ token: tokenToRevoke })
      });
    } catch (err) {
      console.warn("Logout: revoke request failed (continuing)", err);
    }

    // Sign out Firebase client so auth.currentUser becomes null (best-effort)
    try {
      if (auth) await signOut(auth);
    } catch (e) {
      console.warn("Firebase signOut failed (continuing):", e);
    }

    // Finally redirect to login (replace history so Back won't return to protected page)
    try {
      window.location.replace(loginPath);
    } catch (e) {
      window.location.href = loginPath;
    }
  } catch (err) {
    console.error("logout error", err);
    try { window.location.replace(loginPath); } catch (e) { window.location.href = loginPath; }
  }
}
