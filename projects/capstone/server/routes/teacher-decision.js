// Teacher Final Decision Routes
// Handles approve/reject decisions for teacher applicants

import { processFinalDecision } from '../utils/teacherDecision.js';

export default function createTeacherDecisionRouter({ db, mailTransporter, requireAdmin, writeActivityLog }) {
  const router = async (req, res, next) => {
    // Only handle POST /final-decision
    if (req.method === 'POST' && req.path.endsWith('/final-decision')) {
      return handleFinalDecision(req, res);
    }
    next();
  };

  async function handleFinalDecision(req, res) {
    try {
      // Extract applicant ID from relative path pattern: /:id/final-decision
      // Since route is mounted at /api/teacher-applicants, req.path is relative
      const pathParts = req.path.split('/');
      const id = pathParts[1]; // ID is at index 1 in pattern "/:id/final-decision"

      if (!id || id === 'final-decision') {
        console.error('[teacher-decision] Failed to extract ID from path:', req.path);
        return res.status(400).json({ ok: false, error: 'Applicant ID is required' });
      }

      const { decision } = req.body;

      // Validate decision
      if (!decision || (decision !== 'approved' && decision !== 'rejected')) {
        return res.status(400).json({ 
          ok: false, 
          error: 'Invalid decision. Must be "approved" or "rejected"' 
        });
      }

      // Get applicant data
      const applicantDoc = await db.collection('teacherApplicants').doc(id).get();
      if (!applicantDoc.exists) {
        return res.status(404).json({ ok: false, error: 'Applicant not found' });
      }

      const applicantData = applicantDoc.data();

      // Process final decision
      const result = await processFinalDecision({
        applicantId: id,
        applicantData,
        decision,
        db,
        mailTransporter
      });

      // Log activity
      const adminUid = req.user?.uid || 'system';
      const adminEmail = req.user?.email || 'system';
      const actionType = decision === 'approved' ? 'teacher_approved' : 'teacher_rejected';
      const statusLabel = decision === 'approved' ? 'Approved & Archived' : 'Rejected';

      await writeActivityLog({
        actionType: actionType,
        performedBy: adminUid,
        performedByEmail: adminEmail,
        targetId: id,
        targetType: 'teacherApplicant',
        details: {
          applicantName: applicantData.fullName || `${applicantData.firstName} ${applicantData.lastName}`,
          applicantEmail: applicantData.email,
          decision: decision,
          status: statusLabel,
          deletionScheduled: result.deletionDate,
          emailSent: result.emailSent
        },
        timestamp: new Date()
      });

      return res.json({ 
        ok: true, 
        message: `Applicant ${decision === 'approved' ? 'approved' : 'rejected'} successfully`,
        ...result
      });

    } catch (error) {
      console.error('Error processing final decision:', error);
      return res.status(500).json({ ok: false, error: 'Failed to process decision' });
    }
  }

  return router;
}
