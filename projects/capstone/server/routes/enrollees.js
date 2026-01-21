// server/routes/enrollees.js
import express from "express";
import multer from "multer";
import crypto from "crypto";
import { validateAndFormatPhone } from "../utils/phoneValidator.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 150 * 1024 * 1024 } // 150MB limit (adjust as needed)
});

export default function createEnrolleesRouter(deps = {}) {
  const {
    db,
    admin,
    writeActivityLog
  } = deps;

  const router = express.Router();

  // Helper: random suffix
  function randStr(len = 6) {
    return crypto.randomBytes(Math.ceil(len / 2)).toString("hex").slice(0, len);
  }

  // POST /api/enrollees
  // Body: metadata (form fields - no requestedFiles needed)
  router.post("/enrollees", async (req, res) => {
    try {
      const formData = req.body || {};
      // basic validation: require formType (shs/jhs)
      const formType = String(formData.formType || "").trim().toLowerCase();
      if (!formType || (formType !== "shs" && formType !== "jhs")) {
        return res.status(400).json({ ok: false, error: "Missing or invalid formType (shs|jhs)" });
      }

      // Validate and format phone number
      let formattedPhone;
      try {
        if (formData.contactNumber) {
          formattedPhone = validateAndFormatPhone(formData.contactNumber);
        }
      } catch (phoneError) {
        return res.status(400).json({ 
          ok: false, 
          error: 'Invalid phone number', 
          details: phoneError.message 
        });
      }

      // Prepare initial document 
      const now = admin.firestore.FieldValue.serverTimestamp();
      const collection = (formType === "shs") ? "shsApplicants" : "jhsApplicants";
      const toSave = {
        ...formData,
        contactNumber: formattedPhone || formData.contactNumber,
        documents: [], // Initialize empty documents array
        status: "pending",
        isNew: true,
        createdAt: now,
        updatedAt: now
      };

      const docRef = await db.collection(collection).add(toSave);
      const studentId = docRef.id;

      console.log("/api/enrollees created", { studentId, formType });

      return res.json({
        ok: true,
        studentId
      });
    } catch (err) {
      console.error("/api/enrollees error", err && (err.stack || err));
      return res.status(500).json({ ok: false, error: "Server error", message: err && err.message });
    }
  });

  // POST /api/enrollees/:id/upload-file
  // Simple file upload with type label
  // Accepts multipart form-data: file, fileType (reportcard|psa|clearance), label
  router.post("/enrollees/:id/upload-file", upload.single("file"), async (req, res) => {
    console.log('📥 /api/enrollees/:id/upload-file - Request received');
    console.log('   Student ID:', req.params.id);
    console.log('   Body:', req.body);
    console.log('   File:', req.file ? `${req.file.originalname} (${req.file.size} bytes)` : 'NO FILE');
    
    try {
      const studentId = req.params.id;
      const fileType = String(req.body.fileType || "").trim();
      const label = String(req.body.label || "").trim();
      
      if (!studentId) {
        console.log('❌ Missing studentId');
        return res.status(400).json({ ok: false, error: "Missing studentId" });
      }
      if (!fileType) {
        console.log('❌ Missing fileType');
        return res.status(400).json({ ok: false, error: "Missing fileType" });
      }
      if (!req.file || !req.file.buffer) {
        console.log('❌ No file provided');
        return res.status(400).json({ ok: false, error: "No file provided" });
      }

      // Validate fileType
      const validTypes = ["reportcard", "psa", "clearance"];
      if (!validTypes.includes(fileType)) {
        return res.status(400).json({ ok: false, error: `Invalid fileType. Must be one of: ${validTypes.join(", ")}` });
      }

      // Generate unique filename
      const originalName = req.file.originalname || "file";
      const ext = originalName.includes(".") ? originalName.slice(originalName.lastIndexOf(".")) : "";
      const timestamp = Date.now();
      const random = randStr(6);
      const filename = `${fileType}_${timestamp}_${random}${ext}`;
      const path = `uploads/studentFiles/${studentId}/${filename}`;

      const fileBuffer = req.file.buffer;
      const contentType = req.file.mimetype || "application/octet-stream";

      console.log(`/api/enrollees/${studentId}/upload-file: type=${fileType} path=${path} size=${fileBuffer.length}`);

      // Upload to Firebase Storage
      const bucket = admin.storage().bucket();
      const file = bucket.file(path);
      let publicUrl;

      try {
        await file.save(fileBuffer, {
          metadata: {
            contentType: contentType,
            cacheControl: "public, max-age=3600"
          }
        });

        await file.makePublic();
        const bucketName = bucket.name;
        publicUrl = `https://storage.googleapis.com/${bucketName}/${path}`;

        console.log(`Firebase Storage upload success: ${publicUrl}`);
      } catch (uploadError) {
        console.error("Firebase Storage upload failed", uploadError);
        return res.status(500).json({ ok: false, error: "Upload failed", detail: uploadError.message || String(uploadError) });
      }

      // Find the student document
      const shsRef = db.collection("shsApplicants").doc(studentId);
      const shsSnap = await shsRef.get();
      const jhsRef = db.collection("jhsApplicants").doc(studentId);
      const jhsSnap = await jhsRef.get();

      let appRef = null;
      if (shsSnap.exists) appRef = shsRef;
      else if (jhsSnap.exists) appRef = jhsRef;
      else return res.status(404).json({ ok: false, error: "Student not found" });

      // Add to documents array
      const docToAdd = {
        type: fileType,
        label: label || fileType,
        fileName: originalName,
        fileUrl: publicUrl,
        uploadedAt: admin.firestore.Timestamp.now()
      };

      await appRef.update({
        documents: admin.firestore.FieldValue.arrayUnion(docToAdd),
        status: "submitted",
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log(`/api/enrollees/${studentId}/upload-file success: type=${fileType}`);

      // Write activity log
      try {
        const appData = shsSnap.exists ? shsSnap.data() : jhsSnap.data();
        await writeActivityLog && writeActivityLog({
          actorUid: null,
          actorEmail: appData.email || appData.contactEmail || null,
          targetUid: null,
          action: "file-uploaded",
          detail: `studentId:${studentId} fileType:${fileType}`
        });
      } catch (e) {
        console.warn("writeActivityLog failed", e && e.message);
      }

      return res.json({ ok: true, fileType, fileUrl: publicUrl, fileName: originalName });
    } catch (err) {
      console.error("/api/enrollees/:id/upload-file error", err && (err.stack || err));
      return res.status(500).json({ ok: false, error: "Server error", message: err && err.message });
    }
  });

  // Expose router
  return router;
}
