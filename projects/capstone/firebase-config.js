import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";


export const firebaseConfig = {
  apiKey: "AIzaSyArIBaTObDw-hOi9ho_Wa6c-HsG5uwr1_U",
  authDomain: "hfa-database.firebaseapp.com",
  projectId: "hfa-database",
  storageBucket: "hfa-database.firebasestorage.app",
  messagingSenderId: "823516887560",
  appId: "1:823516887560:web:a15129a94938c6cec56fbd",
  measurementId: "G-05LPWX1F1K"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db };
