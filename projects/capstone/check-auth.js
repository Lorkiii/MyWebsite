import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { auth } from "../firebase-config.js";

function redirectToLogin() {
  location.replace("/login/login.html");
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    redirectToLogin();
  } else {
    // user present; pages should call auth.currentUser.getIdToken() when needed
    console.log('[check-auth] signed-in:', user.uid);
  }
});
