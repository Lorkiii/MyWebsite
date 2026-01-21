// server/routes/admin-mail.js
// Admin Mail System - Handle inbox, sent messages, and compose functionality

import express from 'express';
import multer from 'multer';

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

export default function createAdminMailRouter(deps = {}) {
  const { db, admin, mailTransporter, writeActivityLog, requireAdmin } = deps;
  
  if (!db) throw new Error('db is required');
  if (!admin) throw new Error('admin is required');
  if (!mailTransporter) throw new Error('mailTransporter is required');
  if (!requireAdmin) throw new Error('requireAdmin middleware is required');
  
  const router = express.Router();
  
  // GET /api/admin/mail/inbox
  // Fetch active messages from applicants

  router.get('/inbox', requireAdmin, async (req, res) => {
    try {
      const snapshot = await db.collection('applicant_messages')
        .where('recipients', 'array-contains', 'admin')
        .where('isArchived', '==', false)
        .orderBy('createdAt', 'desc')
        .get();
      
      const messages = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          applicantId: data.applicantId || null,
          fromUid: data.fromUid || null,
          senderName: data.senderName || 'Unknown',
          senderEmail: data.senderEmail || '',
          subject: data.subject || '(No Subject)',
          body: data.body || '',
          createdAt: data.createdAt?.toDate?.()?.toISOString() || null
        };
      });
      
      return res.json({ ok: true, messages });
    } catch (error) {
      console.error('[admin-mail] Error fetching inbox:', error);
      return res.status(500).json({ 
        ok: false, 
        error: 'Failed to fetch inbox messages' 
      });
    }
  });
  
  // GET /api/admin/mail/sent
  // Fetch ALL messages sent by current admin from both collections

  router.get('/sent', requireAdmin, async (req, res) => {
    try {
      const currentAdminUid = req.adminUser?.uid || req.user?.uid;
      
      if (!currentAdminUid) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }
      
      const allMessages = [];
      
      // 1. Query applicant_messages where admin is the sender (new message system)
      const applicantMessagesSnapshot = await db.collection('applicant_messages')
        .where('fromUid', '==', currentAdminUid)
        .orderBy('createdAt', 'desc')
        .get();
      
      applicantMessagesSnapshot.docs.forEach(doc => {
        const data = doc.data();
        
        // Format recipients for frontend display
        const recipients = data.recipients || [];
        const to = recipients.map(email => ({
          email: email,
          name: email
        }));
        
        allMessages.push({
          id: doc.id,
          applicantId: data.applicantId || null,
          fromUid: data.fromUid,
          senderName: data.senderName || data.fromName || '',
          senderEmail: data.senderEmail || data.fromEmail || '',
          to: to,
          subject: data.subject || '(No Subject)',
          body: data.body || '',
          attachment: data.attachment || null,
          createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
          sentAt: data.createdAt?.toDate?.()?.toISOString() || null,
          isArchived: data.isArchived || false
        });
      });
      
      // 2. Query admin_mail_sent (old compose email system)
      const adminMailSnapshot = await db.collection('admin_mail_sent')
        .where('fromUid', '==', currentAdminUid)
        .orderBy('sentAt', 'desc')
        .get();
      
      adminMailSnapshot.docs.forEach(doc => {
        const data = doc.data();
        
        // Format recipients from the 'to' array
        const recipients = data.to || [];
        const to = recipients.map(recipient => ({
          email: recipient.email || '',
          name: recipient.name || recipient.email || 'Unknown'
        }));
        
        allMessages.push({
          id: doc.id,
          fromUid: data.fromUid,
          senderName: data.fromName || '',
          senderEmail: data.fromEmail || '',
          to: to,
          subject: data.subject || '(No Subject)',
          body: data.body || '',
          attachment: data.attachment || null,
          createdAt: data.sentAt?.toDate?.()?.toISOString() || null,
          sentAt: data.sentAt?.toDate?.()?.toISOString() || null,
          isArchived: false // Old system didn't have archive feature
        });
      });
      
      // Sort all messages by date (newest first)
      allMessages.sort((a, b) => {
        const dateA = new Date(a.sentAt || a.createdAt || 0);
        const dateB = new Date(b.sentAt || b.createdAt || 0);
        return dateB - dateA;
      });
      
      // Filter out archived messages (only show active sent messages)
      const activeMessages = allMessages.filter(msg => !msg.isArchived);
      
      return res.json({ ok: true, messages: activeMessages });
    } catch (error) {
      console.error('[admin-mail] Error fetching sent messages:', error);
      return res.status(500).json({ 
        ok: false, 
        error: 'Failed to fetch sent messages' 
      });
    }
  });
  
  // GET /api/admin/mail/archived
  // Fetch archived messages from both collections
  // Implements lazy deletion - automatically deletes messages older than 30 days

  router.get('/archived', requireAdmin, async (req, res) => {
    try {
      const currentAdminUid = req.adminUser?.uid || req.user?.uid;
      
      if (!currentAdminUid) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }
      
      // Calculate 30 days ago threshold
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const messages = [];
      const messagesToDelete = [];
      
      // 1. Query archived sent messages from applicant_messages (admin as sender)
      const sentSnapshot = await db.collection('applicant_messages')
        .where('fromUid', '==', currentAdminUid)
        .where('isArchived', '==', true)
        .orderBy('archivedAt', 'desc')
        .get();
      
      sentSnapshot.docs.forEach(doc => {
        const data = doc.data();
        const archivedAt = data.archivedAt?.toDate ? data.archivedAt.toDate() : null;
        
        // Check if message is older than 30 days
        if (archivedAt && archivedAt < thirtyDaysAgo) {
          // Mark for deletion
          messagesToDelete.push({ id: doc.id, collection: 'applicant_messages' });
        } else {
          // Format recipients
          const recipients = data.recipients || [];
          const to = recipients.map(email => ({
            email: email,
            name: email
          }));
          
          // Include in results
          messages.push({
            id: doc.id,
            applicantId: data.applicantId || null,
            fromUid: data.fromUid,
            senderName: data.senderName || data.fromName || 'You',
            senderEmail: data.senderEmail || data.fromEmail || '',
            to: to,
            subject: data.subject || '(No Subject)',
            body: data.body || '',
            attachment: data.attachment || null,
            createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
            archivedAt: data.archivedAt?.toDate?.()?.toISOString() || null
          });
        }
      });
      
      // 2. Query archived inbox messages from applicant_messages (admin as recipient)
      const inboxSnapshot = await db.collection('applicant_messages')
        .where('recipients', 'array-contains', 'admin')
        .where('isArchived', '==', true)
        .orderBy('archivedAt', 'desc')
        .get();
      
      inboxSnapshot.docs.forEach(doc => {
        const data = doc.data();
        const archivedAt = data.archivedAt?.toDate ? data.archivedAt.toDate() : null;
        
        // Skip if this message is already added (from sent query)
        if (messages.find(m => m.id === doc.id)) return;
        
        // Check if message is older than 30 days
        if (archivedAt && archivedAt < thirtyDaysAgo) {
          // Mark for deletion
          messagesToDelete.push({ id: doc.id, collection: 'applicant_messages' });
        } else {
          // Include in results
          messages.push({
            id: doc.id,
            applicantId: data.applicantId || null,
            fromUid: data.fromUid || null,
            senderName: data.senderName || 'Unknown',
            senderEmail: data.senderEmail || '',
            subject: data.subject || '(No Subject)',
            body: data.body || '',
            to: data.to || [],
            attachment: data.attachment || null,
            createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
            archivedAt: data.archivedAt?.toDate?.()?.toISOString() || null
          });
        }
      });
      
      // Sort messages by archived date (newest first)
      messages.sort((a, b) => {
        const dateA = new Date(a.archivedAt || 0);
        const dateB = new Date(b.archivedAt || 0);
        return dateB - dateA;
      });
      
      // Delete expired messages in background (don't wait for completion)
      if (messagesToDelete.length > 0) {
        console.log(`[admin-mail] Lazy deletion: removing ${messagesToDelete.length} messages older than 30 days`);
        
        // Delete in batches to avoid timeout (Firestore allows max 500 operations per batch)
        const batchSize = 500;
        for (let i = 0; i < messagesToDelete.length; i += batchSize) {
          const batch = db.batch();
          const batchMessages = messagesToDelete.slice(i, i + batchSize);
          
          batchMessages.forEach(msg => {
            batch.delete(db.collection(msg.collection).doc(msg.id));
          });
          
          // Execute batch delete asynchronously (don't block response)
          batch.commit().catch(err => {
            console.error('[admin-mail] Error in lazy deletion batch:', err);
          });
        }
      }
      
      return res.json({ ok: true, messages });
    } catch (error) {
      console.error('[admin-mail] Error fetching archived messages:', error);
      return res.status(500).json({ 
        ok: false, 
        error: 'Failed to fetch archived messages' 
      });
    }
  });
  
  // ============================================
  // GET /api/admin/mail/users/search
  // Search users for composing messages
  // ============================================
  router.get('/users/search', requireAdmin, async (req, res) => {
    try {
      const { q } = req.query;
      
      if (!q || q.trim().length === 0) {
        return res.json({ ok: true, users: [] });
      }
      
      const searchQuery = q.toLowerCase().trim();
      
      // Search users collection (admin and applicant roles only)
      const usersSnapshot = await db.collection('users')
        .where('role', 'in', ['admin', 'applicant'])
        .get();
      
      const users = [];
      
      usersSnapshot.docs.forEach(doc => {
        const data = doc.data();
        const userName = (data.displayName || data.name || '').toLowerCase();
        const userEmail = (data.email || '').toLowerCase();
        
        // Filter by search query (name or email contains query)
        if (userName.includes(searchQuery) || userEmail.includes(searchQuery)) {
          users.push({
            uid: doc.id,
            email: data.email || '',
            name: data.displayName || data.name || data.email || 'Unknown',
            role: data.role || 'applicant'
          });
        }
      });
      
      // Limit results to 10 users
      const limitedUsers = users.slice(0, 10);
      
      return res.json({ ok: true, users: limitedUsers });
      
    } catch (error) {
      console.error('[admin-mail] Error searching users:', error);
      return res.status(500).json({ 
        ok: false, 
        error: 'Failed to search users' 
      });
    }
  });
  
  // ============================================
  // PUT /api/admin/mail/:messageId/archive
  // Move message to archived
  // ============================================
  router.put('/:messageId/archive', requireAdmin, async (req, res) => {
    try {
      const { messageId } = req.params;
      
      if (!messageId) {
        return res.status(400).json({ ok: false, error: 'Message ID is required' });
      }
      
      const messageRef = db.collection('applicant_messages').doc(messageId);
      const messageDoc = await messageRef.get();
      
      if (!messageDoc.exists) {
        return res.status(404).json({ ok: false, error: 'Message not found' });
      }
      
      // Update message to archived status
      await messageRef.update({
        isArchived: true,
        archivedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      return res.json({ 
        ok: true, 
        message: 'Message archived successfully' 
      });
    } catch (error) {
      console.error('[admin-mail] Error archiving message:', error);
      return res.status(500).json({ 
        ok: false, 
        error: 'Failed to archive message' 
      });
    }
  });

  // ============================================
  // PUT /api/admin/mail/:messageId/restore
  // Restore archived message back to sent
  // ============================================
  router.put('/:messageId/restore', requireAdmin, async (req, res) => {
    try {
      const { messageId } = req.params;
      
      if (!messageId) {
        return res.status(400).json({ ok: false, error: 'Message ID is required' });
      }
      
      const messageRef = db.collection('applicant_messages').doc(messageId);
      const messageDoc = await messageRef.get();
      
      if (!messageDoc.exists) {
        return res.status(404).json({ ok: false, error: 'Message not found' });
      }
      
      // Restore message - unarchive it
      await messageRef.update({
        isArchived: false,
        archivedAt: admin.firestore.FieldValue.delete() // Remove archived timestamp
      });
      
      return res.json({ 
        ok: true, 
        message: 'Message restored successfully' 
      });
    } catch (error) {
      console.error('[admin-mail] Error restoring message:', error);
      return res.status(500).json({ 
        ok: false, 
        error: 'Failed to restore message' 
      });
    }
  });

  // ============================================
  // DELETE /api/admin/mail/:messageId
  // Permanently delete a message
  // ============================================
  router.delete('/:messageId', requireAdmin, async (req, res) => {
    try {
      const { messageId } = req.params;
      
      if (!messageId) {
        return res.status(400).json({ ok: false, error: 'Message ID is required' });
      }
      
      const messageRef = db.collection('applicant_messages').doc(messageId);
      const messageDoc = await messageRef.get();
      
      if (!messageDoc.exists) {
        return res.status(404).json({ ok: false, error: 'Message not found' });
      }
      
      // Permanently delete the message
      await messageRef.delete();
      
      // Log the deletion activity
      if (writeActivityLog) {
        try {
          await writeActivityLog({
            actionType: 'mail_deleted',
            performedBy: req.adminUser?.uid || req.user?.uid || 'admin',
            performedByEmail: req.adminUser?.email || req.user?.email || 'admin@hfa.edu',
            targetId: messageId,
            targetType: 'message',
            details: {
              subject: messageDoc.data().subject || '(No Subject)'
            },
            timestamp: new Date()
          });
        } catch (logError) {
          console.error('[admin-mail] Failed to log delete activity:', logError);
        }
      }
      
      return res.json({ 
        ok: true, 
        message: 'Message deleted permanently' 
      });
    } catch (error) {
      console.error('[admin-mail] Error deleting message:', error);
      return res.status(500).json({ 
        ok: false, 
        error: 'Failed to delete message' 
      });
    }
  });

  // POST /api/admin/mail/send
  // DEPRECATED: Old compose email system
  // Now using "Send Message to Applicant" flow via /api/teacher-applicants/:id/send-message

  router.post('/send', requireAdmin, upload.single('attachment'), async (req, res) => {
    try {
      const currentAdminUid = req.adminUser?.uid || req.user?.uid;
      const currentAdminEmail = req.adminUser?.email || req.user?.email;
      
      if (!currentAdminUid) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }
      
      // Parse request body
      const { to, subject, body } = req.body;
      
      // Validate required fields
      if (!to || !subject || !body) {
        return res.status(400).json({ 
          ok: false, 
          error: 'Missing required fields: to, subject, body' 
        });
      }
      
      // Parse recipients (comes as JSON string from frontend)
      let recipientsList = [];
      try {
        recipientsList = typeof to === 'string' ? JSON.parse(to) : to;
      } catch (e) {
        return res.status(400).json({ ok: false, error: 'Invalid recipients format' });
      }
      
      if (!Array.isArray(recipientsList) || recipientsList.length === 0) {
        return res.status(400).json({ ok: false, error: 'At least one recipient is required' });
      }
      
      // Get admin name from Firestore
      const adminDoc = await db.collection('users').doc(currentAdminUid).get();
      const adminData = adminDoc.exists ? adminDoc.data() : {};
      const adminName = adminData.displayName || adminData.name || currentAdminEmail;
      
      // Handle file attachment if present
      let attachmentData = null;
      
      if (req.file) {
        const file = req.file;
        const timestamp = Date.now();
        const fileName = `${timestamp}-${file.originalname}`;
        const filePath = `mail-attachments/${fileName}`;
        
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
      }
      
      // Save to database first
      const mailData = {
        fromUid: currentAdminUid,
        fromName: adminName,
        fromEmail: currentAdminEmail,
        to: recipientsList,
        subject,
        body,
        attachment: attachmentData,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        emailSent: false
      };
      
      const docRef = await db.collection('admin_mail_sent').add(mailData);
      
      // Send emails to all recipients
      let emailsSentCount = 0;
      const emailErrors = [];
      
      for (const recipient of recipientsList) {
        try {
          // Create simple email template
          const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #2e8b57; color: white; padding: 20px; text-align: center;">
                <h2>Holy Family Academy</h2>
              </div>
              <div style="padding: 20px; background-color: #f9f9f9;">
                <p><strong>From:</strong> ${adminName} (${currentAdminEmail})</p>
                <p><strong>Subject:</strong> ${subject}</p>
                <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
                <div style="white-space: pre-wrap;">${body}</div>
                ${attachmentData ? `
                  <div style="margin-top: 20px; padding: 15px; background-color: #fff; border: 1px solid #ddd; border-radius: 5px;">
                    <p style="margin: 0;">
                      <strong>📎 Attachment:</strong> 
                      <a href="${attachmentData.url}" target="_blank" style="color: #2e8b57;">${attachmentData.filename}</a>
                    </p>
                  </div>
                ` : ''}
              </div>
              <div style="padding: 20px; text-align: center; color: #666; font-size: 12px;">
                <p>This is an automated message from Holy Family Academy. Please do not reply to this email.</p>
                <p>&copy; ${new Date().getFullYear()} Holy Family Academy. All rights reserved.</p>
              </div>
            </div>
          `;
          
          // Send email via Resend - use verified domain with admin name in display
          const fromAddress = process.env.RESEND_FROM_EMAIL || 'noreply@alphfabet.com';
          await mailTransporter.sendMail({
            from: `"${adminName}" <${fromAddress}>`,
            to: recipient.email,
            subject: subject,
            html: emailHtml,
            replyTo: currentAdminEmail // Allow recipients to reply to admin's actual email
          });
          
          emailsSentCount++;
        } catch (emailError) {
          console.error(`[admin-mail] Failed to send email to ${recipient.email}:`, emailError);
          emailErrors.push({ email: recipient.email, error: emailError.message });
        }
      }
      
      // Update emailSent status
      await docRef.update({
        emailSent: emailsSentCount > 0
      });
      
      // Log activity
      if (writeActivityLog && typeof writeActivityLog === 'function') {
        try {
          await writeActivityLog({
            actorUid: currentAdminUid,
            actorEmail: currentAdminEmail,
            action: 'admin_mail_sent',
            detail: `To: ${recipientsList.map(r => r.email).join(', ')}, Attachment: ${attachmentData ? 'Yes' : 'No'}`
          });
        } catch (logError) {
          console.warn('[admin-mail] Failed to write activity log:', logError);
        }
      }
      
      return res.json({
        ok: true,
        messageId: docRef.id,
        emailsSent: emailsSentCount,
        totalRecipients: recipientsList.length,
        errors: emailErrors.length > 0 ? emailErrors : undefined
      });
      
    } catch (error) {
      console.error('[admin-mail] Error sending mail:', error);
      return res.status(500).json({ 
        ok: false, 
        error: error.message || 'Failed to send mail' 
      });
    }
  });
  
  return router;
}
