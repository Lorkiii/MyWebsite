import express from "express";

/**
 * Dashboard Statistics Router
 * Aggregates data for admin dashboard: quick stats, enrollment status, recent submissions, and activity logs
 */
export default function createDashboardStatsRouter(deps = {}) {
  const { db, admin, requireAdmin } = deps;

  // Validate dependencies
  if (!db) throw new Error("createDashboardStatsRouter requires deps.db (Firestore instance)");
  if (!admin) throw new Error("createDashboardStatsRouter requires deps.admin (firebase-admin)");
  if (typeof requireAdmin !== "function") throw new Error("createDashboardStatsRouter requires deps.requireAdmin middleware");

  const router = express.Router();

  router.get('/admin/dashboard-stats', requireAdmin, async (req, res) => {
    try {
      // Initialize response object
      const response = {
        quickStats: {
          totalStudents: 0,
          teacherApplicants: 0,
          enrollmentTarget: 200 // Can be made configurable later
        },
        enrollmentStatus: {
          total: 0,
          completed: 0,
          pending: 0
        },
        recentSubmissions: [],
        recentActivity: []
      };

      // QUICK STATS - Total Students & Teacher Applicants
    
      // Fetch ALL JHS applicants
      const jhsApplicantsSnap = await db.collection('jhsApplicants').get();
      const jhsApplicants = jhsApplicantsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      // Fetch ALL SHS applicants
      const shsApplicantsSnap = await db.collection('shsApplicants').get();
      const shsApplicants = shsApplicantsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      // Combine all applicants
      const allApplicants = [...jhsApplicants, ...shsApplicants];
      
      // Filter: enrolled === true AND archived !== true
      const enrolledStudents = allApplicants.filter(app => 
        app.enrolled === true && app.archived !== true
      );
      
      response.quickStats.totalStudents = enrolledStudents.length;

      // Fetch ALL teacher applicants and filter archived in JS
      const teacherAppsSnap = await db.collection('teacherApplicants').get();
      const teacherApps = teacherAppsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      // Filter: archived !== true
      const activeTeachers = teacherApps.filter(app => app.archived !== true);
      response.quickStats.teacherApplicants = activeTeachers.length;
      
      
      //  ENROLLMENT STATUS - Enrolled vs Not Enrolled 
      // Filter out archived applicants
      const activeApplicants = allApplicants.filter(app => app.archived !== true);
      
      response.enrollmentStatus.total = activeApplicants.length;
      
      // Completed = enrolled students (not archived)
      response.enrollmentStatus.completed = activeApplicants.filter(app => 
        app.enrolled === true
      ).length;
      
      // Pending = not yet enrolled (not archived)
      response.enrollmentStatus.pending = activeApplicants.filter(app => 
        app.enrolled !== true
      ).length;

      // RECENT SUBMISSIONS - Latest 10 applications
 
      // Use already fetched data and sort by date
      const allSubmissions = allApplicants
        .filter(app => app.createdAt) // Only those with submission date
        .map(app => {
          // Properly convert Firestore Timestamp to Date
          let submittedDate;
          if (app.submittedAt) {
            submittedDate = app.submittedAt.toDate ? app.submittedAt.toDate() : new Date(app.submittedAt);
          } else if (app.createdAt) {
            submittedDate = app.createdAt.toDate ? app.createdAt.toDate() : new Date(app.createdAt);
          } else {
            submittedDate = new Date();
          }
          
          return {
            id: app.id,
            name: app.displayName || app.name || (app.firstName && app.lastName ? `${app.firstName} ${app.lastName}` : null) || 'N/A',
            email: app.contactEmail || app.email || 'N/A',
            formType: app.formType === 'shs' ? 'SHS' : 'JHS',
            submittedAt: submittedDate
          };
        })
        .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime())
        .slice(0, 10);
      
      response.recentSubmissions = allSubmissions.map(sub => ({
        id: sub.id,
        name: sub.name,
        email: sub.email,
        formType: sub.formType,
        submittedAt: sub.submittedAt.toISOString()
      }));

      // RECENT ACTIVITY - Latest 10 activity logs    
      const activityLogsQuery = db.collection('activity_logs')
        .orderBy('timestamp', 'desc')
        .limit(10);
      const activityLogsSnap = await activityLogsQuery.get();
      
      response.recentActivity = activityLogsSnap.docs.map(doc => {
        const data = doc.data();
        const timestamp = data.timestamp?.toDate?.() || new Date();
        
        return {
          id: doc.id,
          date: timestamp.toISOString(),
          activity: data.action || 'Unknown activity',
          user: data.actorName || data.actorEmail || data.actorUid || 'System',
          detail: data.detail || '',
          action: data.action || ''
        };
      });

      // Return aggregated data
      return res.json(response);

    } catch (err) {
      console.error('[GET /api/admin/dashboard-stats] Error:', err);
      return res.status(500).json({ 
        error: 'Failed to fetch dashboard statistics',
        message: err.message 
      });
    }
  });
  
  return router;
}
