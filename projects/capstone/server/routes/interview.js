// server/routes/interviews.js
import express from "express";

/**
 * createInterviewsRouter({ db, admin, requireAdmin, writeActivityLog })
 * - db: Firestore instance (admin.firestore())
 * - admin: firebase-admin module (for FieldValue)
 * - requireAdmin: middleware that attaches req.adminUser
 * - writeActivityLog: function({ actorUid, actorEmail, targetUid, action, detail })
 */
export default function createInterviewsRouter(deps = {}) {
  const { db, admin, requireAdmin, writeActivityLog } = deps;
  if (!db)
    throw new Error(
      "createInterviewsRouter requires deps.db (Firestore instance)"
    );
  if (!admin)
    throw new Error(
      "createInterviewsRouter requires deps.admin (firebase-admin)"
    );

  const router = express.Router();

  // Helper: validate basic interview object
  function normalizeInterviewPayload(body = {}) {
    const datetimeISO = (body.datetimeISO || body.datetime || "")
      .toString()
      .trim();
    const date = (body.date || "").toString().trim();
    const time = (body.time || "").toString().trim();
    const mode = (body.mode || "").toString().trim();
    const location = (body.location || "").toString().trim();
    const notes = (body.notes || "").toString().trim();

    return { datetimeISO, date, time, mode, location, notes };
  }

  // Helper: write activity log if provided (best-effort)
  async function safeWriteActivityLog(evt = {}) {
    try {
      if (typeof writeActivityLog === "function") await writeActivityLog(evt);
    } catch (err) {
      // don't crash route if logging fails; just warn
      console.warn("writeActivityLog failed", err && (err.stack || err));
    }
  }

  // Compatibility wrapper for old client endpoint: POST /api/scheduleInterview
  // Body: { applicantId, interview: { datetimeISO, date, time, mode, location, notes } }
  router.post("/scheduleInterview", requireAdmin, async (req, res) => {
    try {
      const applicantId = req.body && req.body.applicantId;
      const interviewBody = req.body && (req.body.interview || req.body);
      if (!applicantId)
        return res
          .status(400)
          .json({ ok: false, error: "Missing applicantId" });

      // Reuse the create scheduling logic below
      req.params.applicantId = applicantId;
      req.body = interviewBody;
      // call internal handler
      return await handleCreateInterview(req, res);
    } catch (err) {
      console.error("/api/scheduleInterview error", err && (err.stack || err));
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  });

  // POST /api/applicants/:applicantId/interview
  router.post(
    "/applicants/:applicantId/interview",
    requireAdmin,
    async (req, res) => {
      return handleCreateInterview(req, res);
    }
  );

  async function handleCreateInterview(req, res) {
    const applicantId = req.params.applicantId;
    if (!applicantId)
      return res
        .status(400)
        .json({ ok: false, error: "Missing applicantId param" });

    const iv = normalizeInterviewPayload(req.body || {});
    if (!iv.datetimeISO)
      return res.status(400).json({ ok: false, error: "Missing datetimeISO" });

    try {
      // Quick existence check for applicant (not required but gives clearer 404 early)
      const appRef = db.collection("teacherApplicants").doc(applicantId);
      const appSnap = await appRef.get();
      if (!appSnap.exists)
        return res
          .status(404)
          .json({ ok: false, error: "Applicant not found" });

      // Transaction: check conflict, create interview doc, update applicant
      const result = await db.runTransaction(async (t) => {
        // Conflict check: exact datetimeISO
        const conflictQuery = db
          .collection("interviews")
          .where("datetimeISO", "==", iv.datetimeISO)
          .limit(1);
        const conflictSnap = await t.get(conflictQuery);
        if (!conflictSnap.empty) {
          const first = conflictSnap.docs[0];
          // conflict found
          return { conflict: { id: first.id, data: first.data() } };
        }

        // create interview doc
        const interviewsCol = db.collection("interviews");
        const newRef = interviewsCol.doc(); // auto id
        const interviewObj = {
          applicantId,
          datetimeISO: iv.datetimeISO,
          date: iv.date || null,
          time: iv.time || null,
          mode: iv.mode || null,
          location: iv.location || null,
          notes: iv.notes || null,
          scheduledBy: (req.adminUser && req.adminUser.uid) || null,
          scheduledByEmail: (req.adminUser && req.adminUser.email) || null,
          scheduledAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        t.set(newRef, interviewObj);

        // update applicant doc
        const applicantUpdate = {
          interview: {
            id: newRef.id,
            datetimeISO: interviewObj.datetimeISO,
            date: interviewObj.date,
            time: interviewObj.time,
            mode: interviewObj.mode,
            location: interviewObj.location,
            notes: interviewObj.notes,
          },
          status: "interview_scheduled",
          statusUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          statusUpdatedBy: (req.adminUser && req.adminUser.uid) || null,
        };
        t.set(appRef, applicantUpdate, { merge: true });

        // return creation info
        return {
          created: true,
          interviewId: newRef.id,
          interview: interviewObj,
        };
      });

      if (result && result.conflict) {
        return res.status(409).json({
          ok: false,
          error: "Scheduling conflict",
          conflict: { id: result.conflict.id, data: result.conflict.data },
        });
      }

      // success: write activity log
      await safeWriteActivityLog({
        actorUid: (req.adminUser && req.adminUser.uid) || null,
        actorEmail: (req.adminUser && req.adminUser.email) || null,
        targetUid: applicantId,
        action: "schedule-interview",
        detail: `interviewId:${result.interviewId} datetime:${iv.datetimeISO}`,
      });

      return res
        .status(201)
        .json({
          ok: true,
          interviewId: result.interviewId,
          interview: result.interview,
        });
    } catch (err) {
      console.error(
        "POST /applicants/:applicantId/interview error",
        err && (err.stack || err)
      );
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  }

  // PUT /api/applicants/:applicantId/interview/:interviewId  (reschedule/update)
  router.put(
    "/applicants/:applicantId/interview/:interviewId",
    requireAdmin,
    async (req, res) => {
      const applicantId = req.params.applicantId;
      const interviewId = req.params.interviewId;
      if (!applicantId || !interviewId)
        return res.status(400).json({ ok: false, error: "Missing params" });

      const iv = normalizeInterviewPayload(req.body || {});
      if (!iv.datetimeISO)
        return res
          .status(400)
          .json({ ok: false, error: "Missing datetimeISO" });

      try {
        // Ensure applicant exists
        const appRef = db.collection("teacherApplicants").doc(applicantId);
        const appSnap = await appRef.get();
        if (!appSnap.exists)
          return res
            .status(404)
            .json({ ok: false, error: "Applicant not found" });

        const interviewRef = db.collection("interviews").doc(interviewId);

        const result = await db.runTransaction(async (t) => {
          const interviewSnap = await t.get(interviewRef);
          if (!interviewSnap.exists) return { notFound: true };

          const interviewData = interviewSnap.data() || {};
          if (String(interviewData.applicantId || "") !== String(applicantId)) {
            return { mismatch: true };
          }

          // conflict check (exclude this interviewId)
          const conflictQuery = db
            .collection("interviews")
            .where("datetimeISO", "==", iv.datetimeISO)
            .limit(1);
          const conflictSnap = await t.get(conflictQuery);
          if (!conflictSnap.empty) {
            const first = conflictSnap.docs[0];
            if (first.id !== interviewId) {
              return { conflict: { id: first.id, data: first.data() } };
            }
          }

          // patch interview
          const interviewPatch = {
            datetimeISO: iv.datetimeISO,
            date: iv.date || null,
            time: iv.time || null,
            mode: iv.mode || null,
            location: iv.location || null,
            notes: iv.notes || null,
            updatedBy: (req.adminUser && req.adminUser.uid) || null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          };
          t.update(interviewRef, interviewPatch);

          // update applicant.interview
          const applicantInterview = {
            id: interviewId,
            datetimeISO: interviewPatch.datetimeISO,
            date: interviewPatch.date,
            time: interviewPatch.time,
            mode: interviewPatch.mode,
            location: interviewPatch.location,
            notes: interviewPatch.notes,
          };
          t.set(
            appRef,
            {
              interview: applicantInterview,
              status: "interview_scheduled",
              statusUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
              statusUpdatedBy: (req.adminUser && req.adminUser.uid) || null,
            },
            { merge: true }
          );

          return { updated: true, interviewId, interview: applicantInterview };
        });

        if (result.notFound)
          return res
            .status(404)
            .json({ ok: false, error: "Interview not found" });
        if (result.mismatch)
          return res
            .status(400)
            .json({
              ok: false,
              error: "Interview does not belong to applicant",
            });
        if (result.conflict)
          return res
            .status(409)
            .json({
              ok: false,
              error: "Scheduling conflict",
              conflict: result.conflict,
            });

        await safeWriteActivityLog({
          actorUid: (req.adminUser && req.adminUser.uid) || null,
          actorEmail: (req.adminUser && req.adminUser.email) || null,
          targetUid: applicantId,
          action: "reschedule-interview",
          detail: `interviewId:${interviewId} datetime:${iv.datetimeISO}`,
        });

        return res.json({
          ok: true,
          interviewId: result.interviewId,
          interview: result.interview,
        });
      } catch (err) {
        console.error(
          "PUT /applicants/:applicantId/interview/:interviewId error",
          err && (err.stack || err)
        );
        return res.status(500).json({ ok: false, error: "Server error" });
      }
    }
  );

  // DELETE /api/applicants/:applicantId/interview/:interviewId
  // Cancel interview, remove applicant.interview, set status => "reviewing"
  router.delete(
    "/applicants/:applicantId/interview/:interviewId",
    requireAdmin,
    async (req, res) => {
      const applicantId = req.params.applicantId;
      const interviewId = req.params.interviewId;
      if (!applicantId || !interviewId)
        return res.status(400).json({ ok: false, error: "Missing params" });

      try {
        const appRef = db.collection("teacherApplicants").doc(applicantId);
        const interviewRef = db.collection("interviews").doc(interviewId);

        const result = await db.runTransaction(async (t) => {
          const interviewSnap = await t.get(interviewRef);
          if (!interviewSnap.exists) return { notFound: true };

          const interviewData = interviewSnap.data() || {};
          if (String(interviewData.applicantId || "") !== String(applicantId)) {
            return { mismatch: true };
          }

          // delete interview doc
          t.delete(interviewRef);

          // remove interview field from applicant and set status -> reviewing
          t.update(appRef, {
            interview: admin.firestore.FieldValue.delete(),
            status: "reviewing",
            statusUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            statusUpdatedBy: (req.adminUser && req.adminUser.uid) || null,
          });

          return { deleted: true };
        });

        if (result.notFound)
          return res
            .status(404)
            .json({ ok: false, error: "Interview not found" });
        if (result.mismatch)
          return res
            .status(400)
            .json({
              ok: false,
              error: "Interview does not belong to applicant",
            });

        await safeWriteActivityLog({
          actorUid: (req.adminUser && req.adminUser.uid) || null,
          actorEmail: (req.adminUser && req.adminUser.email) || null,
          targetUid: applicantId,
          action: "cancel-interview",
          detail: `interviewId:${interviewId}`,
        });

        return res.json({ ok: true });
      } catch (err) {
        console.error(
          "DELETE /applicants/:applicantId/interview/:interviewId error",
          err && (err.stack || err)
        );
        return res.status(500).json({ ok: false, error: "Server error" });
      }
    }
  );

  // GET /api/interviews/conflicts?datetimeISO=...
  router.get("/interviews/conflicts", requireAdmin, async (req, res) => {
    const datetimeISO = (req.query.datetimeISO || "").toString().trim();
    if (!datetimeISO)
      return res
        .status(400)
        .json({ ok: false, error: "Missing datetimeISO query param" });

    try {
      const q = db
        .collection("interviews")
        .where("datetimeISO", "==", datetimeISO)
        .limit(50);
      const snap = await q.get();
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      return res.json({ ok: true, count: items.length, items });
    } catch (err) {
      console.error(
        "GET /interviews/conflicts error",
        err && (err.stack || err)
      );
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  });

  return router;
}
