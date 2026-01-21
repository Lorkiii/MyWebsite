// server.mjs
// --- MODULE IMPORTS ---
import dotenv from "dotenv";
dotenv.config();
import express from "express";
import admin from "firebase-admin";
import { Resend } from 'resend';
import bodyParser from "body-parser";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import jwt from "jsonwebtoken";
import cors from "cors";
import cookieParser from "cookie-parser";
import cron from "node-cron";

import createDbClient from "./dbClient.js";
import createAttachApplicantId from "./attachApplicantId.js";

//importing the routes
import createEnrolleesRouter from "./routes/enrollees.js";
import createAdminMessagesRouter from "./routes/admin-messages.js";
import createApplicantMessagesRouter from './routes/applicant-messages.js';
import createApplicantsRouter from "./routes/applicants.js";
import interviewsRouter from "./routes/interview.js";
import createAdminActionsRouter from "./routes/admin-actions.js";
import createAdminUsersRouter from "./routes/admin-users.js";
import createActivityLogsRouter from "./routes/activity-logs.js";
import createDashboardStatsRouter from "./routes/dashboard-stats.js";
import { validateAndFormatPhone } from "./utils/phoneValidator.js";
import createNotesRouter from "./routes/notes.js";
import createTeacherProfileRouter from "./routes/teacher-profile.js";
import createAdminProfileRouter from "./routes/admin-profile.js";
import createEnrollmentRouter from "./routes/enrollment.js";
import createAnnouncementsRouter from "./routes/announcements.js";
import createTeacherMessagesRouter from "./routes/teacher-messages.js";
import createTeacherNotificationsRouter from "./routes/teacher-notifications.js";
import createTeacherDecisionRouter from "./routes/teacher-decision.js";
import createDemoScheduleRouter from "./routes/demo-schedule.js";
import createAdminMailRouter from "./routes/admin-mail.js";

import { deleteExpiredAccounts } from "./utils/teacherDecision.js";

// --- FILE PATH HELPERS ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- IN-MEMORY STORE---
const otpStore = new Map(); // uid -> { otp, expiresAt, email, lastSentAt, resendCount, firstResendAt }
// revoked tokens store (in-memory)
// token string -> expiryTimestamp
const revokedTokens = new Map();

// revoke token helper: store token with its expiry (decoded.exp)
function revokeToken(token) {
  try {
    const decoded = jwt.decode(token);
    if (!decoded || !decoded.exp) {
      
      const fallbackExpiry = Date.now() + 60 * 60 * 1000;
      revokedTokens.set(token, fallbackExpiry);
      setTimeout(() => revokedTokens.delete(token), 60 * 60 * 1000);
      return;
    }
    const expMs = decoded.exp * 1000;
    const ttl = Math.max(expMs - Date.now(), 0);
    revokedTokens.set(token, expMs);
    if (ttl > 0) setTimeout(() => revokedTokens.delete(token), ttl);
  } catch (err) {
    const fallbackExpiry = Date.now() + 60 * 60 * 1000;
    revokedTokens.set(token, fallbackExpiry);
    setTimeout(() => revokedTokens.delete(token), 60 * 60 * 1000);
  }
}

// --- LOAD FIREBASE SERVICE ACCOUNT (server-side only) ---
// Support both file-based (local) and base64-encoded (Render/cloud) credentials
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
  // For Render/cloud deployment: decode from base64 environment variable
  const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8');
  serviceAccount = JSON.parse(decoded);
  console.log('✅ Firebase credentials loaded from environment variable (base64)');
} else {
  // For local development: read from file
  serviceAccount = JSON.parse(
    fs.readFileSync(new URL('./serviceAccountKey.json', import.meta.url), 'utf8')
  );
  console.log('✅ Firebase credentials loaded from serviceAccountKey.json file');
}

// --- EXPRESS APP SETUP ---
const app = express();

// Enable CORS for development origins — update as necessary for production
app.use(
  cors({
    
    origin: ["http://127.0.0.1:5500", "http://localhost:3000", "http://localhost:5500"],
    credentials: true,
  })
);

app.use(bodyParser.json({ limit: "15mb" }));
app.use(bodyParser.urlencoded({ extended: true }));

// parse cookies (needed for cookie-based sessions)
app.use(cookieParser());

// --- INITIALIZE FIREBASE ADMIN ---
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: "hfa-database.firebasestorage.app" // Firebase Storage bucket
});
const db = admin.firestore();
// --- SMTP / EMAIL SETUP ---
// jwt .env secret
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("FATAL: JWT_SECRET is not set. Please set JWT_SECRET in your environment or .env file and restart the server.");
  process.exit(1);
}


// Resend API configuration
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

if (!RESEND_API_KEY) {
  console.warn("Warning: RESEND_API_KEY not set. Email sending (OTP, notifications) may fail.");
}

// Initialize Resend client with timeout configuration
const resend = new Resend(RESEND_API_KEY, {
  timeout: 10000, // 10 second timeout
});


// Create nodemailer-compatible wrapper for Resend (for router compatibility)
const mailTransporter = {
  async sendMail(mailOptions) {
    // Convert nodemailer format to Resend format
    const { from, to, subject, html, text } = mailOptions;
    
    return await resend.emails.send({
      from: from || `"AlpHFAbet: Holy Family Academy"<${RESEND_FROM_EMAIL}>`,
      to: to,
      subject: subject,
      html: html || text || '',
    });
  },
  // Mock verify method for compatibility
  async verify() {
    if (!RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY not configured');
    }
    return true;
  }
};

// Helper to generate 6-digit OTP
function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Helper: cookie options based on environment
function cookieOptionsForEnv() {
  const opts = {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 1000 // 1 hour
  };
  opts.secure = (process.env.NODE_ENV === 'production'); // use secure cookie in production
  return opts;
}

// ----------------- AUTH ENDPOINTS -----------------


app.post("/auth/login", async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: "Missing idToken" });

    // verify Firebase idToken
    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(idToken);
    } catch (err) {
      console.warn("/auth/login invalid idToken", err && err.message);
      return res.status(401).json({ error: "Invalid idToken" });
    }
    const uid = decoded.uid;
    const email = decoded.email || null;

    // fetch profile from Firestore users/{uid}
    const userSnap = await db.collection("users").doc(uid).get();
    const profile = userSnap.exists ? userSnap.data() : null;
    const role = profile?.role || "applicant";
    const forcePasswordChange = profile?.forcePasswordChange ? true : false;

    // OTP for both admin and teacher applicants
    if (role === "admin" || role === "applicant") {
      // require email to send OTP
      const userEmail = (profile && profile.email) || email;
      if (!userEmail) {
        return res.status(400).json({ error: "No email available for this account. Contact support." });
      }

      const otp = generateOtp();
      const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes
      // store by uid (new OTP session or overwrite)
      // Set lastSentAt to 0 so first resend is allowed immediately
      otpStore.set(uid, {
        otp,
        expiresAt,
        email: userEmail,
        lastSentAt: 0,  // Don't block first resend
        resendCount: 0,
        firstResendAt: 0
      });

      // Send OTP email via Resend API - different content based on role
      let emailSubject, emailBody;
      if (role === "admin") {
        emailSubject = "Your login code";
        emailBody = `<p>Your admin login code is <strong>${otp}</strong>. It expires in 5 minutes.</p>`;
      } else if (role === "applicant") {
        emailSubject = "Your login code";
        emailBody = `<p>Your teacher applicant login code is <strong>${otp}</strong>. It expires in 5 minutes.</p>`;
      }

      try {
        console.log(`[/auth/login] 📤 Attempting to send OTP email to ${userEmail} from ${RESEND_FROM_EMAIL}`);
        const emailResult = await resend.emails.send({
          from: `"AlpHFAbet: Holy Family Academy"<${RESEND_FROM_EMAIL}>`,
          to: userEmail,
          subject: emailSubject,
          html: emailBody
        });
        console.log(`[/auth/login] ✅ OTP email sent successfully!`, emailResult);
      } catch (mailErr) {
        console.error("/auth/login: ❌ Failed to send OTP email");
        console.error("Error details:", {
          message: mailErr?.message,
          code: mailErr?.code,
          statusCode: mailErr?.statusCode,
          name: mailErr?.name,
          stack: mailErr?.stack
        });
        // proceed: return needsOtp even if email failed (client may ask admin to check)
      }

      return res.json({ ok: true, needsOtp: true, message: "OTP sent to email" });
    }

    // Other roles (if any): sign JWT immediately
    const tokenPayload = { uid, role, email };
    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: "1h" });

    // set cookie for session
    res.cookie('__session', token, cookieOptionsForEnv());

    return res.json({ ok: true, token, role, forcePasswordChange });
  } catch (err) {
    console.error("/auth/login error", err && (err.stack || err));
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /auth/verify-otp
 * Body: { otp, idToken?, email? }
 * - If OTP valid: issue server JWT { uid, role, email } and return forcePasswordChange if present
 */
app.post("/auth/verify-otp", async (req, res) => {
  try {
    const { otp, idToken, email } = req.body;
    if (!otp) return res.status(400).json({ error: "Missing otp" });

    let uid = null;
    let decoded = null;
    if (idToken) {
      try {
        decoded = await admin.auth().verifyIdToken(idToken);
        uid = decoded.uid;
      } catch (err) {
        // invalid idToken - we'll try to locate by email if provided
        uid = null;
      }
    }
    // throws an error if the uid is missing
    if (!uid) {
      if (!email) return res.status(400).json({ error: "Missing uid/idToken or email to locate OTP" });
      // find entry in otpStore by email
      for (const [k, v] of otpStore.entries()) {
        if (v.email && v.email.toLowerCase() === (email || "").toLowerCase()) {
          uid = k;
          break;
        }
      }
    }
    if (!uid) return res.status(400).json({ error: "No pending OTP found. Please login again." });
    const stored = otpStore.get(uid);
    if (!stored) return res.status(400).json({ error: "No pending OTP for this account. Please login again." });

    if (Date.now() > stored.expiresAt) {
      otpStore.delete(uid);
      return res.status(400).json({ error: "OTP expired. Please resend code." });
    }

    if (stored.otp !== otp) {
      return res.status(401).json({ error: "Invalid code. Please try again." });
    }

    // Valid: delete OTP, issue server JWT
    otpStore.delete(uid);

    const profileSnap = await db.collection('users').doc(uid).get();
    const role = profileSnap && profileSnap.exists ? (profileSnap.data().role || "admin") : "admin";
    const userEmail = (profileSnap && profileSnap.exists && profileSnap.data().email) || stored.email || null;
    const forcePasswordChange = profileSnap && profileSnap.exists ? !!profileSnap.data().forcePasswordChange : false;

    const tokenPayload = { uid, role, email: userEmail };
    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: "1h" });

    // set cookie for session
    res.cookie('__session', token, cookieOptionsForEnv());

    return res.json({ ok: true, token, role, forcePasswordChange });
  } catch (err) {
    console.error("/auth/verify-otp error", err && (err.stack || err));
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /auth/logout
 * - Revokes a server-issued JWT so it cannot be used again (in-memory blacklist)
 * - Accepts token via Authorization header or { token } in body
 */
app.post("/auth/logout", (req, res) => {
  try {
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) token = authHeader.split("Bearer ")[1];
    else token = req.body && req.body.token;
    // if no explicit token supplied, try cookie
    if (!token && req.cookies && req.cookies.__session) token = req.cookies.__session;

    if (!token) return res.status(400).json({ error: "No token provided to revoke" });

    revokeToken(token);

    // clear cookie (if present)
    res.clearCookie('__session', {
      httpOnly: true,
      sameSite: 'lax',
      secure: (process.env.NODE_ENV === 'production')
    });

    return res.json({ success: true, message: "Logged out" });
  } catch (err) {
    console.error("/auth/logout error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

//  Resend OTP configuration & helper 
const RESEND_COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes
const RESEND_WINDOW_MS = 60 * 60 * 1000; // 1 hour rolling window
const MAX_RESENDS = 5; // max resends per RESEND_WINDOW_MS

// helper: find uid by email in otpStore (returns uid or null)
function findUidByEmailInOtpStore(email) {
  if (!email) return null;
  const low = (email || "").toLowerCase();
  for (const [k, v] of otpStore.entries()) {
    if (v && v.email && v.email.toLowerCase() === low) return k;
  }
  return null;
}

// POST /auth/resend-otp
app.post("/auth/resend-otp", async (req, res) => {
  try {
    const { idToken, email } = req.body || {};
    let uid = null;
    let userEmail = email || null;

    // Try to verify idToken if provided (preferred)
    if (idToken) {
      try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        uid = decoded.uid;
        userEmail = decoded.email || userEmail;
      } catch (err) {
        // invalid idToken -> we'll fall back to email lookup if provided
        uid = null;
      }
    }

    // if no uid yet, try to find by email in otpStore
    if (!uid) {
      if (!userEmail) {
        return res.status(400).json({ error: "Missing idToken or email to identify account." });
      }
      uid = findUidByEmailInOtpStore(userEmail);
      if (!uid) {
        // No existing OTP session found for this email -> ask client to re-login
        return res.status(400).json({ error: "No pending OTP session found. Please login again." });
      }
    }

    // Now we have uid and userEmail (if userEmail still null, try to read from store)
    let entry = otpStore.get(uid) || null;
    if (!entry) {
      // If no entry exists in otpStore for uid, create a minimal one (email should exist)
      entry = {
        email: userEmail,
        otp: null,
        expiresAt: 0,
        lastSentAt: 0,
        resendCount: 0,
        firstResendAt: 0
      };
    } else {
      if (!entry.email && userEmail) entry.email = userEmail;
    }

    const now = Date.now();

    // Debug logging
    console.log('[resend-otp] Entry state:', {
      uid,
      lastSentAt: entry.lastSentAt,
      resendCount: entry.resendCount,
      firstResendAt: entry.firstResendAt,
      email: entry.email
    });

    // Rate limit window reset if firstResendAt older than window
    if (!entry.firstResendAt || (now - (entry.firstResendAt || 0) > RESEND_WINDOW_MS)) {
      entry.firstResendAt = now;
      entry.resendCount = 0;
    }

    // Check overall rate limit (max resends in window)
    if ((entry.resendCount || 0) >= MAX_RESENDS) {
      const retryAfter = Math.ceil(((entry.firstResendAt || 0) + RESEND_WINDOW_MS - now) / 1000);
      console.log('[resend-otp] BLOCKED: Max resends reached');
      return res.status(429).json({ error: "Resend limit reached. Try later.", retryAfter });
    }

    // Check cooldown (3 minutes between sends)
    const sinceLast = now - (entry.lastSentAt || 0);
    console.log('[resend-otp] Cooldown check:', {
      lastSentAt: entry.lastSentAt,
      sinceLast,
      cooldownMs: RESEND_COOLDOWN_MS,
      shouldBlock: entry.lastSentAt && sinceLast < RESEND_COOLDOWN_MS
    });
    
    if (entry.lastSentAt && sinceLast < RESEND_COOLDOWN_MS) {
      const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - sinceLast) / 1000);
      console.log('[resend-otp] BLOCKED: Cooldown active, retry in', retryAfter, 'seconds');
      return res.status(429).json({ error: "Cooldown active. Try again later.", retryAfter });
    }

    // Generate new OTP and update entry
    const otp = generateOtp();
    entry.otp = otp;
    entry.expiresAt = now + 5 * 60 * 1000; // 5 minutes expiry
    entry.lastSentAt = now;
    entry.resendCount = (entry.resendCount || 0) + 1;
    if (!entry.firstResendAt) entry.firstResendAt = now;

    // persist back to otpStore
    otpStore.set(uid, entry);

    // Send OTP email via Resend API
    try {
      await resend.emails.send({
        from: RESEND_FROM_EMAIL,
        to: entry.email,
        subject: "Your admin login code (resend)",
        html: `<p>Your admin login code is <strong>${otp}</strong>. It expires in 5 minutes.</p>`
      });
      console.log(`[/auth/resend-otp] ✅ OTP email resent to ${entry.email}`);
      const nextAllowedIn = Math.ceil(RESEND_COOLDOWN_MS / 1000);
      return res.json({
        ok: true,
        message: "OTP resent to your email.",
        nextAllowedIn,
        emailed: true
      });
    } catch (mailErr) {
      console.error("/auth/resend-otp: ❌ Failed to resend OTP email:", mailErr?.message || mailErr);
      const nextAllowedIn = Math.ceil(RESEND_COOLDOWN_MS / 1000);
      return res.json({
        ok: false,
        message: "Failed to send OTP. Please try logging in again.",
        nextAllowedIn,
        emailed: false
      });
    }
  } catch (err) {
    console.error("/auth/resend-otp error", err && (err.stack || err));
    return res.status(500).json({ error: "Server error" });
  }
});

// --- MIDDLEWARE ---
// Updated requireAdmin: accept Firebase ID tokens OR server JWTs 
// and reject revoked server JWTs
async function requireAdmin(req, res, next) {
  try {
    // Read token from Authorization header (Bearer ...) OR from cookie __session
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) token = authHeader.split('Bearer ')[1];
    else if (req.cookies && req.cookies.__session) token = req.cookies.__session;

    if (!token) return res.status(401).json({ error: 'No token provided', message: 'Missing authentication token. Please sign in.' });

    let uid = null;
    // Try JWT cookie first (primary auth method)
    try {
      if (revokedTokens.has(token)) {
        return res.status(401).json({ error: "Token revoked", message: "Your session has been revoked. Please sign in again." });
      }
      const decoded = jwt.verify(token, JWT_SECRET);
      uid = decoded.uid;
    } catch (jwtErr) {
      // If JWT fails, try Firebase ID token (for login endpoints only)
      try {
        const decoded2 = await admin.auth().verifyIdToken(token);
        uid = decoded2.uid;
      } catch (firebaseErr) {
        console.error('requireAdmin token verification failed', jwtErr && jwtErr.message, firebaseErr && firebaseErr.message);
        return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired token. Please sign in.' });
      }
    }

    if (!uid) return res.status(401).json({ error: 'Invalid token', message: 'Invalid authentication token.' });

    const userDoc = await db.collection('users').doc(uid).get();
    const role = userDoc.exists ? userDoc.data().role : null;
    
    if (role !== 'admin') {
      console.warn(`[requireAdmin] Access denied for uid ${uid} - role is '${role}', expected 'admin'`);
      return res.status(403).json({ error: 'Forbidden: admin only', message: 'You must be an admin to access this resource.' });
    }

    // attach admin info
    req.adminUser = { uid, email: userDoc.exists ? userDoc.data().email : null };
    next();
  } catch (err) {
    console.error('requireAdmin error', err);
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication failed.' });
  }
}

// Strict super-admin middleware
async function requireSuperAdmin(req, res, next) {
  try {
    // Read token from Authorization header (Bearer ...) OR from cookie __session
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) token = authHeader.split('Bearer ')[1];
    else if (req.cookies && req.cookies.__session) token = req.cookies.__session;

    if (!token) return res.status(401).json({ error: 'No token provided', message: 'Missing authentication token. Please sign in.' });

    let uid = null;
    try {
      if (revokedTokens.has(token)) {
        return res.status(401).json({ error: 'Token revoked', message: 'Your session has been revoked. Please sign in again.' });
      }
      const decoded = jwt.verify(token, JWT_SECRET);
      uid = decoded.uid;
    } catch (jwtErr) {
      try {
        const decoded2 = await admin.auth().verifyIdToken(token);
        uid = decoded2.uid;
      } catch (firebaseErr) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired token. Please sign in.' });
      }
    }

    if (!uid) return res.status(401).json({ error: 'Invalid token', message: 'Invalid authentication token.' });

    const userDoc = await db.collection('users').doc(uid).get();
    const data = userDoc.exists ? userDoc.data() : null;
    const isBootstrapSuper = data && (data.email || '').toLowerCase() === 'jrymnd18@gmail.com';
    if (!data || data.role !== 'admin' || !(data.isSuperAdmin || isBootstrapSuper)) {
      return res.status(403).json({ error: 'Forbidden: super admin only', message: 'You must be a super admin to access this resource.' });
    }

    req.adminUser = { uid, email: data.email || null, isSuperAdmin: true };
    next();
  } catch (err) {
    console.error('requireSuperAdmin error', err);
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication failed.' });
  }
}

// requireAuth middleware (for applicants / teacher-protected endpoints) 
// Accepts Firebase ID tokens OR server JWTs (signed with JWT_SECRET)
// It will read token from Authorization header or from cookie __session
async function requireAuth(req, res, next) {
  try {
    // get token from Authorization: Bearer <token> OR from cookie __session
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split('Bearer ')[1];
    } else if (req.cookies && req.cookies.__session) {
      token = req.cookies.__session;
    }

    if (!token) return res.status(401).json({ error: 'No token provided' });

    let uid = null;
    let email = null;
    let role = null;

    // Try JWT cookie first (primary auth method)
    try {
      // reject revoked tokens early
      if (revokedTokens.has(token)) {
        return res.status(401).json({ error: "Token revoked" });
      }
      const decoded = jwt.verify(token, JWT_SECRET);
      uid = decoded.uid;
      email = decoded.email || null;
      role = decoded.role || null;
    } catch (jwtErr) {
      // If JWT fails, try Firebase ID token (for login endpoints only)
      try {
        const decoded2 = await admin.auth().verifyIdToken(token);
        uid = decoded2.uid;
        email = decoded2.email || null;
      } catch (firebaseErr) {
        console.error('requireAuth token verification failed', jwtErr && jwtErr.message, firebaseErr && firebaseErr.message);
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    if (!uid) return res.status(401).json({ error: 'Invalid token' });

    // Read role/email from Firestore users/{uid} if present, otherwise use role/email from token
    const userDoc = await db.collection('users').doc(uid).get();
    const docRole = userDoc.exists ? userDoc.data().role : null;
    const docEmail = userDoc.exists ? userDoc.data().email : null;

    req.user = {
      uid,
      role: docRole || role || null,
      email: docEmail || email || null
    };

    next();
  } catch (err) {
    console.error('requireAuth error', err);
    return res.status(401).json({ error: 'Unauthorized' });
  }
}


async function writeActivityLog({ actorUid, actorEmail, targetUid = null, action, detail = '' }) {
  try {
    // display names in the actvity logs
    let actorName = 'System'; // Default for system actions
    
    if (actorUid) {
      try {
        const userDoc = await db.collection('users').doc(actorUid).get();
        if (userDoc.exists) {
          const userData = userDoc.data();
          // Use display name, fallback to email, fallback to 'Unknown User'
          actorName = userData.displayName || userData.email || 'Unknown User';
        } else {
          actorName = actorEmail || 'Unknown User';
        }
      } catch (fetchErr) {
        console.warn('Failed to fetch actor display name:', fetchErr.message);
        actorName = actorEmail || 'Unknown User';
      }
    }
    
    // Store the log with the display name included
    await db.collection('activity_logs').add({
      actorUid,
      actorEmail,
      actorName,      // Store display name here for easy retrieval later
      targetUid,
      action,
      detail,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) {
    console.error('Failed to write activity log:', err);
  }
}

// ---- NEW: GET /auth/validate endpoint ----
app.get('/auth/validate', async (req, res) => {
  try {
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) token = authHeader.split('Bearer ')[1];
    else if (req.cookies && req.cookies.__session) token = req.cookies.__session;

    if (!token) return res.status(401).json({ error: 'Missing token' });

    let uid = null;
    let role = null;
    let email = null;

    // Try Firebase ID token first
    try {
      const decoded = await admin.auth().verifyIdToken(token);
      uid = decoded.uid;
      email = decoded.email || null;
    } catch (firebaseErr) {
      // Not a Firebase token: try server JWT
      try {
        if (revokedTokens.has(token)) return res.status(401).json({ error: 'Token revoked' });
        const decoded2 = jwt.verify(token, JWT_SECRET);
        uid = decoded2.uid;
        role = decoded2.role || null;
        email = decoded2.email || null;
      } catch (jwtErr) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    if (!uid) return res.status(401).json({ error: 'Unauthorized' });

    // Try to enrich from Firestore
    try {
      const snap = await db.collection('users').doc(uid).get();
      if (snap.exists) {
        role = snap.data().role || role;
        email = snap.data().email || email;
        const isSuperAdmin = !!snap.data().isSuperAdmin || ((snap.data().email || '').toLowerCase() === 'jrymnd18@gmail.com');
        return res.json({ ok: true, uid, role, email, isSuperAdmin });
      }
    } catch (e) {
      console.warn('/auth/validate: failed to read user doc', e && e.message);
    }

    return res.json({ ok: true, uid, role, email, isSuperAdmin: false });
  } catch (err) {
    console.error('/auth/validate error', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /auth/clear-force-password
 * Body: { uid? }
 * - Requires authentication (Firebase ID token or server JWT) via requireAuth middleware.
 * - Clears users/{uid}.forcePasswordChange = false for the requesting user 
 */
app.post('/auth/clear-force-password', requireAuth, async (req, res) => {
  try {
    const requester = req.user; // set by requireAuth
    if (!requester || !requester.uid) return res.status(401).json({ error: 'Unauthorized' });

    const { uid: bodyUid } = req.body || {};
    const targetUid = (bodyUid && String(bodyUid).trim()) ? String(bodyUid).trim() : requester.uid;

    // allow admins to clear any uid; non-admins only their own
    const isAdmin = requester.role === 'admin';
    if (!isAdmin && targetUid !== requester.uid) {
      return res.status(403).json({ error: 'Forbidden', message: 'Only admins may clear other users' });
    }

    const userRef = db.collection('users').doc(targetUid);
    await userRef.set({
      forcePasswordChange: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    await writeActivityLog({
      actorUid: requester.uid,
      actorEmail: requester.email || null,
      targetUid,
      action: 'clear-force-password',
      detail: `cleared_by:${requester.uid}`
    });

    return res.json({ ok: true, clearedFor: targetUid });
  } catch (err) {
    console.error('/auth/clear-force-password error', err && (err.stack || err));
    return res.status(500).json({ error: 'Server error' });
  }
});

// STATIC FILE SERVING 
const PROJECT_ROOT = path.join(__dirname, '..');

// Cache control for admin portal
app.use("/adminportal", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  next();
});

// Serve static files for specific routes only (security: no root exposure)
app.use("/landing", express.static(path.join(PROJECT_ROOT, "landing")));
app.use("/login", express.static(path.join(PROJECT_ROOT, "login")));
app.use("/adminportal", express.static(path.join(PROJECT_ROOT, "adminportal")));
app.use("/applicationform", express.static(path.join(PROJECT_ROOT, "applicationform")));
app.use("/teacher-application", express.static(path.join(PROJECT_ROOT, "teacher-application")));
app.use("/assets", express.static(path.join(PROJECT_ROOT, "assets")));

// Serve specific shared JS files from root (used by multiple sections)
app.get("/firebase-config.js", (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, "firebase-config.js"));
});
app.get("/api-fetch.js", (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, "api-fetch.js"));
});
app.get("/check-auth.js", (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, "check-auth.js"));
});
app.get("/logout-auth.js", (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, "logout-auth.js"));
});

// Serve landing page (main.html from landing folder)
app.get("/", (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, "landing", "main.html"));
});

// Redirect old main.html URL to homepage for backward compatibility
app.get("/main.html", (req, res) => {
  res.redirect("/");
});

// Serve main.html at /landing/main.html as well
app.get("/landing/main.html", (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, "landing", "main.html"));
});

// requirements mapping
const requirementMap = {
  reportcard: "FORM 138 / Report Card",
  psa: "PSA / Birth Certificate",
  goodMoral: "Certificate of Good Moral Character",
  form137: "FORM 137",
  completionCertificate: "Certificate of Completion",
  clearance: "Clearance Certificate",
};

function defaultRequirementsObject() {
  const out = {};
  for (const [slot, label] of Object.entries(requirementMap)) {
    out[slot] = { label, checked: false };
  }
  return out;
}

// routes

// FORM SUBMISSION ENDPOINT
app.post("/api/submit-application", async (req, res) => {
  try {
    const formData = req.body;
    // Determine Firestore collection
    let collectionName = "";
    if (formData.formType === "jhs") collectionName = "jhsApplicants";
    else if (formData.formType === "shs") collectionName = "shsApplicants";
    else if (formData.formType === "teacher") {
      
      // The new client should call /applicants/create. 
      // create auth user & send credentials 
      // For safety, return an error telling client to use /applicants/create.
      return res.status(400).json({ error: "Use /applicants/create for teacher applications" });
    } else return res.status(400).json({ error: "Invalid form type." });

    // JHS / SHS applicant
    const toSave = {
      ...formData,
      status: "pending",
      requirements: defaultRequirementsObject(),
      isNew: true,
      enrolled: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const docRef = await db.collection(collectionName).add(toSave);
    const newId = docRef.id;
    res.status(200).json({ success: true, newId });
  } catch (error) {
    console.error("Submission error:", error && (error.stack || error));
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

/* NEW endpoints for applicant create + email confirmation  */


/* Generate 6-digit code, with resend cooldown */
app.post('/applicants/send-code', async (req, res) => {
  try {
    const { applicationId, email } = req.body || {};
    if (!applicationId || !email) return res.status(400).json({ error: 'Missing applicationId or email' });

    // fetch application to validate it exists
    const appSnap = await db.collection('teacherApplicants').doc(applicationId).get();
    if (!appSnap.exists) return res.status(404).json({ error: 'Application not found' });

    const CONF = db.collection('email_confirmations').doc(applicationId);
    const now = Date.now();
    const cooldownMs = 3 * 60 * 1000; // 3 minutes
    const windowMs = 60 * 60 * 1000; // 1 hour
    const MAX_RESENDS = 5;

    const doc = await CONF.get();
    let entry = doc.exists ? doc.data() : null;

    if (!entry) {
      entry = {
        email,
        otp: null,
        expiresAt: 0,
        lastSentAt: 0,
        resendCount: 0,
        firstResendAt: now
      };
    } else {
      if (entry.lastSentAt && (now - entry.lastSentAt) < cooldownMs) {
        const retryAfter = Math.ceil((cooldownMs - (now - entry.lastSentAt)) / 1000);
        return res.status(429).json({ error: 'Cooldown active', retryAfter });
      }
      if (!entry.firstResendAt || (now - entry.firstResendAt) > windowMs) {
        entry.firstResendAt = now;
        entry.resendCount = 0;
      }
      if ((entry.resendCount || 0) >= MAX_RESENDS) {
        const retryAfter = Math.ceil(((entry.firstResendAt || 0) + windowMs - now) / 1000);
        return res.status(429).json({ error: 'Resend limit reached', retryAfter });
      }
    }
    // otp sends
    const otp = generateOtp();
    entry.otp = otp;
    entry.expiresAt = now + (5 * 60 * 1000); // 5 min
    entry.lastSentAt = now;
    entry.resendCount = (entry.resendCount || 0) + 1;

    await CONF.set(entry, { merge: true });

    // Send OTP email via Resend API
    try {
      await resend.emails.send({
        from: `"AlpHFAbet: Holy Family Academy"<${RESEND_FROM_EMAIL}>`,
        to: email,
        subject: "Your application confirmation code",
        html: `<p>Your confirmation code is <strong>${otp}</strong>. It expires in 5 minutes.</p>`
      });
      console.log(`[/applicants/send-code] ✅ OTP sent to ${email}`);
      const nextAllowedIn = Math.ceil(cooldownMs / 1000);
      return res.json({ ok: true, message: 'Code sent', nextAllowedIn, emailed: true });
    } catch (mailErr) {
      console.error('[/applicants/send-code] ❌ Failed to send OTP:', mailErr?.message || mailErr);
      const nextAllowedIn = Math.ceil(cooldownMs / 1000);
      return res.json({ ok: false, message: 'Failed to send code. Try again later', nextAllowedIn, emailed: false });
    }
  } catch (err) {
    console.error('/applicants/send-code error', err && (err.stack || err));
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /applicants/confirm-email
 * Body: { applicationId, email, code, displayName }
  - send credentials email (temp password) to applicant
 */
app.post('/applicants/confirm-email', async (req, res) => {
  try {
    const { applicationId, email, code, displayName } = req.body || {};
    if (!applicationId || !email || !code) {
      return res.status(400).json({ ok: false, error: 'Missing required fields: applicationId, email, code' });
    }

    const lowerEmail = String(email).trim().toLowerCase();

    // Read confirmation session
    const CONF = db.collection('email_confirmations').doc(applicationId);
    const confSnap = await CONF.get();
    if (!confSnap.exists) {
      return res.status(400).json({ ok: false, error: 'No confirmation session found. Please request a code first.' });
    }
    const confData = confSnap.data() || {};

    // Verify OTP matches
    if (!confData.otp || String(confData.otp) !== String(code).trim()) {
      return res.status(401).json({ ok: false, error: 'Invalid code' });
    }

    // Check expiry
    const expiresAt = Number(confData.expiresAt || 0);
    if (Date.now() > expiresAt) {
      // remove stale confirmation session
      await CONF.delete().catch(() => {});
      return res.status(400).json({ ok: false, error: 'Code expired. Please request a new code.' });
    }

    // Optional stored-email check: if confirmation session has an email recorded, ensure it matches provided email
    if (confData.email && String(confData.email).trim().toLowerCase() !== lowerEmail) {
      return res.status(400).json({ ok: false, error: 'Email mismatch with confirmation session' });
    }

    // Ensure application exists and is not already processed
    const appRef = db.collection('teacherApplicants').doc(applicationId);
    const appSnap = await appRef.get();
    if (!appSnap.exists) {
      return res.status(404).json({ ok: false, error: 'Application not found' });
    }
    const appData = appSnap.data() || {};

    // If application already submitted or already has uid, prevent re-processing
    const currentStatus = (appData.status || '').toString().toLowerCase();
    if (currentStatus === 'submitted' || appData.uid) {
      return res.status(400).json({ ok: false, error: 'Application already processed' });
    }

    // If application has a stored contactEmail or email, ensure it matches provided email (optional but safer)
    const appEmail = ((appData.contactEmail || appData.email) || '').toString().trim().toLowerCase();
    if (appEmail && appEmail !== lowerEmail) {
      // mismatch between application and provided email -> deny
      return res.status(400).json({ ok: false, error: 'Provided email does not match application record' });
    }
    // Check if email is already used in Auth
    try {
      await admin.auth().getUserByEmail(lowerEmail);
      // If found, reject — we don't want to overwrite existing user.
      return res.status(400).json({ ok: false, error: 'Email already in use' });
    } catch (err) {
      if (!(err && err.code && err.code === 'auth/user-not-found')) {
        console.error('getUserByEmail check failed', err && err.message);
        return res.status(500).json({ ok: false, error: 'Failed to verify email availability' });
      }
      // user-not-found -> good to proceed
    }
    // All checks passed -> consume confirmation (delete to prevent reuse)
    await CONF.delete().catch(() => {});

    // Generate temporary password (uses your helper generateRandomPassword)
    const tempPassword = generateRandomPassword ? generateRandomPassword() : (function defaultPwd() {
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
      return Array.from({ length: 12 }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join("");
    })();

    // Create Firebase Auth user
    let userRecord;
    try {
      userRecord = await admin.auth().createUser({
        email: lowerEmail,
        password: tempPassword,
        displayName: displayName || appData.displayName || (lowerEmail.split('@')[0])
      });
    } catch (createErr) {
      console.error('createUser failed', createErr && createErr.message);
      return res.status(500).json({ ok: false, error: 'Failed to create user account' });
    }

    const newUid = userRecord.uid;

    // Persist users/{uid} doc and update application doc. If Firestore writes fail, attempt to roll back created Auth user.
    try {
      // users doc
      await db.collection('users').doc(newUid).set({
        uid: newUid,
        email: lowerEmail,
        displayName: displayName || appData.displayName || null,
        role: 'applicant',
        forcePasswordChange: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // update application doc: attach uid and set submitted status
      await appRef.set({
        uid: newUid,
        status: 'submitted',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      // Log activity (best-effort; your writeActivityLog helper used elsewhere)
      try {
        await writeActivityLog({
          actorUid: newUid,
          actorEmail: lowerEmail,
          targetUid: newUid,
          action: 'applicant-created',
          detail: `applicationId:${applicationId}`
        });
      } catch (logErr) {
        console.warn('writeActivityLog failed', logErr && logErr.message);
      }

    } catch (fsErr) {
      console.error('Firestore write failed after createUser; attempting cleanup', fsErr && fsErr.message);
      // try delete created auth user to avoid orphaned auth account
      try {
        await admin.auth().deleteUser(newUid);
      } catch (delErr) {
        console.error('Failed to delete created auth user after Firestore failure', delErr && delErr.message);
      }
      return res.status(500).json({ ok: false, error: 'Failed to finalize account creation' });
    }

    // Try to send credentials email via Resend API
    try {
      await resend.emails.send({
        from: `"AlpHFAbet: Holy Family Academy"<${RESEND_FROM_EMAIL}>`,
        to: lowerEmail,
        subject: "Your application account is ready",
        html: `
          <h3>Your application account</h3>
          <p>Your applicant account has been created. Use the credentials below to sign in:</p>
          <p><strong>Email:</strong> ${lowerEmail}</p>
          <p><strong>Temporary password:</strong> ${tempPassword}</p>
          <p>On first login you will be required to change your password.</p>
        `
      });
      console.log(`[/applicants/confirm-email] ✅ Credentials sent to ${lowerEmail}`);
      return res.json({ ok: true, emailed: true, message: 'Account created and emailed' });
    } catch (mailErr) {
      console.error('[/applicants/confirm-email] ❌ Failed to send credentials:', mailErr?.message || mailErr);
      // Still a success (account created). Return emailed:false so client can show appropriate message.
      return res.json({ ok: true, emailed: false, message: 'Account created but emailing failed' });
    }
  } catch (err) {
    console.error('/applicants/confirm-email error', err && (err.stack || err));
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});
// create user after getting confirm
app.post('/applicants/create', async (req, res) => {
  try {
    const formData = req.body || {};

    // Basic validation — require formType === 'teacher' and minimal fields (adjust as needed)
    if (!formData.formType || String(formData.formType) !== 'teacher') {
      return res.status(400).json({ success: false, error: 'Invalid formType. Expecting formType: "teacher".' });
    }

    const firstName = (formData.firstName || '').toString().trim();
    const lastName = (formData.lastName || '').toString().trim();
    const emailRaw = (formData.email || formData.contactEmail || '').toString().trim();
    const email = emailRaw ? emailRaw.toLowerCase() : '';

    if (!firstName || !lastName || !email) {
      return res.status(400).json({ success: false, error: 'Missing required fields: firstName, lastName, email.' });
    }

    // Validate and format phone number
    let formattedPhone;
    try {
      if (formData.contactNumber) {
        formattedPhone = validateAndFormatPhone(formData.contactNumber);
      }
    } catch (phoneError) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid phone number', 
        details: phoneError.message 
      });
    }

    // Prepare document to persist
    const now = admin.firestore.FieldValue.serverTimestamp();
    const toSave = {
      ...formData,
      contactEmail: email,
      contactNumber: formattedPhone || formData.contactNumber, // Use formatted phone if validated
      status: 'pending',  // pending until email is confirmed
      requirements: defaultRequirementsObject(),
      isNew: true,
      createdAt: now,
      updatedAt: now
    };

    const docRef = await db.collection('teacherApplicants').add(toSave);
    const applicationId = docRef.id;

    // Create/seed an email_confirmations doc so send-code can update/read it reliably.
    // It's okay if send-code also creates this doc, this is just convenience.
    try {
      await db.collection('email_confirmations').doc(applicationId).set({
        email,
        otp: null,
        expiresAt: 0,
        lastSentAt: 0,
        resendCount: 0,
        firstResendAt: Date.now()
      }, { merge: true });
    } catch (seedErr) {
      console.warn('/applicants/create: failed to seed email_confirmations (non-fatal)', seedErr && seedErr.message);
    }

    return res.json({ success: true, applicationId });
  } catch (err) {
    console.error('/applicants/create error', err && (err.stack || err));
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// -------------calling the routes---------------------
const dbClient = createDbClient({ db, admin });
const attachApplicantId = createAttachApplicantId({ dbClient });
const applicantMessagesRouter = createApplicantMessagesRouter({ dbClient, requireAuth  });
//routes for the enrollees (both shs and jhs)
app.use("/api", createEnrolleesRouter({
  db,
  admin,
  writeActivityLog
}));

// admin message
app.use("/api", createAdminMessagesRouter({
  db,
  mailTransporter,
  writeActivityLog,
  requireAdmin
}));

// for applicants message
app.use('/api/applicant-messages', requireAuth, attachApplicantId, applicantMessagesRouter);

// enrollment period settings
app.use('/api/enrollment', createEnrollmentRouter({ db, writeActivityLog ,requireAdmin }));

// announcements and news router (public GET, admin POST/PUT/DELETE)
app.use("/api", createAnnouncementsRouter({ 
  db, 
  admin, 
  requireAdmin, 
  writeActivityLog 
}));

// applicants router under /api/applicants (with admin for file uploads)
app.use('/api/applicants', createApplicantsRouter({ 
  db, 
  requireAuth, 
  requireAdmin,
  admin // PHASE 1: Add admin SDK for Firebase Storage uploads
}));
// for interview schedule
app.use("/api", interviewsRouter({
  db,
  admin,
  requireAdmin,
  writeActivityLog
}));
// admin actions in applicant progress
app.use("/api", createAdminActionsRouter({
    db,
   admin,
   requireAdmin,
   writeActivityLog
 }));

app.use("/", createAdminUsersRouter({
  db,
  admin,
  requireAdmin,
  requireSuperAdmin,
  writeActivityLog,
  mailTransporter
}));

// Activity logs router - handles activity log endpoints
app.use("/", createActivityLogsRouter({
  db,
  admin,
  requireAdmin,
  writeActivityLog
}));

// Dashboard statistics router
app.use("/api", createDashboardStatsRouter({
  db,
  admin,
  requireAdmin
}));

// Notes router - handles quick notes CRUD operations
app.use("/", createNotesRouter({
  db,
  requireAdmin
}));

// Teacher profile routes - handles teacher self-profile management
app.use("/", createTeacherProfileRouter({
  db,
  admin,
  requireAuth,
  writeActivityLog
}));

// Admin profile routes - handles admin self-profile management
app.use("/", createAdminProfileRouter({
  db,
  admin,
  requireAdmin,
  writeActivityLog
}));

// Teacher messages routes - handles sending messages to teacher applicants
app.use("/api/teacher-applicants", createTeacherMessagesRouter({
  db,
  dbClient,
  mailTransporter,
  requireAdmin,
  writeActivityLog,
  admin
}));

// Teacher notifications routes - handles notification operations
app.use("/api/teacher-applicants", createTeacherNotificationsRouter({
  db,
  mailTransporter,
  requireAdmin,
  requireAuth
}));

// Teacher Final Decision Routes - Mounted from separate route file
app.use("/api/teacher-applicants", createTeacherDecisionRouter({ 
  db, 
  mailTransporter, 
  requireAdmin,
  writeActivityLog 
}));

// Demo Teaching Schedule Routes
app.use("/api/teacher-applicants", createDemoScheduleRouter({
  db,
  mailTransporter,
  requireAdmin,
  writeActivityLog
}));

// Admin Mail Routes - handles admin inbox, sent messages, and compose functionality
app.use("/api/admin/mail", createAdminMailRouter({
  db,
  admin,
  mailTransporter,
  writeActivityLog,
  requireAdmin
}));

// HELPERS

function generateRandomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
  return Array.from({ length: 12 }, () =>
    chars.charAt(Math.floor(Math.random() * Math.random() * chars.length))
  ).join("");
}

// --- CRON JOB: AUTO-DELETE EXPIRED ACCOUNTS ---
// Runs every day at 2:00 AM
cron.schedule('0 2 * * *', async () => {
  console.log('🕒 Running auto-delete job for expired teacher accounts...');
  try {
    const result = await deleteExpiredAccounts({ db, writeActivityLog });
    if (result.success && result.deletedCount > 0) {
      console.log(`✅ Auto-delete completed: ${result.deletedCount} account(s) deleted`);
    }
  } catch (error) {
    console.error('❌ Auto-delete job failed:', error);
  }
});

console.log('✅ Cron job scheduled: Teacher account auto-deletion (daily at 2:00 AM)');

// --- CRON JOB: AUTO-DELETE ARCHIVED MESSAGES ---
// Runs every day at 2:00 AM - Delete archived messages older than 60 days
cron.schedule('0 2 * * *', async () => {
  console.log('🕒 Running auto-delete job for archived messages...');
  try {
    // Calculate date 60 days ago
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    
    // Find archived messages older than 60 days
    const snapshot = await db.collection('applicant_messages')
      .where('isArchived', '==', true)
      .where('archivedAt', '<', sixtyDaysAgo)
      .get();
    
    if (snapshot.empty) {
      console.log('✅ No archived messages to delete');
      return;
    }
    
    // Delete messages in batch
    const batch = db.batch();
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    await batch.commit();
    console.log(`✅ Auto-delete completed: ${snapshot.size} archived message(s) deleted (60+ days old)`);
    
  } catch (error) {
    console.error('❌ Auto-delete archived messages job failed:', error);
  }
});

console.log('✅ Cron job scheduled: Archived messages auto-deletion (daily at 2:00 AM, 60+ days old)');


// --- START SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on: http://localhost:${PORT}`);
});
