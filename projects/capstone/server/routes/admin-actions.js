// server/routes/admin-actions.js
// Adds admin-only endpoints for approve/reject/archive/progress-notes.
// Usage: app.use('/api', createAdminActionsRouter({ db, admin, requireAdmin, writeActivityLog }))

import express from "express";

export default function createAdminActionsRouter(deps = {}) {
  const { db, admin, requireAdmin, writeActivityLog } = deps;
  if (!db) throw new Error("createAdminActionsRouter requires deps.db (Firestore instance)");
  if (!admin) throw new Error("createAdminActionsRouter requires deps.admin (firebase-admin)");

  const router = express.Router();

  // Helper: best-effort activity logging
  async function safeLog(evt = {}) {
    try {
      if (typeof writeActivityLog === "function") {
        await writeActivityLog(evt);
      } else {
        // fallback: try writing directly to activityLogs if available
        if (db && db.collection) {
          await db.collection("activityLogs").add({
            actorUid: evt.actorUid || null,
            actorEmail: evt.actorEmail || null,
            action: evt.action || null,
            targetType: evt.targetType || "teacherApplicant",
            targetId: evt.targetId || null,
            detail: evt.detail || null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      }
    } catch (err) {
      console.warn("safeLog failed", err && (err.stack || err));
    }
  }

  // POST /api/applicants/:id/approve
  router.post("/applicants/:id/approve", requireAdmin, async (req, res) => {
    const applicantId = req.params.id;
    const reason = (req.body && req.body.reason) || null;
    if (!applicantId) return res.status(400).json({ ok: false, error: "Missing applicant id" });

    try {
      const appRef = db.collection("teacherApplicants").doc(applicantId);
      const result = await db.runTransaction(async (t) => {
        const snap = await t.get(appRef);
        if (!snap.exists) return { notFound: true };
        t.update(appRef, {
          status: "approved",
          approvedAt: admin.firestore.FieldValue.serverTimestamp(),
          statusUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          statusUpdatedBy: (req.adminUser && req.adminUser.uid) || null,
          approvedReason: reason || null,
        });
        return { ok: true };
      });

      if (result && result.notFound) return res.status(404).json({ ok: false, error: "Applicant not found" });

      // write activity log
      await safeLog({
        actorUid: (req.adminUser && req.adminUser.uid) || null,
        actorEmail: (req.adminUser && req.adminUser.email) || null,
        action: "approve-applicant",
        targetType: "teacherApplicant",
        targetId: applicantId,
        detail: `reason:${reason || ""}`,
      });

      // return updated doc snapshot (best-effort read)
      const finalSnap = await appRef.get();
      return res.json({ ok: true, applicant: { id: finalSnap.id, ...finalSnap.data() } });
    } catch (err) {
      console.error("POST /applicants/:id/approve error", err && (err.stack || err));
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  });

  // POST /api/applicants/:id/reject
  router.post("/applicants/:id/reject", requireAdmin, async (req, res) => {
    const applicantId = req.params.id;
    const reason = (req.body && req.body.reason) || null;
    if (!applicantId) return res.status(400).json({ ok: false, error: "Missing applicant id" });

    try {
      const appRef = db.collection("teacherApplicants").doc(applicantId);
      const result = await db.runTransaction(async (t) => {
        const snap = await t.get(appRef);
        if (!snap.exists) return { notFound: true };
        t.update(appRef, {
          status: "rejected",
          rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
          rejectedReason: reason || null,
          statusUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          statusUpdatedBy: (req.adminUser && req.adminUser.uid) || null,
        });
        return { ok: true };
      });

      if (result && result.notFound) return res.status(404).json({ ok: false, error: "Applicant not found" });

      await safeLog({
        actorUid: (req.adminUser && req.adminUser.uid) || null,
        actorEmail: (req.adminUser && req.adminUser.email) || null,
        action: "reject-applicant",
        targetType: "teacherApplicant",
        targetId: applicantId,
        detail: `reason:${reason || ""}`,
      });

      const finalSnap = await appRef.get();
      return res.json({ ok: true, applicant: { id: finalSnap.id, ...finalSnap.data() } });
    } catch (err) {
      console.error("POST /applicants/:id/reject error", err && (err.stack || err));
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  });

  // POST /api/applicants/:id/archive
  router.post("/applicants/:id/archive", requireAdmin, async (req, res) => {
    const applicantId = req.params.id;
    if (!applicantId) return res.status(400).json({ ok: false, error: "Missing applicant id" });

    try {
      const appRef = db.collection("teacherApplicants").doc(applicantId);
      const result = await db.runTransaction(async (t) => {
        const snap = await t.get(appRef);
        if (!snap.exists) return { notFound: true };
        t.update(appRef, {
          archived: true,
          archivedAt: admin.firestore.FieldValue.serverTimestamp(),
          statusUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          statusUpdatedBy: (req.adminUser && req.adminUser.uid) || null,
        });
        return { ok: true };
      });

      if (result && result.notFound) return res.status(404).json({ ok: false, error: "Applicant not found" });

      await safeLog({
        actorUid: (req.adminUser && req.adminUser.uid) || null,
        actorEmail: (req.adminUser && req.adminUser.email) || null,
        action: "archive-applicant",
        targetType: "teacherApplicant",
        targetId: applicantId,
        detail: `archived`,
      });

      const finalSnap = await appRef.get();
      return res.json({ ok: true, applicant: { id: finalSnap.id, ...finalSnap.data() } });
    } catch (err) {
      console.error("POST /applicants/:id/archive error", err && (err.stack || err));
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  });

  // POST /api/applicants/:id/archive/undo
  router.post("/applicants/:id/archive/undo", requireAdmin, async (req, res) => {
    const applicantId = req.params.id;
    if (!applicantId) return res.status(400).json({ ok: false, error: "Missing applicant id" });

    try {
      const appRef = db.collection("teacherApplicants").doc(applicantId);
      const result = await db.runTransaction(async (t) => {
        const snap = await t.get(appRef);
        if (!snap.exists) return { notFound: true };
        t.update(appRef, {
          archived: admin.firestore.FieldValue.delete(),
          archivedAt: admin.firestore.FieldValue.delete(),
          statusUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          statusUpdatedBy: (req.adminUser && req.adminUser.uid) || null,
        });
        return { ok: true };
      });

      if (result && result.notFound) return res.status(404).json({ ok: false, error: "Applicant not found" });

      await safeLog({
        actorUid: (req.adminUser && req.adminUser.uid) || null,
        actorEmail: (req.adminUser && req.adminUser.email) || null,
        action: "archive-undo",
        targetType: "teacherApplicant",
        targetId: applicantId,
        detail: `archive undone`,
      });

      const finalSnap = await appRef.get();
      return res.json({ ok: true, applicant: { id: finalSnap.id, ...finalSnap.data() } });
    } catch (err) {
      console.error("POST /applicants/:id/archive/undo error", err && (err.stack || err));
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  });


  return router;
}
