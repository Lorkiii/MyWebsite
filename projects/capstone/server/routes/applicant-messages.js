// server/routes/applicant-messages.js
import express from "express";

export default function createApplicantMessagesRouter({
  dbClient,
  requireAuth,
  } = {}) {
  if (!dbClient) throw new Error("dbClient is required");

  const router = express.Router();

  // POST /api/applicant-messages
  router.post("/", requireAuth, async (req, res) => {
    try {
      const body = req.body || {};
      const applicantId = String(body.applicantId || "").trim();
      const subject = body.subject || "";
      const bodyText = body.body || "";

      if (!applicantId || !bodyText)
        return res.status(400).json({ ok: false, error: "Missing fields" });

      const user = req.user || {};
      const uid = user.uid || null;
      const isAdmin = !!user.isAdmin;

      console.log(
        "[applicant-messages:post] user.uid ->",
        uid,
        "applicantId ->",
        applicantId,
        "isAdmin ->",
        isAdmin
      );

      // ALWAYS fetch the applicant doc to confirm ownership
      let applicantDoc = null;
      try {
        applicantDoc = await dbClient.getApplicantById(applicantId);
      } catch (dbErr) {
        console.error(
          "[applicant-messages:post] failed getApplicantById",
          dbErr && (dbErr.stack || dbErr)
        );
        return res.status(500).json({
          ok: false,
          error: "Server error",
          details: dbErr && dbErr.message,
        });
      }

      if (!applicantDoc) {
        return res
          .status(404)
          .json({ ok: false, error: "Applicant not found" });
      }

      // Ownership check: authenticated user's UID must match the applicant.uid OR user must be admin
      const ownerUid = applicantDoc.uid || null;
      const isOwner = !!(uid && ownerUid && String(uid) === String(ownerUid));

      if (!isOwner && !isAdmin) {
        console.warn("[applicant-messages:post] authorization failed", {
          uid,
          ownerUid,
          isOwner,
          isAdmin,
        });
        return res
          .status(403)
          .json({ ok: false, error: "Not authorized for this applicant" });
      }

      const msg = {
        applicantId,
        fromUid: uid,
        senderName: user.name || user.email || "Applicant",
        senderEmail: user.email || "",
        subject: subject || "",
        body: bodyText,
        recipients: ["admin"],
        createdAt: new Date().toISOString(),
      };

      const result = await dbClient.insertMessage(msg);

      // Create notification for admins (best-effort)
      (async () => {
        try {
          const admins = await dbClient.getAdminUsers();
          if (Array.isArray(admins) && admins.length) {
            const notif = {
              type: "applicant_message",
              applicantId,
              messageId: result.id || null,
              createdAt: new Date().toISOString(),
              seenBy: [],
            };
            await dbClient.insertNotification(notif);
          }
        } catch (e) {
          console.warn(
            "[applicant-messages:post] notif error",
            e && (e.stack || e)
          );
        }
      })();

      return res.json({
        ok: true,
        messageId: result.id || null,
        createdAt: msg.createdAt,
      });
    } catch (err) {
      console.error(
        "[applicant-messages:post] unexpected error",
        err && (err.stack || err)
      );
      return res.status(500).json({
        ok: false,
        error: "Server error",
        details: err && err.message,
      });
    }
  });

  // GET /api/applicant-messages/:applicantId
  router.get("/:applicantId", requireAuth, async (req, res) => {
    try {
      const applicantId = String(req.params.applicantId || "").trim();
      if (!applicantId)
        return res
          .status(400)
          .json({ ok: false, error: "Missing applicantId" });

      const user = req.user || {};
      const uid = user.uid || null;
      const isAdmin = !!user.isAdmin;

      console.log(`[applicant-messages:get] ========== GET MESSAGES REQUEST ==========`);
      console.log(`[applicant-messages:get] Request from user UID: ${uid}`);
      console.log(`[applicant-messages:get] Requested applicantId: ${applicantId}`);
      console.log(`[applicant-messages:get] User is admin: ${isAdmin}`);
      console.log(`[applicant-messages:get] User role: ${user.role || 'unknown'}`);

      // Fetch applicant doc and verify ownership
      let applicantDoc = null;
      try {
        applicantDoc = await dbClient.getApplicantById(applicantId);
      } catch (dbErr) {
        console.error(
          "[applicant-messages:get] failed getApplicantById",
          dbErr && (dbErr.stack || dbErr)
        );
        return res.status(500).json({
          ok: false,
          error: "Server error",
          details: dbErr && dbErr.message,
        });
      }

      if (!applicantDoc) {
        return res
          .status(404)
          .json({ ok: false, error: "Applicant not found" });
      }

      const ownerUid = applicantDoc.uid || null;
      const isOwner = !!(uid && ownerUid && String(uid) === String(ownerUid));

      if (!isOwner && !isAdmin) {
        console.warn("[applicant-messages:get] authorization failed", {
          uid,
          ownerUid,
          isOwner,
          isAdmin,
        });
        return res.status(403).json({ ok: false, error: "Not authorized" });
      }

      // Fetch messages
      let messages;
      try {
        console.log(`[applicant-messages:get] 🔍 Fetching messages from database...`);
        messages = await dbClient.getMessagesForApplicant(applicantId);
        console.log(`[applicant-messages:get] ✅ Fetched ${messages.length} messages from database`);
      } catch (dbErr) {
        console.error(
          "[applicant-messages:get] getMessagesForApplicant failed",
          dbErr && (dbErr.stack || dbErr)
        );
        // detect index-required error from dbClient (it may set a custom code or include text)
        const msg = (dbErr && dbErr.message) ? String(dbErr.message).toLowerCase() : "";
        if (dbErr && dbErr.code === 'INDEX_REQUIRED') {
          return res.status(503).json({
            ok: false,
            error: 'Index required',
            details: 'Firestore requires a composite index for applicant_messages (applicantId, createdAt). Please create the index and retry.'
          });
        }
        if (msg.includes('requires an index') || msg.includes('failed_precondition') || msg.includes('index')) {
          return res.status(503).json({
            ok: false,
            error: 'Index required',
            details: 'Firestore requires a composite index for this query. Please create the index and retry.'
          });
        }

        return res.status(500).json({
          ok: false,
          error: "Server error",
          details: dbErr && dbErr.message,
        });
      }
      
      return res.json({ ok: true, messages });
    } catch (err) {
      console.error(
        "[applicant-messages:get] unexpected error",
        err && (err.stack || err)
      );
      return res.status(500).json({
        ok: false,
        error: "Server error",
        details: err && err.message,
      });
    }
  });

  return router;
}
