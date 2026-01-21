/**
 * Notification Service
 * Handles sending notifications to teacher applicants via Firestore and Email
 */

import { sendEmail, createEmailTemplate } from './emailService.js';

/**
 * Step messages for teacher applicant progress updates
 */
const PROGRESS_MESSAGES = {
  submitted: {
    title: 'Application Received',
    message: 'Your application has been received and is being processed.'
  },
  screening: {
    title: 'Initial Screening',
    message: 'Your application has passed initial screening. Our team is reviewing your qualifications.'
  },
  interview_scheduled: {
    title: 'Interview Scheduled',
    message: 'Your interview has been scheduled. Please check your application portal for date and time details.'
  },
  interview_completed: {
    title: 'Interview Completed',
    message: 'Your interview has been successfully completed. We will proceed to the next step of your application.'
  },
  demo_scheduled: {
    title: 'Demo Teaching Scheduled',
    message: 'Your demo teaching session has been scheduled. Please check the details and prepare your lesson.'
  },
  demo_completed: {
    title: 'Demo Teaching Completed',
    message: 'Your demo teaching has been successfully completed. We will evaluate your performance and notify you of the results.'
  },
  demo: {
    title: 'Demo Teaching Session',
    message: 'Demo teaching session has been scheduled. Prepare to showcase your teaching skills.'
  },
  result: {
    title: 'Evaluation Results',
    message: 'Your application results are ready. Please check your application portal for details.'
  },
  onboarding: {
    title: 'Welcome to Onboarding',
    message: 'Congratulations! Your onboarding process has begun. Admin will contact you soon with the next steps. Please prepare your documents for submission.'
  },
  approved: {
    title: 'Application Approved! 🎉',
    message: 'Congratulations! Your teaching application has been approved. Welcome to Holy Family Academy! You will now proceed to the onboarding phase. Admin will contact you within 2-3 business days.'
  },
  rejected: {
    title: 'Application Status Update',
    message: 'Thank you for your interest in Holy Family Academy. After careful review, we have decided not to proceed with your application at this time. We appreciate the time and effort you invested in the application process and wish you the best in your future endeavors.'
  },
  archived: {
    title: 'Welcome to Holy Family Academy! 🎊',
    message: 'Congratulations! Your onboarding is complete and you are now officially part of our teaching staff. Welcome to the Holy Family Academy family! We look forward to working with you.'
  }
};

/**
 * Send a progress notification to teacher applicant
 * @param {Object} db - Firestore database instance
 * @param {Object} mailTransporter - Nodemailer transporter
 * @param {Object} applicant - Applicant data
 * @param {string} step - Progress step key
 * @returns {Promise<Object>} - Result object
 */
export async function sendProgressNotification(db, mailTransporter, applicant, step) {
  if (!db) {
    throw new Error('Database instance not provided');
  }

  if (!applicant || !applicant.email) {
    throw new Error('Applicant email is required');
  }

  const messageData = PROGRESS_MESSAGES[step] || {
    title: 'Application Update',
    message: 'Your application status has been updated.'
  };

  // Add interview details if step is interview_scheduled
  let fullMessage = messageData.message;
  if (step === 'interview_scheduled' && applicant.interview) {
    const interviewDate = applicant.interview.date || 'TBA';
    const interviewTime = applicant.interview.time || '';
    const interviewLocation = applicant.interview.location || 'TBA';
    fullMessage += `\n\nInterview Details:\nDate: ${interviewDate}${interviewTime ? ' at ' + interviewTime : ''}\nLocation: ${interviewLocation}`;
  }

  try {
    // 1. Save notification to Firestore
    const notificationData = {
      applicantId: applicant.id || 'unknown',
      email: applicant.email,
      type: 'progress_update',
      title: messageData.title,
      message: fullMessage,
      step: step,
      read: false,
      createdAt: new Date()
    };

    const notificationRef = await db.collection('teacherNotifications').add(notificationData);
    console.log(`[notificationService] Notification created: ${notificationRef.id}`);

    // 2. Send email notification
    if (mailTransporter) {
      try {
        const applicantName = `${applicant.firstName || ''} ${applicant.lastName || ''}`.trim() || 'Applicant';
        
        const emailContent = `
          <p>Dear ${applicantName},</p>
          <p>${fullMessage.replace(/\n/g, '<br>')}</p>

          <p style="margin-top: 20px; color: #666;">
            If you have any questions, please contact our administration office.
          </p>
        `;

        const emailHtml = createEmailTemplate({
          title: messageData.title,
          content: emailContent,
          footer: 'This is an automated notification from Holy Family Academy. Please do not reply to this email.'
        });

        await sendEmail(mailTransporter, {
          to: applicant.email,
          subject: `${messageData.title} - Holy Family Academy`,
          html: emailHtml
        });

        console.log(`[notificationService] Email sent to ${applicant.email}`);
      } catch (emailError) {
        console.warn('[notificationService] Email send failed:', emailError.message);
        // Don't throw - notification was saved to Firestore
      }
    }
    return {
      success: true,
      notificationId: notificationRef.id,
      message: 'Notification sent successfully'
    };

  } catch (error) {
    console.error('[notificationService] Error sending notification:', error);
    throw error;
  }
}

/**
 * Get notifications for a specific applicant
 * @param {Object} db - Firestore database instance
 * @param {string} applicantId - Applicant ID
 * @param {number} limit - Maximum number of notifications to retrieve
 * @returns {Promise<Array>} - Array of notifications
 */
export async function getNotifications(db, applicantId, limit = 50) {
  if (!db) {
    throw new Error('Database instance not provided');
  }

  if (!applicantId) {
    throw new Error('Applicant ID is required');
  }

  try {
    const snapshot = await db.collection('teacherNotifications')
      .where('applicantId', '==', applicantId)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    const notifications = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      notifications.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt
      });
    });

    return notifications;
  } catch (error) {
    console.error('[notificationService] Error fetching notifications:', error);
    throw error;
  }
}

/**
 * Mark notification as read
 * @param {Object} db - Firestore database instance
 * @param {string} notificationId - Notification ID
 * @returns {Promise<Object>} - Result object
 */
export async function markNotificationAsRead(db, notificationId) {
  if (!db) {
    throw new Error('Database instance not provided');
  }

  if (!notificationId) {
    throw new Error('Notification ID is required');
  }

  try {
    await db.collection('teacherNotifications').doc(notificationId).update({
      read: true,
      readAt: new Date()
    });

    return { success: true };
  } catch (error) {
    console.error('[notificationService] Error marking notification as read:', error);
    throw error;
  }
}
