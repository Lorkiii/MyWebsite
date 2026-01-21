import express from 'express';

export default function createAdminUsersRouter(deps = {}) {
  const { 
    db, 
    admin, 
    requireAdmin, 
    requireSuperAdmin,
    writeActivityLog, 
    mailTransporter } = deps;


  if (!db) throw new Error("createAdminUsersRouter requires deps.db (Firestore instance)");
  if (!admin) throw new Error("createAdminUsersRouter requires deps.admin (firebase-admin)");
  if (typeof requireAdmin !== "function") throw new Error("createAdminUsersRouter requires deps.requireAdmin middleware");
  if (typeof requireSuperAdmin !== "function") throw new Error("createAdminUsersRouter requires deps.requireSuperAdmin middleware");

  // OTP window, throttling, and tracking caps
  const OTP_EXPIRY_MS = 5 * 60 * 1000;
  const RESEND_COOLDOWN_MS = 2 * 60 * 1000;
  const MAX_ATTEMPTS = 3;
  const adminOtpStore = new Map(); // keyed by "actorUid::email"

  // Helper: create key for otp store
  function buildOtpKey(actorUid, email) {
    return `${actorUid}::${email.toLowerCase()}`;
  }

  // Helper: produce 6-digit OTP
  function generateOtp() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // Helper: Parse displayName into firstName, middleName, lastName
  function parseDisplayName(displayName) {
    if (!displayName) return { firstName: '', middleName: '', lastName: '' };
    
    const parts = displayName.trim().split(/\s+/); // Split by whitespace
    
    if (parts.length === 0) {
      return { firstName: '', middleName: '', lastName: '' };
    } else if (parts.length === 1) {
      // Single name - use as firstName
      return { firstName: parts[0], middleName: '', lastName: '' };
    } else if (parts.length === 2) {
      // Two names - firstName and lastName
      return { firstName: parts[0], middleName: '', lastName: parts[1] };
    } else {
      // Three or more - first is firstName, last is lastName, middle is everything between
      return { 
        firstName: parts[0], 
        middleName: parts.slice(1, -1).join(' '), 
        lastName: parts[parts.length - 1] 
      };
    }
  }

  // Helper: Sync displayName to teacher applicant record
  async function syncTeacherApplicantName(db, uid, displayName) {
    // Find teacher applicant by uid
    const applicantsQuery = await db.collection('teacherApplicants')
      .where('uid', '==', uid)
      .limit(1)
      .get();
    
    if (applicantsQuery.empty) {
      // No teacher applicant record found - that's ok
      console.log(`No teacher applicant found for uid: ${uid}`);
      return;
    }
    
    // Parse the display name
    const { firstName, middleName, lastName } = parseDisplayName(displayName);
    
    // Update the teacher applicant record
    const applicantDoc = applicantsQuery.docs[0];
    await applicantDoc.ref.update({
      firstName: firstName || '',
      middleName: middleName || '',
      lastName: lastName || '',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log(`✅ Synced teacher applicant name for uid: ${uid}`, { firstName, middleName, lastName });
  }

  // Helper: produce temporary admin password
  function generateTempPassword() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
    return Array.from({ length: 12 }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join("");
  }



  // Helper: fail response with message
  function sendError(res, status, message, extra = {}) {
    return res.status(status).json({ error: message, ...extra });
  }

  const router = express.Router(); 

  router.post("/admin/create-admin/check-email", requireSuperAdmin, async (req, res) => {
    try {
      const rawEmail = (req.body?.email || "").trim().toLowerCase();
      if (!rawEmail) return sendError(res, 400, "Email is required");
      
      // Validate email must be @gmail.com
      if (!rawEmail.endsWith('@gmail.com')) {
        return sendError(res, 400, "Email must be a Gmail address (@gmail.com)");
      }

      try {
        await admin.auth().getUserByEmail(rawEmail);
        return sendError(res, 400, "Email is already in use");
      } catch (lookupErr) {
        if (!lookupErr?.code || lookupErr.code !== "auth/user-not-found") {
          console.error("/admin/create-admin/check-email auth lookup failed", lookupErr && lookupErr.message);
          return sendError(res, 500, "Failed to verify email availability");
        }
      }

      try {
        const dupSnap = await db.collection("users").where("email", "==", rawEmail).limit(1).get();
        if (!dupSnap.empty) {
          return sendError(res, 400, "Email already in use");
        }
      } catch (fsErr) {
        console.log("/admin/create-admin/check-email firestore lookup failed", fsErr && fsErr.message);
        return sendError(res, 500, "Failed to verify email availability");
      }

      return res.json({ available: true });
    } catch (err) {
      console.log("/admin/create-admin/check-email error", err && (err.stack || err));
      return sendError(res, 500, "Server error");
    }
  });

  // Route: check if phone number is available
  router.post("/admin/create-admin/check-phone", requireSuperAdmin, async (req, res) => {
    try {
      const phoneNumber = (req.body?.phoneNumber || "").trim();
      if (!phoneNumber) return sendError(res, 400, "Phone number is required");

      // Check Firebase Auth
      try {
        await admin.auth().getUserByPhoneNumber(phoneNumber);
        return sendError(res, 400, "Phone number already in use");
      } catch (lookupErr) {
        if (!lookupErr?.code || lookupErr.code !== "auth/user-not-found") {
          console.error("/admin/create-admin/check-phone auth lookup failed", lookupErr && lookupErr.message);
          return sendError(res, 500, "Failed to verify phone number availability");
        }
      }

      // Check Firestore
      try {
        const dupSnap = await db.collection("users").where("phoneNumber", "==", phoneNumber).limit(1).get();
        if (!dupSnap.empty) {
          return sendError(res, 400, "Phone number already in use");
        }
      } catch (fsErr) {
        console.log("/admin/create-admin/check-phone firestore lookup failed", fsErr && fsErr.message);
        return sendError(res, 500, "Failed to verify phone number availability");
      }

      return res.json({ available: true });
    } catch (err) {
      console.log("/admin/create-admin/check-phone error", err && (err.stack || err));
      return sendError(res, 500, "Server error");
    }
  });

  // Route: email an OTP so another admin can create a new admin
  router.post("/admin/create-admin/send-otp", requireSuperAdmin, async (req, res) => {
    try {
      const requester = req.adminUser; // admin requesting OTP
      // ensure the middleware attached an authenticated admin account
      if (!requester?.uid) return sendError(res, 401, "Unauthorized");
       // Verify email service is available
      if (!mailTransporter) return sendError(res, 500, "Email service unavailable"); // must be able to email code

      const rawEmail = (req.body?.email || "").trim().toLowerCase();
      const displayName = (req.body?.displayName || "").trim();
      const phoneNumber = (req.body?.phoneNumber || "").trim() || null;

      if (!rawEmail) return sendError(res, 400, "Email is required");
      if (!displayName) return sendError(res, 400, "Display name is required");
      
      // Validate email must be @gmail.com
      if (!rawEmail.endsWith('@gmail.com')) {
        return sendError(res, 400, "Email must be a Gmail address (@gmail.com)");
      }

      // OTP send limit removed - no restrictions on sending OTP

      const key = buildOtpKey(requester.uid, rawEmail);
      const existing = adminOtpStore.get(key);
      const now = Date.now();
      if (existing && now - existing.lastSentAt < RESEND_COOLDOWN_MS) {
        const waitMs = RESEND_COOLDOWN_MS - (now - existing.lastSentAt);
        return sendError(res, 429, "Please wait before resending OTP.", { retryAfterMs: waitMs });
      }

      const otp = generateOtp(); // create new 6-digit code
      const payload = {
        otp,
        email: rawEmail,
        displayName,
        phoneNumber,
        requestedByUid: requester.uid,
        requestedByEmail: requester.email || null,
        createdAt: now,
        expiresAt: now + OTP_EXPIRY_MS,
        lastSentAt: now,
        sendCount: existing ? existing.sendCount + 1 : 1,
        attempts: 0,
      };
      adminOtpStore.set(key, payload); // store OTP details in-memory

    //   sends an otp in email
      const mailOptions = {
        from: `"Holy Family Academy" <${process.env.RESEND_FROM_EMAIL || 'noreply@alphfabet.com'}>`,
        to: rawEmail,
        subject: "HFA Portal admin verification code",
        text: `Use this code to confirm creation of your admin account: ${otp}.\n\nThis code expires in 5 minutes.`
      };
      // email errors

      try {
        await mailTransporter.sendMail(mailOptions);
      } catch (mailErr) {
        adminOtpStore.delete(key);
        console.warn("/admin/create-admin/send-otp email failed", mailErr && mailErr.message);
        return sendError(res, 500, "Failed to send email");
      }
    //   writes on the acitvity log
      await writeActivityLog?.({
        actorUid: requester.uid,
        actorEmail: requester.email || null,
        action: "send-admin-otp",
        detail: `target:${rawEmail}`
      });

      return res.json({ success: true, expiresInMs: OTP_EXPIRY_MS, cooldownMs: RESEND_COOLDOWN_MS });
    } catch (err) {
      console.error("/admin/create-admin/send-otp error", err && (err.stack || err));
      return sendError(res, 500, "Server error");
    }
  });

  // Route: verify OTP and create the new admin account
  router.post("/admin/create-admin/verify-otp", requireSuperAdmin, async (req, res) => {
    try {
      const requester = req.adminUser; // admin performing verification
      // block if the session does not belong to an authenticated admin
      if (!requester?.uid) return sendError(res, 401, "Unauthorized");

      const rawEmail = (req.body?.email || "").trim().toLowerCase();
      const otp = (req.body?.otp || "").trim();
      if (!rawEmail || !otp) return sendError(res, 400, "Email and OTP are required");

      const key = buildOtpKey(requester.uid, rawEmail);
      const record = adminOtpStore.get(key);
      if (!record) return sendError(res, 400, "OTP not found. Please request a new code."); // no matching OTP stored

      const now = Date.now();
      if (now > record.expiresAt) {
        adminOtpStore.delete(key);
        return sendError(res, 400, "OTP expired. Please request a new code.");
      }

      if (record.attempts >= MAX_ATTEMPTS) {
        adminOtpStore.delete(key);
        return sendError(res, 400, "Too many attempts. Please request a new code.");
      }

      if (record.otp !== otp) {
        record.attempts += 1;
        adminOtpStore.set(key, record);
        const attemptsLeft = MAX_ATTEMPTS - record.attempts;
        return sendError(res, 400, "Invalid code.", { attemptsLeft: Math.max(0, attemptsLeft) });
      }

      adminOtpStore.delete(key); // OTP is correct, remove from store

      const tempPassword = generateTempPassword(); // generate bootstrap password
      let userRecord;
      try {
        userRecord = await admin.auth().createUser({
          email: rawEmail,
          password: tempPassword,
          displayName: record.displayName,
          phoneNumber: record.phoneNumber || undefined,
          disabled: false
        });
      } catch (createErr) {
        console.error("create admin user failed", createErr && createErr.message);
        return sendError(res, 400, createErr?.message || "Failed to create admin user");
      }

      const uid = userRecord.uid;
      const grantSuper = !!req.body?.grantSuperAdmin;
      try {
        await db.collection("users").doc(uid).set({
          uid,
          email: rawEmail,
          displayName: record.displayName,
          phoneNumber: record.phoneNumber || null,
          role: "admin",
          isSuperAdmin: grantSuper,
          archived: false,
          forcePasswordChange: true,
          createdBy: requester.uid,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        // profile is now persisted under users/{uid}
      } catch (fsErr) {
        console.error("Failed to write Firestore admin doc", fsErr && fsErr.message);
        try {
          await admin.auth().deleteUser(uid);
        } catch (delErr) {
          console.error("Failed to rollback admin user", delErr && delErr.message);
        }
        return sendError(res, 500, "Failed to persist admin user");
      }

      if (mailTransporter) {
        const mailOptions = {
          from: process.env.RESEND_FROM_EMAIL || 'noreply@alphfabet.com',
          to: rawEmail,
          subject: "Your HFA admin account",
          text: `An admin account was created for you.\n\nEmail: ${rawEmail}\nTemporary password: ${tempPassword}\n\nPlease sign in and change your password immediately.`
        };
        try {
          await mailTransporter.sendMail(mailOptions);
        } catch (mailErr) {
          console.warn("Admin credential email failed", mailErr && mailErr.message);
        }
      }

      await writeActivityLog?.({
        actorUid: requester.uid,
        actorEmail: requester.email || null,
        targetUid: uid,
        action: "create-admin",
        detail: `email:${rawEmail}`
      });

      return res.json({ success: true, uid, tempPassword });
    } catch (err) {
      console.error("/admin/create-admin/verify-otp error", err && (err.stack || err));
      return sendError(res, 500, "Server error");
    }
  });

  /* GET /admin/users - list users combining Auth + Firestore profile */
  router.get("/admin/users", requireAdmin, async (req, res) => {
    try {
      const { role: roleFilter, q, limit = 100, archived } = req.query; // read optional filters from query string
      const users = [];

      // fetch from auth
      let nextPageToken = undefined;
      let fetched = 0;
      const maxIterations = 10; // safety to avoid infinite loops
      let iterations = 0;
      do {
        iterations++;
        const page = await admin.auth().listUsers(1000, nextPageToken); // request up to 1000 auth users per page
        users.push(...page.users);
        nextPageToken = page.pageToken;
        fetched += page.users.length;
        if (!nextPageToken || fetched >= 5000 || iterations >= maxIterations) break;
      } while (true);

      // build combined list
      const out = await Promise.all(
        users.map(async (u) => {
          // convert Auth creation time to ISO string for consistent formatting
          const createdAt = u.metadata.creationTime ? new Date(u.metadata.creationTime).toISOString() : null;
          let profile = null;
          try {
            // attempt to retrieve matching Firestore doc for richer metadata
            const doc = await db.collection("users").doc(u.uid).get();
            if (doc.exists) profile = doc.data();
          } catch (err) {
            console.warn("Failed to fetch Firestore profile for", u.uid, err && err.message);
          }

          const role = profile?.role || "applicant";
          const archivedFlag = !!profile?.archived;

          return {
            uid: u.uid,
            displayName: profile?.displayName || u.displayName || null,
            email: profile?.email || u.email || null,
            role,
            archived: archivedFlag,
            status: profile?.status || (u.disabled ? "inactive" : "active"),
            phoneNumber: profile?.phoneNumber || u.phoneNumber || null,
            createdAt,
          };
        })
      );

      let filtered = out;
      if (roleFilter) {
        // keep users whose role matches the requested role (case-insensitive)
        filtered = filtered.filter((u) => (u.role || "").toLowerCase() === roleFilter.toLowerCase());
      }
      if (typeof archived !== "undefined") {
        // show only archived or non-archived accounts depending on query flag
        const wantArchived = archived === "true";
        filtered = filtered.filter((u) => !!u.archived === wantArchived);
      }
      if (q) {
        // text search across display name, email, and uid
        const needle = q.toLowerCase();
        filtered = filtered.filter((u) => {
          return (u.displayName && u.displayName.toLowerCase().includes(needle)) || (u.email && u.email.toLowerCase().includes(needle)) || (u.uid && u.uid.toLowerCase().includes(needle));
        });
      }

      const limited = filtered.slice(0, Number(limit) || 100); // enforce limit
      return res.json({ users: limited });
    } 
    catch (err) {
      console.error("/admin/users error", err && (err.stack || err));
      return res.status(500).json({ error: err.message || "Server error", message: "Failed to list users." });
    }
  });

  /* POST /admin/reset-password -> generate reset link and optionally email */
  router.post("/admin/reset-password", requireSuperAdmin, async (req, res) => {
    try {
      const { uid, notifyUser = false } = req.body; // may optionally email the reset link
      if (!uid) return res.status(400).json({ error: "Missing uid", message: "User id is required." });

      // Get user email (try Firestore first, fallback to Auth)
      let email = null;
      try {
        const profileSnap = await db.collection("users").doc(uid).get();
        if (profileSnap.exists) email = profileSnap.data().email || null;
      } catch (e) {
        console.warn("/admin/reset-password: failed to read profile", e && e.message);
      }
      if (!email) {
        try {
          const userRecord = await admin.auth().getUser(uid);
          email = userRecord.email || null;
        } catch (e) {
          console.error("/admin/reset-password failed to get user", e && e.message);
        }
      }

      if (!email) {
        // cannot generate a reset link without a target email address
        return res.status(400).json({ error: "No email", message: "Cannot locate an email address for this user." });
      }

      // Generate password reset link using the Admin SDK
      let resetLink;
      try {
        resetLink = await admin.auth().generatePasswordResetLink(email);
      } catch (e) {
        console.error("/admin/reset-password generatePasswordResetLink error", e && e.message);
        return res.status(500).json({ error: "Failed to generate reset link", message: "Could not create password reset link." });
      }

      if (notifyUser) {
        if (!mailTransporter) {
          console.warn("/admin/reset-password: mailTransporter not configured, cannot send email");
          return res.status(500).json({ error: "Email not configured", message: "Server email is not configured." });
        }

        const mailOptions = {
          from: process.env.RESEND_FROM_EMAIL || 'noreply@alphfabet.com',
          to: email,
          subject: "HFA Portal Password Reset",
          text: `A password reset link was generated for your account. Use the link below to set a new password:\n\n${resetLink}\n\nIf you did not request this, please contact support immediately.`,
        };

        try {
          await mailTransporter.sendMail(mailOptions);
        } catch (mailErr) {
          console.warn("/admin/reset-password: failed to send email", mailErr && mailErr.message);
          await writeActivityLog?.({
            actorUid: req.adminUser.uid,
            actorEmail: req.adminUser.email,
            targetUid: uid,
            action: "reset-password",
            detail: "generated_link_but_email_failed",
          });
          return res.status(500).json({ error: "Email send failed", message: "Failed to email the reset link. Please try again." });
        }

        await writeActivityLog?.({
          actorUid: req.adminUser.uid,
          actorEmail: req.adminUser.email,
          targetUid: uid,
          action: "reset-password",
          detail: "reset-link-generated-and-emailed",
        });

        return res.json({ success: true, emailed: true, message: "Password reset link emailed to user." });
      }

      await writeActivityLog?.({ // log event whether or not email sent
        actorUid: req.adminUser.uid,
        actorEmail: req.adminUser.email,
        targetUid: uid,
        action: "reset-password",
        detail: "reset-link-generated-not-emailed",
      });

      return res.json({ success: true, emailed: false, message: "Password reset link generated (not emailed)." });
    } catch (err) {
      console.error("/admin/reset-password error", err && (err.stack || err));
      return res.status(500).json({ error: err.message || "Server error", message: "Failed to reset password." });
    }
  });

  // PUT /admin/users/:uid - update profile fields (name, role, phone, status)
  router.put("/admin/users/:uid", requireAdmin, async (req, res) => {
    try {
      const targetUid = req.params.uid;
      if (!targetUid) return res.status(400).json({ error: "Missing uid" });

      const updates = req.body || {}; // incoming fields from client
      const allowedFields = ["displayName", "status", "role", "phoneNumber"];
      const sanitized = {};
      for (const key of allowedFields) {
        if (Object.prototype.hasOwnProperty.call(updates, key)) {
          sanitized[key] = updates[key];
        }
      }

      if (Object.keys(sanitized).length === 0) {
        return res.status(400).json({ error: "No updatable fields provided" });
      }

      // update Firestore profile
      const userRef = db.collection("users").doc(targetUid);
      await userRef.set(
        {
          ...sanitized,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      // if displayName changed, propagate to auth profile AND teacher applicant record
      if (sanitized.displayName) {
        try {
          await admin.auth().updateUser(targetUid, { displayName: sanitized.displayName });
        } catch (e) {
          console.warn("PUT /admin/users: failed to update displayName in Auth", targetUid, e && e.message);
        }
        
        // Sync displayName to teacher applicant record if it exists
        try {
          await syncTeacherApplicantName(db, targetUid, sanitized.displayName);
        } catch (e) {
          console.warn("PUT /admin/users: failed to sync teacher applicant name", targetUid, e && e.message);
          // Don't fail the request if sync fails - this is a best-effort operation
        }
      }

      // optionally update phoneNumber in Auth
      if (sanitized.phoneNumber) {
        try {
          await admin.auth().updateUser(targetUid, { phoneNumber: sanitized.phoneNumber });
        } catch (e) {
          console.warn("PUT /admin/users: failed to update phoneNumber in Auth", targetUid, e && e.message);
        }
      }

      // update status/disable flag if provided
      if (Object.prototype.hasOwnProperty.call(sanitized, "status")) {
        try {
          const disabled = sanitized.status === "inactive";
          await admin.auth().updateUser(targetUid, { disabled });
        } catch (e) {
          // Log the error if updating the disabled flag fails
          console.warn("PUT /admin/users: failed to update Auth disabled flag for", targetUid, e && e.message);
        }
      }

      // Record the update action in the activity log
      await writeActivityLog?.({ 
        actorUid: req.adminUser.uid,
        actorEmail: req.adminUser.email,
        targetUid,
        action: "update-user",
        detail: JSON.stringify(sanitized),
      });

      return res.json({ success: true, updates: sanitized });
    } catch (err) {
      console.error("PUT /admin/users/:uid error", err && (err.stack || err));
      return res.status(500).json({ error: err.message || "Server error" });
    }
  });

  // POST /admin/users/:uid/archive - mark account as archived/disabled
  router.post("/admin/users/:uid/archive", requireSuperAdmin, async (req, res) => {
    try {
      const targetUid = req.params.uid;
      if (!targetUid) return res.status(400).json({ error: "Missing uid" });

      // Prevent archiving the last super admin
      const targetDoc = await db.collection("users").doc(targetUid).get();
      const targetData = targetDoc.exists ? targetDoc.data() : null;
      if (targetData && targetData.isSuperAdmin) {
        const snap = await db.collection("users").where("role","==","admin").where("isSuperAdmin","==",true).get();
        const remaining = snap.size;
        if (remaining <= 1) {
          return res.status(400).json({ error: "Action blocked: this is the last super admin." });
        }
      }

      await db.collection("users").doc(targetUid).set(
        {
          archived: true,
          archivedAt: admin.firestore.FieldValue.serverTimestamp(),
          status: "inactive",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      try {
        await admin.auth().updateUser(targetUid, { disabled: true });
      } catch (e) {
        console.warn("Failed to disable auth for archived user", targetUid, e && e.message);
      }

      await writeActivityLog?.({ // capture archival action
        actorUid: req.adminUser.uid,
        actorEmail: req.adminUser.email,
        targetUid,
        action: "archive-user",
        detail: "archived user",
      });

      return res.json({ success: true, message: "User archived" });
    } catch (err) {
      console.error("POST /admin/users/:uid/archive error", err);
      return res.status(500).json({ error: err.message || "Server error" });
    }
  });

  // POST /admin/users/:uid/unarchive - bring account back to active use
  router.post("/admin/users/:uid/unarchive", requireSuperAdmin, async (req, res) => {
    try {
      const targetUid = req.params.uid;
      if (!targetUid) return res.status(400).json({ error: "Missing uid" });

      await db.collection("users").doc(targetUid).set(
        {
          archived: false,
          archivedAt: null,
          status: "active",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      try {
        await admin.auth().updateUser(targetUid, { disabled: false });
      } catch (e) {
        console.warn("Failed to enable auth for unarchived user", targetUid, e && e.message);
      }

      await writeActivityLog?.({ // capture unarchive action
        actorUid: req.adminUser.uid,
        actorEmail: req.adminUser.email,
        targetUid,
        action: "unarchive-user",
        detail: "unarchived user",
      });

      return res.json({ success: true, message: "User unarchived" });
    } catch (err) {
      console.error("POST /admin/users/:uid/unarchive error", err);
      return res.status(500).json({ error: err.message || "Server error" });
    }
  });

  // DELETE /admin/users/:uid - hard delete (requires archived state)
  router.delete("/admin/users/:uid", requireSuperAdmin, async (req, res) => {
    try {
      const targetUid = req.params.uid;
      if (!targetUid) return res.status(400).json({ error: "Missing uid" });

      const userDoc = await db.collection("users").doc(targetUid).get();
      if (userDoc.exists) {
        const data = userDoc.data();
        // Prevent deleting the last super admin
        if (data.isSuperAdmin) {
          const snap = await db.collection("users").where("role","==","admin").where("isSuperAdmin","==",true).get();
          if (snap.size <= 1) {
            return res.status(400).json({ error: "Action blocked: this is the last super admin." });
          }
        }
        if (!data.archived) {
          return res.status(400).json({ error: "Must be archived", message: "User must be archived before permanent deletion." });
        }
      }

      await db.collection("users").doc(targetUid).delete(); // remove profile doc
      try {
        await admin.auth().deleteUser(targetUid);
      } catch (e) {
        console.warn("Failed to delete auth user for", targetUid, e && e.message);
      }

      await writeActivityLog?.({
        actorUid: req.adminUser.uid,
        actorEmail: req.adminUser.email,
        targetUid,
        action: "delete-user",
        detail: "hard delete after archive",
      });

      return res.json({ success: true, message: "User permanently deleted" });
    } catch (err) {
      console.error("DELETE /admin/users/:uid error", err);
      return res.status(500).json({ error: err.message || "Server error" });
    }
  });
  // POST /admin/users/sync-all-teacher-names - One-time sync all teacher applicant names
  router.post("/admin/users/sync-all-teacher-names", requireAdmin, async (req, res) => {
    try {
      console.log('✅ Sync route called! Starting bulk teacher name sync...');
      
      let syncedCount = 0;
      let skippedCount = 0;
      
      // Get all teacher applicants with uid
      const applicantsSnapshot = await db.collection('teacherApplicants')
        .where('uid', '!=', null)
        .get();
      
      // Process each applicant
      for (const applicantDoc of applicantsSnapshot.docs) {
        const applicantData = applicantDoc.data();
        const uid = applicantData.uid;
        
        try {
          // Get user record
          const userDoc = await db.collection('users').doc(uid).get();
          
          if (!userDoc.exists || !userDoc.data().displayName) {
            skippedCount++;
            continue;
          }
          
          const displayName = userDoc.data().displayName;
          const { firstName, middleName, lastName } = parseDisplayName(displayName);
          
          // Check if update is needed
          if (applicantData.firstName === firstName && 
              applicantData.middleName === middleName && 
              applicantData.lastName === lastName) {
            skippedCount++;
            continue;
          }
          
          // Update the teacher applicant
          await applicantDoc.ref.update({
            firstName: firstName || '',
            middleName: middleName || '',
            lastName: lastName || '',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          
          syncedCount++;
        } catch (error) {
          console.error(`Error syncing applicant ${applicantDoc.id}:`, error.message);
          skippedCount++;
        }
      }
      
      // Log the bulk sync action
      await writeActivityLog?.({
        actorUid: req.adminUser.uid,
        actorEmail: req.adminUser.email,
        action: "bulk-sync-teacher-names",
        detail: `Synced ${syncedCount} records, skipped ${skippedCount}`,
      });
      
      return res.json({ 
        success: true, 
        synced: syncedCount, 
        skipped: skippedCount,
        total: applicantsSnapshot.size 
      });
      
    } catch (err) {
      console.error("POST /admin/users/sync-all-teacher-names error", err);
      return res.status(500).json({ error: err.message || "Server error" });
    }
  });

  return router;
}
