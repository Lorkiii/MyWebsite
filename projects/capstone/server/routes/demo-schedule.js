/**
 * Demo Teaching Schedule Routes
 * Handles scheduling, rescheduling, and canceling demo teaching sessions
 */

import express from 'express';

export default function createDemoScheduleRouter({ db, mailTransporter, requireAdmin, writeActivityLog }) {
  const router = express.Router();

  /**
   * POST /:id/schedule-demo
   * Schedule a demo teaching session for an applicant
   */
  router.post('/:id/schedule-demo', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { date, time, mode, location, notes, subject } = req.body;

    try {
      // Validate required fields
      if (!date || !time || !mode) {
        return res.status(400).json({ 
          ok: false, 
          error: 'Date, time, and mode are required' 
        });
      }

      // Validate date is in the future
      const scheduledDate = new Date(date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (scheduledDate < today) {
        return res.status(400).json({ 
          ok: false, 
          error: 'Demo teaching date must be in the future' 
        });
      }

      // Get applicant data
      const applicantDoc = await db.collection('teacherApplicants').doc(id).get();
      if (!applicantDoc.exists) {
        return res.status(404).json({ ok: false, error: 'Applicant not found' });
      }

      const applicantData = applicantDoc.data();

      // Update applicant with demo teaching details
      const demoTeaching = {
        date,
        time,
        mode,
        location: location || '',
        notes: notes || '',
        subject: subject || '',
        scheduledAt: new Date(),
        scheduledBy: req.user?.email || 'admin'
      };

      await db.collection('teacherApplicants').doc(id).update({
        demoTeaching,
        status: 'demo_scheduled',
        statusUpdatedAt: new Date()
      });

      // Send notification to applicant
      try {
        await sendDemoNotification(db, mailTransporter, applicantData, demoTeaching, 'scheduled');
      } catch (notifError) {
        console.error('Failed to send demo notification:', notifError);
      }

      // Log activity
      await writeActivityLog({
        actionType: 'demo_scheduled',
        performedBy: req.user?.uid || 'admin',
        performedByEmail: req.user?.email || 'admin@hfa.edu',
        targetId: id,
        targetType: 'teacherApplicant',
        details: {
          applicantName: applicantData.fullName || `${applicantData.firstName} ${applicantData.lastName}`,
          demoDate: date,
          demoTime: time,
          mode: mode
        },
        timestamp: new Date()
      });

      res.json({ 
        ok: true, 
        message: 'Demo teaching scheduled successfully',
        demoTeaching 
      });

    } catch (error) {
      console.error('Error scheduling demo:', error);
      res.status(500).json({ ok: false, error: 'Failed to schedule demo teaching' });
    }
  });

  /**
   * PUT /:id/reschedule-demo
   * Reschedule an existing demo teaching session
   */
  router.put('/:id/reschedule-demo', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { date, time, mode, location, notes, subject } = req.body;

    try {
      // Validate future date
      const scheduledDate = new Date(date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (scheduledDate < today) {
        return res.status(400).json({ 
          ok: false, 
          error: 'Demo teaching date must be in the future' 
        });
      }

      // Get applicant
      const applicantDoc = await db.collection('teacherApplicants').doc(id).get();
      if (!applicantDoc.exists) {
        return res.status(404).json({ ok: false, error: 'Applicant not found' });
      }

      const applicantData = applicantDoc.data();

      // Update demo teaching details
      const demoTeaching = {
        date,
        time,
        mode,
        location: location || '',
        notes: notes || '',
        subject: subject || '',
        rescheduledAt: new Date(),
        rescheduledBy: req.user?.email || 'admin'
      };

      await db.collection('teacherApplicants').doc(id).update({
        demoTeaching,
        statusUpdatedAt: new Date()
      });

      // Send notification about reschedule
      try {
        await sendDemoNotification(db, mailTransporter, applicantData, demoTeaching, 'rescheduled');
      } catch (notifError) {
        console.error('Failed to send reschedule notification:', notifError);
      }

      res.json({ 
        ok: true, 
        message: 'Demo teaching rescheduled successfully',
        demoTeaching 
      });

    } catch (error) {
      console.error('Error rescheduling demo:', error);
      res.status(500).json({ ok: false, error: 'Failed to reschedule demo teaching' });
    }
  });

  /**
   * DELETE /:id/cancel-demo
   * Cancel a scheduled demo teaching session
   */
  router.delete('/:id/cancel-demo', requireAdmin, async (req, res) => {
    const { id } = req.params;

    try {
      // Get applicant
      const applicantDoc = await db.collection('teacherApplicants').doc(id).get();
      if (!applicantDoc.exists) {
        return res.status(404).json({ ok: false, error: 'Applicant not found' });
      }

      const applicantData = applicantDoc.data();

      // Remove demo teaching and revert status
      await db.collection('teacherApplicants').doc(id).update({
        demoTeaching: null,
        status: 'interview_completed', // Revert to previous status
        statusUpdatedAt: new Date()
      });

      // Send cancellation notification
      try {
        await sendDemoNotification(db, mailTransporter, applicantData, null, 'cancelled');
      } catch (notifError) {
        console.error('Failed to send cancellation notification:', notifError);
      }

      res.json({ 
        ok: true, 
        message: 'Demo teaching cancelled successfully' 
      });

    } catch (error) {
      console.error('Error cancelling demo:', error);
      res.status(500).json({ ok: false, error: 'Failed to cancel demo teaching' });
    }
  });

  /**
   * POST /:id/complete-demo
   * Mark demo teaching as completed
   */
  router.post('/:id/complete-demo', requireAdmin, async (req, res) => {
    const { id } = req.params;

    try {
      // Update status to demo_completed
      await db.collection('teacherApplicants').doc(id).update({
        'demoTeaching.completed': true,
        'demoTeaching.completedAt': new Date(),
        status: 'demo_completed',
        statusUpdatedAt: new Date()
      });

      res.json({ 
        ok: true, 
        message: 'Demo teaching marked as completed' 
      });

    } catch (error) {
      console.error('Error completing demo:', error);
      res.status(500).json({ ok: false, error: 'Failed to mark demo as completed' });
    }
  });

  return router;
}

/**
 * Helper function to send demo teaching notifications
 */
async function sendDemoNotification(db, mailTransporter, applicantData, demoTeaching, type) {
  const applicantName = applicantData.fullName || `${applicantData.firstName} ${applicantData.lastName}`;
  
  let subject, message;
  
  switch (type) {
    case 'scheduled':
      subject = 'Demo Teaching Scheduled';
      message = `Your demo teaching has been scheduled for ${demoTeaching.date} at ${demoTeaching.time}. Location: ${demoTeaching.location || 'TBA'}`;
      break;
    case 'rescheduled':
      subject = 'Demo Teaching Rescheduled';
      message = `Your demo teaching has been rescheduled to ${demoTeaching.date} at ${demoTeaching.time}`;
      break;
    case 'cancelled':
      subject = 'Demo Teaching Cancelled';
      message = 'Your demo teaching session has been cancelled. We will contact you with further updates.';
      break;
  }

  // Save notification to database
  await db.collection('applicant_notifications').add({
    applicantId: applicantData.id || applicantData.uid,
    applicantEmail: applicantData.email,
    title: subject,
    message: message,
    type: 'demo_teaching',
    read: false,
    createdAt: new Date()
  });

  // Send email (optional - can fail without breaking flow)
  try {
    const mailOptions = {
      from: `"Holy Family Academy" <${process.env.RESEND_FROM_EMAIL || 'noreply@alphfabet.com'}>`,
      to: applicantData.email,
      subject: subject,
      html: `
        <h3>${subject}</h3>
        <p>Dear ${applicantName},</p>
        <p>${message}</p>
        ${demoTeaching ? `
          <p><strong>Details:</strong></p>
          <ul>
            <li>Date: ${demoTeaching.date}</li>
            <li>Time: ${demoTeaching.time}</li>
            <li>Mode: ${demoTeaching.mode}</li>
            <li>Location: ${demoTeaching.location || 'TBA'}</li>
            ${demoTeaching.subject ? `<li>Subject: ${demoTeaching.subject}</li>` : ''}
            ${demoTeaching.notes ? `<li>Notes: ${demoTeaching.notes}</li>` : ''}
          </ul>
        ` : ''}
        <p>Best regards,<br>Holy Family Academy</p>
      `
    };

    await mailTransporter.sendMail(mailOptions);
    console.log(`✅ Demo teaching ${type} email sent to ${applicantData.email}`);
  } catch (error) {
    console.error(`Failed to send demo email:`, error);
  }
}
