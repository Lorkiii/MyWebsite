// server/dbClient.js

export default function createDbClient({ db, admin } = {}) {
  if (!db) throw new Error("db (Firestore) must be provided to dbClient");
  if (!admin)
    throw new Error("admin (firebase-admin) must be provided to dbClient");

  return {
    // Insert new message into applicant_messages collection
    insertMessage: async (msg) => {
      console.log(`[dbClient.insertMessage] ========== INSERTING TO FIRESTORE ==========`);
      console.log(`[dbClient.insertMessage] Input applicantId: ${msg.applicantId}`);
      console.log(`[dbClient.insertMessage] Input subject: ${msg.subject}`);
      console.log(`[dbClient.insertMessage] Input has attachment: ${!!msg.attachment}`);
      
      const payload = {
        applicantId: msg.applicantId || null,
        fromUid: msg.fromUid || null,
        senderName: msg.senderName || null,
        senderEmail: msg.senderEmail || null,
        subject: msg.subject || "",
        body: msg.body || "",
        recipients: Array.isArray(msg.recipients)
          ? msg.recipients
          : msg.recipients
          ? [msg.recipients]
          : [],
        attachment: msg.attachment || null, // Include attachment metadata
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        isArchived: false, // Initialize as not archived
        archivedAt: null   // Initialize as null
      };
      
      console.log(`[dbClient.insertMessage] Payload to save:`, JSON.stringify({
        ...payload,
        createdAt: '[ServerTimestamp]'
      }, null, 2));
      
      const docRef = await db.collection("applicant_messages").add(payload);
      console.log(`[dbClient.insertMessage] ✅ Document created with ID: ${docRef.id}`);
      console.log(`[dbClient.insertMessage] Collection: applicant_messages`);
      console.log(`[dbClient.insertMessage] =================================================`);
      return { id: docRef.id };
    },

    // Return admin users from users collection (uid, email, name)
    getAdminUsers: async () => {
      const snap = await db
        .collection("users")
        .where("role", "==", "admin")
        .get();
      return snap.docs.map((d) => {
        const data = d.data() || {};
        return {
          uid: d.id,
          email: data.email || null,
          name: data.displayName || data.name || null,
        };
      });
    },

    // Insert a basic notification record
    insertNotification: async (notif) => {
      const payload = {
        type: notif.type || "applicant_message",
        applicantId: notif.applicantId || null,
        messageId: notif.messageId || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        seenBy: Array.isArray(notif.seenBy) ? notif.seenBy : [],
      };
      const docRef = await db.collection("notifications").add(payload);
      return { id: docRef.id };
    },

    // Get messages for an applicant (returns array with createdAt as ISO string)
    getMessagesForApplicant: async (applicantId) => {
      console.log(`[dbClient.getMessagesForApplicant] ========== QUERYING MESSAGES ==========`);
      console.log(`[dbClient.getMessagesForApplicant] Query applicantId: ${applicantId}`);
      
      if (!applicantId) {
        console.warn(`[dbClient.getMessagesForApplicant] ⚠️ No applicantId provided - returning empty array`);
        return [];
      }
      
      try {
        console.log(`[dbClient.getMessagesForApplicant] Querying collection: applicant_messages`);
        console.log(`[dbClient.getMessagesForApplicant] Where: applicantId == ${applicantId}`);
        console.log(`[dbClient.getMessagesForApplicant] OrderBy: createdAt ASC`);
        
        const snap = await db
          .collection("applicant_messages")
          .where("applicantId", "==", applicantId)
          .orderBy("createdAt", "asc")
          .get();

        console.log(`[dbClient.getMessagesForApplicant] ✅ Query completed - found ${snap.docs.length} documents`);
        
        if (snap.docs.length > 0) {
          console.log(`[dbClient.getMessagesForApplicant] Documents found:`);
          snap.docs.forEach((doc, index) => {
            const data = doc.data();
            console.log(`  ${index + 1}. Doc ID: ${doc.id}`);
            console.log(`     - applicantId: ${data.applicantId}`);
            console.log(`     - subject: ${data.subject}`);
            console.log(`     - senderEmail: ${data.senderEmail}`);
            console.log(`     - createdAt: ${data.createdAt ? data.createdAt.toDate?.() : 'N/A'}`);
          });
        } else {
          console.log(`[dbClient.getMessagesForApplicant] ⚠️ No documents found matching applicantId: ${applicantId}`);
        }
        console.log(`[dbClient.getMessagesForApplicant] =============================================`);

        return snap.docs.map((d) => {
          const data = d.data() || {};
          let createdAt = null;
          try {
            if (data.createdAt && typeof data.createdAt.toDate === "function") {
              createdAt = data.createdAt.toDate().toISOString();
            } else if (data.createdAt) {
              createdAt = String(data.createdAt);
            }
          } catch (e) {
            createdAt = null;
          }
          return {
            id: d.id,
            applicantId: data.applicantId,
            fromUid: data.fromUid,
            senderName: data.senderName,
            senderEmail: data.senderEmail,
            subject: data.subject,
            body: data.body,
            recipients: data.recipients || [],
            attachment: data.attachment || null,
            createdAt,
          };
        });
      } catch (err) {
        // Friendly handling for missing composite index (Firestore returns "requires an index" in message)
        const msg = err && err.message ? String(err.message) : "";
        if (
          msg.toLowerCase().includes("requires an index") ||
          msg.toLowerCase().includes("failed_precondition")
        ) {
          console.error(
            "dbClient.getMessagesForApplicant - missing index",
            err
          );
          // Throw a custom Error that routes can catch, or return a rejected Promise with a friendly shape
          const e = new Error(
            "Firestore index required: create composite index for applicant_messages on (applicantId, createdAt)"
          );
          e.code = "INDEX_REQUIRED";
          throw e;
        }
        // otherwise rethrow
        console.error(
          "dbClient.getMessagesForApplicant error",
          err && (err.stack || err)
        );
        throw err;
      }
    },

    // Find the teacherApplicants doc id that matches uid (returns doc id or null)
    findApplicantIdByUid: async (uid) => {
      if (!uid) {
        console.warn('[dbClient] findApplicantIdByUid called with empty uid');
        return null;
      }
      try {
        console.log(`[dbClient] Querying teacherApplicants for uid: ${uid}`);
        const q = await db
          .collection("teacherApplicants")
          .where("uid", "==", uid)
          .limit(1)
          .get();
        
        if (q.empty) {
          console.warn(`[dbClient] No applicant found for uid: ${uid} (query succeeded but returned empty)`);
          return null; // Query succeeded but empty = account truly deleted
        }
        
        console.log(`[dbClient] Found applicant: ${q.docs[0].id} for uid: ${uid}`);
        return q.docs[0].id;
      } catch (err) {
        // Query failed (network, permission, etc.) - let caller handle it
        console.error(`[dbClient] findApplicantIdByUid query FAILED for uid: ${uid}:`, err.message);
        throw err; // Throw error so caller knows it's a temporary failure, not "account deleted"
      }
    },

    // Get a full applicant document by its Firestore doc id (returns plain object or null)
    getApplicantById: async (applicantId) => {
      try {
        if (!applicantId) return null;
        const snap = await db
          .collection("teacherApplicants")
          .doc(applicantId)
          .get();
        if (!snap.exists) return null;
        return { id: snap.id, ...(snap.data() || {}) };
      } catch (err) {
        console.error("dbClient.getApplicantById error", err && err.message);
        throw err;
      }
    },
  };
}
