/**
 * Teacher Messages Route
 * Handles sending messages to teacher applicants via email
 */

import express from 'express';
import multer from 'multer';
import { sendEmail, createEmailTemplate } from '../utils/emailService.js';

// Configure multer for file upload (in-memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
  fileFilter: (req, file, cb) => {
    // Allowed file types for attachments
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/png',
      'image/jpeg',
      'image/jpg'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DOC, DOCX, XLS, XLSX, PNG, JPG allowed.'));
    }
  }
});

export default function createTeacherMessagesRouter(deps = {}) {
  const { db, dbClient, mailTransporter, requireAdmin, writeActivityLog, admin } = deps;
  const router = express.Router();

  /**
   * POST /:id/send-message
   * Send an email message to a teacher applicant with optional attachment
   * Admin only endpoint
   */
  router.post('/:id/send-message', requireAdmin, upload.single('attachment'), async (req, res) => {
    const { id } = req.params;
    
    // Log request details for debugging
    console.log('[teacher-messages] Request received:');
    console.log('  - Content-Type:', req.headers['content-type']);
    console.log('  - Has file:', !!req.file);
    console.log('  - Body keys:', req.body ? Object.keys(req.body) : 'undefined');
    
    // Extract fields from req.body (multer makes these available after processing)
    const recipient = req.body?.recipient;
    const subject = req.body?.subject;
    const body = req.body?.body;

    // Validation
    if (!recipient || !subject || !body) {
      console.error('[teacher-messages] Missing fields:', { recipient, subject, body, hasFile: !!req.file });
      return res.status(400).json({ 
        error: 'Missing required fields: recipient, subject, and body are required' 
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recipient)) {
      return res.status(400).json({ 
        error: 'Invalid email address format' 
      });
    }

    try {
      // Get applicant details (optional - for logging)
      let applicantName = 'Applicant';
      if (db) {
        try {
          const docRef = db.collection('teacherApplicants').doc(id);
          const doc = await docRef.get();
          if (doc.exists) {
            const data = doc.data();
            applicantName = `${data.firstName || ''} ${data.lastName || ''}`.trim();
          }
        } catch (dbErr) {
          console.warn('[teacher-messages] Could not fetch applicant details:', dbErr.message);
        }
      }

      // Handle file attachment if present
      let attachmentData = null;
      if (req.file && admin) {
        try {
          const file = req.file;
          const timestamp = Date.now();
          const fileName = `${timestamp}-${file.originalname}`;
          const filePath = `message-attachments/${fileName}`;
          
          // Upload to Firebase Storage
          const bucket = admin.storage().bucket();
          const fileRef = bucket.file(filePath);
          
          await fileRef.save(file.buffer, {
            metadata: {
              contentType: file.mimetype,
            },
          });
          
          // Make file publicly accessible
          await fileRef.makePublic();
          
          // Get public URL
          const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
          
          attachmentData = {
            filename: file.originalname,
            url: publicUrl,
            size: file.size,
            uploadedAt: new Date().toISOString()
          };
          
          console.log(`[teacher-messages] ✅ Attachment uploaded: ${attachmentData.filename}`);
        } catch (uploadErr) {
          console.error('[teacher-messages] ❌ Failed to upload attachment:', uploadErr.message);
          // Continue without attachment rather than failing
        }
      }

      // Create formatted email content with attachment link
      let emailContent = `<div style="white-space: pre-wrap;">${body}</div>`;
      
      if (attachmentData) {
        emailContent += `
          <div style="margin-top: 20px; padding: 15px; background-color: #f0fdf4; border: 1px solid #86efac; border-radius: 8px;">
            <p style="margin: 0;">
              <strong>📎 Attachment:</strong> 
              <a href="${attachmentData.url}" target="_blank" style="color: #2e8b57; text-decoration: none;">${attachmentData.filename}</a>
              <span style="color: #6b7280; font-size: 0.9em;"> (${(attachmentData.size / 1024).toFixed(1)} KB)</span>
            </p>
          </div>
        `;
      }
      
      const emailHtml = createEmailTemplate({
        title: subject,
        content: emailContent,
        footer: 'This message was sent from the Holy Family Academy Admin Portal. If you have questions, please contact the administration office.'
      });

      // Send email
      await sendEmail(mailTransporter, {
        to: recipient,
        subject: subject,
        html: emailHtml
      });

      // Save message to database so it appears in applicant portal
      if (dbClient && typeof dbClient.insertMessage === 'function') {
        try {          
          const messageData = {
            applicantId: id,
            fromUid: req.adminUser?.uid || req.user?.uid || null,
            senderName: req.adminUser?.displayName || req.user?.displayName || req.adminUser?.email || req.user?.email || 'Admin',
            senderEmail: req.adminUser?.email || req.user?.email || '',
            subject: subject,
            body: body,
            recipients: [recipient],
            attachment: attachmentData || null,
            createdAt: new Date()
          };
          
          // Save message to database
          const result = await dbClient.insertMessage(messageData);
          console.log(`[teacher-messages] ✅ Message saved with ID: ${result.id}`);
          
          // Also create a notification so message appears in Notifications section
          if (db) {
            try {
              const notificationData = {
                applicantId: id,
                type: 'message',
                title: 'New Message from Admin',
                message: `Subject: ${subject}`,
                read: false,
                createdAt: new Date()
              };
              
              const notifRef = await db.collection('teacherNotifications').add(notificationData);
              console.log(`[teacher-messages] ✅ Notification created with ID: ${notifRef.id}`);
            } catch (notifErr) {
              console.warn('[teacher-messages] ⚠️ Failed to create notification:', notifErr.message);
              // Don't fail the request - message was already saved
            }
          }
        } catch (dbErr) {
          console.error('[teacher-messages] ❌ Failed to save message to database:', dbErr.message);
          console.error('[teacher-messages] Error stack:', dbErr.stack);
          // Don't fail the request - email was sent successfully
        }
      } else {
        console.warn('[teacher-messages] ⚠️ dbClient.insertMessage not available - message NOT saved to database');
      }

      // Log activity
      if (writeActivityLog && req.user) {
        try {
          await writeActivityLog({
            userId: req.user.uid,
            userName: req.user.displayName || req.user.email,
            action: 'message_sent',
            targetType: 'teacher_applicant',
            targetId: id,
            details: {
              recipient,
              subject,
              applicantName
            },
            timestamp: new Date()
          });
        } catch (logErr) {
          console.warn('[teacher-messages] Failed to log activity:', logErr.message);
        }
      }

      console.log(`[teacher-messages] Message sent to ${recipient} (Applicant: ${applicantName})`);

      res.json({ 
        success: true, 
        message: 'Email sent successfully' 
      });

    } catch (error) {
      console.error('[teacher-messages] Error sending message:', error);
      
      // Return user-friendly error
      const errorMessage = error.message || 'Failed to send email';
      res.status(500).json({ 
        error: errorMessage.includes('transporter') 
          ? 'Email service is not configured. Please contact the system administrator.'
          : 'Failed to send message. Please try again later.' 
      });
    }
  });

  return router;
}
