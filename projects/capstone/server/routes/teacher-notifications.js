/**
 * Teacher Notifications Route
 * Handles notification operations for teacher applicants
 */

import express from 'express';
import { sendProgressNotification, getNotifications, markNotificationAsRead } from '../utils/notificationService.js';

export default function createTeacherNotificationsRouter(deps = {}) {
  const { db, mailTransporter, requireAdmin, requireAuth } = deps;
  const router = express.Router();

  /**
   * POST /:id/notify-progress
   * Send a progress notification to a teacher applicant
   * Admin only endpoint
   */
  router.post('/:id/notify-progress', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { step } = req.body;

    if (!step) {
      return res.status(400).json({ 
        error: 'Progress step is required' 
      });
    }

    try {
      // Get applicant details from Firestore
      const docRef = db.collection('teacherApplicants').doc(id);
      const doc = await docRef.get();

      if (!doc.exists) {
        return res.status(404).json({ 
          error: 'Applicant not found' 
        });
      }

      const applicantData = doc.data();
      const applicant = {
        id,
        ...applicantData
      };

      // Send notification
      const result = await sendProgressNotification(db, mailTransporter, applicant, step);

      console.log(`[teacher-notifications] Progress notification sent for ${id}, step: ${step}`);

      res.json({ 
        success: true, 
        message: 'Notification sent successfully',
        notificationId: result.notificationId
      });

    } catch (error) {
      console.error('[teacher-notifications] Error sending progress notification:', error);
      
      res.status(500).json({ 
        error: error.message || 'Failed to send notification' 
      });
    }
  });

  /**
   * GET /:id/notifications
   * Get all notifications for a teacher applicant
   * Can be accessed by the applicant themselves or admin
   */
  router.get('/:id/notifications', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { limit } = req.query;

    try {
      // Check authorization: user must be admin or the applicant themselves
      const isAdmin = req.user.role === 'admin';
      
      // Fetch applicant to check if user owns this profile
      let isOwnProfile = false;
      if (!isAdmin) {
        const applicantDoc = await db.collection('teacherApplicants').doc(id).get();
        if (applicantDoc.exists) {
          const applicantData = applicantDoc.data();
          isOwnProfile = req.user.uid === applicantData.uid;
        }
      }

      if (!isAdmin && !isOwnProfile) {
        return res.status(403).json({ 
          error: 'Unauthorized to view these notifications' 
        });
      }

      const notifications = await getNotifications(db, id, parseInt(limit) || 50);

      res.json({ 
        success: true,
        notifications 
      });

    } catch (error) {
      console.error('[teacher-notifications] Error fetching notifications:', error);
      
      res.status(500).json({ 
        error: 'Failed to fetch notifications' 
      });
    }
  });

  /**
   * PUT /notifications/:notificationId/read
   * Mark a notification as read
   * Can be accessed by the applicant themselves or admin
   */
  router.put('/notifications/:notificationId/read', requireAuth, async (req, res) => {
    const { notificationId } = req.params;

    try {
      // Verify notification exists and get applicant ID
      const notifDoc = await db.collection('teacherNotifications').doc(notificationId).get();
      
      if (!notifDoc.exists) {
        return res.status(404).json({ 
          error: 'Notification not found' 
        });
      }

      const notifData = notifDoc.data();
      const isAdmin = req.user.role === 'admin';
      const isOwnNotification = req.user.uid === notifData.applicantId;

      if (!isAdmin && !isOwnNotification) {
        return res.status(403).json({ 
          error: 'Unauthorized to update this notification' 
        });
      }

      await markNotificationAsRead(db, notificationId);

      res.json({ 
        success: true, 
        message: 'Notification marked as read' 
      });

    } catch (error) {
      console.error('[teacher-notifications] Error marking notification as read:', error);
      
      res.status(500).json({ 
        error: 'Failed to mark notification as read' 
      });
    }
  });

  /**
   * DELETE /notifications/:notificationId
   * Delete a notification
   * Can be accessed by the applicant themselves or admin
   */
  router.delete('/notifications/:notificationId', requireAuth, async (req, res) => {
    const { notificationId } = req.params;

    try {
      // Verify notification exists and get applicant ID
      const notifDoc = await db.collection('teacherNotifications').doc(notificationId).get();
      
      if (!notifDoc.exists) {
        return res.status(404).json({ 
          error: 'Notification not found' 
        });
      }

      const notifData = notifDoc.data();
      const isAdmin = req.user.role === 'admin';
      
      // Check if user owns this notification by fetching applicant document
      let isOwnNotification = false;
      if (!isAdmin && notifData.applicantId) {
        const applicantDoc = await db.collection('teacherApplicants').doc(notifData.applicantId).get();
        if (applicantDoc.exists) {
          const applicantData = applicantDoc.data();
          isOwnNotification = req.user.uid === applicantData.uid;
        }
      }

      // Authorization: user must own the notification or be admin
      if (!isAdmin && !isOwnNotification) {
        return res.status(403).json({ 
          error: 'Unauthorized to delete this notification' 
        });
      }

      // Delete the notification
      await db.collection('teacherNotifications').doc(notificationId).delete();

      console.log(`[teacher-notifications] Notification deleted: ${notificationId}`);

      res.json({ 
        success: true, 
        message: 'Notification deleted successfully' 
      });

    } catch (error) {
      console.error('[teacher-notifications] Error deleting notification:', error);
      
      res.status(500).json({ 
        error: 'Failed to delete notification' 
      });
    }
  });

  /**
   * GET /:id/notifications/unread-count
   * Get count of unread notifications for an applicant
   * Can be accessed by the applicant themselves or admin
   */
  router.get('/:id/notifications/unread-count', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
      // Check authorization
      const isAdmin = req.user.role === 'admin';
      const isOwnProfile = req.user.uid === id;

      if (!isAdmin && !isOwnProfile) {
        return res.status(403).json({ 
          error: 'Unauthorized' 
        });
      }

      const snapshot = await db.collection('teacherNotifications')
        .where('applicantId', '==', id)
        .where('read', '==', false)
        .get();

      res.json({ 
        success: true,
        unreadCount: snapshot.size 
      });

    } catch (error) {
      console.error('[teacher-notifications] Error fetching unread count:', error);
      
      res.status(500).json({ 
        error: 'Failed to fetch unread count' 
      });
    }
  });

  return router;
}
