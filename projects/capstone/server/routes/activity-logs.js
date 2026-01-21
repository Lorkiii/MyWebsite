import express from "express";

export default function createActivityLogsRouter(deps = {}) {
  const { db, admin, requireAdmin, writeActivityLog } = deps;

  // Validate dependencies
  if (!db) throw new Error("createActivityLogsRouter requires deps.db (Firestore instance)");
  if (!admin) throw new Error("createActivityLogsRouter requires deps.admin (firebase-admin)");
  if (typeof requireAdmin !== "function") throw new Error("createActivityLogsRouter requires deps.requireAdmin middleware");

  const router = express.Router();

  // Constants
  const RETENTION_DAYS = 90;
  const AUTO_CLEAN_INTERVAL_DAYS = 7;

  // GET /admin/activity-logs
  // Fetch activity logs with optional limit
  router.get('/admin/activity-logs', requireAdmin, async (req, res) => {
    try {
      const { targetUid, limit = 50 } = req.query;
      
      // Build query
      let q = db.collection('activity_logs')
        .orderBy('timestamp', 'desc')
        .limit(Number(limit));
      
      // Filter by target user if provided
      if (targetUid) {
        q = q.where('targetUid', '==', targetUid);
      }
      
      // Fetch logs
      const snap = await q.get();
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      return res.json({ items });
    } catch (err) {
      console.error('[GET /admin/activity-logs] Error:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // ============================================
  // GET /admin/activity-logs/settings
  // Get auto-clean settings
  // ============================================
  router.get('/admin/activity-logs/settings', requireAdmin, async (req, res) => {
    try {
      // Fetch settings document
      const settingsRef = db.collection('settings').doc('activity_log_config');
      const settingsDoc = await settingsRef.get();
      
      // Default settings if document doesn't exist
      if (!settingsDoc.exists) {
        return res.json({
          autoCleanEnabled: false,
          retentionDays: RETENTION_DAYS,
          autoCleanIntervalDays: AUTO_CLEAN_INTERVAL_DAYS,
          lastCleanup: null
        });
      }
      
      return res.json(settingsDoc.data());
    } catch (err) {
      console.error('[GET /admin/activity-logs/settings] Error:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // ============================================
  // PATCH /admin/activity-logs/settings
  // Update auto-clean toggle
  // ============================================
  router.patch('/admin/activity-logs/settings', requireAdmin, async (req, res) => {
    try {
      const { autoCleanEnabled } = req.body;
      
      if (typeof autoCleanEnabled !== 'boolean') {
        return res.status(400).json({ error: 'autoCleanEnabled must be a boolean' });
      }
      
      // Update or create settings document
      const settingsRef = db.collection('settings').doc('activity_log_config');
      await settingsRef.set({
        autoCleanEnabled,
        retentionDays: RETENTION_DAYS,
        autoCleanIntervalDays: AUTO_CLEAN_INTERVAL_DAYS,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      
      // Log the settings change
      if (writeActivityLog) {
        await writeActivityLog({
          actorUid: req.adminUser?.uid || 'unknown',
          actorEmail: req.adminUser?.email || 'unknown',
          action: 'update-activity-log-settings',
          detail: `Auto-clean ${autoCleanEnabled ? 'enabled' : 'disabled'}`
        });
      }
      
      return res.json({ success: true, autoCleanEnabled });
    } catch (err) {
      console.log('[PATCH /admin/activity-logs/settings] Error:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // ============================================
  // GET /admin/activity-logs/count-old
  // Count logs older than specified days
  // ============================================
  router.get('/admin/activity-logs/count-old', requireAdmin, async (req, res) => {
    try {
      const days = parseInt(req.query.days) || RETENTION_DAYS;
      
      // Calculate threshold date
      const thresholdDate = new Date();
      thresholdDate.setDate(thresholdDate.getDate() - days);
      
      // Query old logs
      const snapshot = await db.collection('activity_logs')
        .where('timestamp', '<', admin.firestore.Timestamp.fromDate(thresholdDate))
        .get();
      
      return res.json({ count: snapshot.size });
    } catch (err) {
      console.error('[GET /admin/activity-logs/count-old] Error:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // ============================================
  // POST /admin/activity-logs/cleanup
  // Delete logs older than specified days
  // ============================================
  router.post('/admin/activity-logs/cleanup', requireAdmin, async (req, res) => {
    try {
      const days = parseInt(req.body.retentionDays) || RETENTION_DAYS;
      
      // Calculate threshold date
      const thresholdDate = new Date();
      thresholdDate.setDate(thresholdDate.getDate() - days);
      
      // Query old logs
      const snapshot = await db.collection('activity_logs')
        .where('timestamp', '<', admin.firestore.Timestamp.fromDate(thresholdDate))
        .get();
      
      const count = snapshot.size;
      
      // Delete in batches (Firestore batch limit is 500)
      const batchSize = 500;
      const batches = [];
      let currentBatch = db.batch();
      let operationCount = 0;
      
      snapshot.docs.forEach(doc => {
        currentBatch.delete(doc.ref);
        operationCount++;
        
        // If batch is full, save it and start a new one
        if (operationCount === batchSize) {
          batches.push(currentBatch);
          currentBatch = db.batch();
          operationCount = 0;
        }
      });
      
      // Add the last batch if it has operations
      if (operationCount > 0) {
        batches.push(currentBatch);
      }
      
      // Commit all batches
      await Promise.all(batches.map(batch => batch.commit()));
      
      // Update last cleanup time
      const settingsRef = db.collection('settings').doc('activity_log_config');
      await settingsRef.set({
        lastCleanup: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      
      // Log the cleanup action
      if (writeActivityLog) {
        await writeActivityLog({
          actorUid: req.adminUser?.uid || 'unknown',
          actorEmail: req.adminUser?.email || 'unknown',
          action: 'cleanup-activity-logs',
          detail: `Deleted ${count} logs older than ${days} days`
        });
      }
      
      return res.json({ 
        success: true, 
        deleted: count,
        message: `Deleted ${count} logs older than ${days} days`
      });
    } catch (err) {
      console.error('[POST /admin/activity-logs/cleanup] Error:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}
