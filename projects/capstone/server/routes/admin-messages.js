// server/routes/admin-messages.js
import express from "express";

export default function createAdminMessagesRouter(deps = {}) {
  const {
    db,
    mailTransporter,
    writeActivityLog,
    requireAdmin // should be passed from server.mjs when mounting
  } = deps;

  const router = express.Router();

  // sends a message
  router.post("/admin/send-message", requireAdmin, async (req, res) => {
    try {
      const { studentId, email, subject, message } = req.body || {};
      if (!studentId || !email || !subject || !message) {
        return res.status(400).json({ ok: false, error: "Missing required fields (studentId, email, subject, message)" });
      }

      // Find the student document (shsApplicants or jhsApplicants)
      const shsRef = db.collection("shsApplicants").doc(studentId);
      const shsSnap = await shsRef.get();
      const jhsRef = db.collection("jhsApplicants").doc(studentId);
      const jhsSnap = await jhsRef.get();

      let appSnap = null;
      let collectionName = null;
      if (shsSnap.exists) { appSnap = shsSnap; collectionName = "shsApplicants"; }
      else if (jhsSnap.exists) { appSnap = jhsSnap; collectionName = "jhsApplicants"; }
      else {
        return res.status(404).json({ ok: false, error: "Student application not found" });
      }

      const appData = appSnap.data() || {};
      const storedEmail = (appData.email || appData.contactEmail || "").toString().trim().toLowerCase();

      // If the stored doc has an email and it doesn't match the provided email, reject to avoid misuse
      if (storedEmail && storedEmail !== String(email).trim().toLowerCase()) {
        console.warn("/api/admin/send-message email mismatch", { studentId, storedEmail, provided: email });
        return res.status(403).json({ ok: false, error: "Provided email does not match student record" });
      }

      // Build email payload (HTML)
      const html = `
        <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, 'Helvetica Neue', Arial; line-height:1.4;">
          ${message.replace(/\n/g, "<br>")}
        </div>
      `;

      // Use Resend FROM email (must be from verified domain)
      const fromAddress = (process.env.RESEND_FROM_EMAIL || "noreply@alphfabet.com");

      const mailOptions = {
        from: `"AlpHFAbet: Holy Family Academy" <${fromAddress}>`,
        to: email,
        subject: subject,
        html
      };
      try {
        const result = await mailTransporter.sendMail(mailOptions);
        console.log(`✅ [admin-messages] Email sent successfully!`, result);
      } catch (mailErr) {
        console.error("❌ [admin-messages] sendMail failed");
        console.error("Error details:", {
          message: mailErr?.message,
          code: mailErr?.code,
          statusCode: mailErr?.statusCode,
          stack: mailErr?.stack
        });
        return res.status(500).json({ ok: false, error: "Failed to send email", detail: mailErr && (mailErr.message || String(mailErr)) });
      }

      // write activity  requireAdmin attaches req.adminUser
      try {
        await writeActivityLog && writeActivityLog({
          actorUid: (req.adminUser && req.adminUser.uid) || null,
          actorEmail: (req.adminUser && req.adminUser.email) || null,
          targetUid: studentId,
          action: "admin-send-message",
          detail: `to:${email} subject:${subject}`
        });
      } catch (logErr) {
        console.warn("/api/admin/send-message writeActivityLog failed", logErr && logErr.message);
      }

      console.log("/api/admin/send-message ok", { studentId, email });
      return res.json({ ok: true, message: "Email sent" });
    } catch (err) {
      console.error("/api/admin/send-message error", err && (err.stack || err));
      return res.status(500).json({ ok: false, error: "Server error", message: err && err.message });
    }
  });

  return router;
}
