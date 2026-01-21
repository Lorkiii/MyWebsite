import express from 'express';

export default function createEnrollmentRouter(deps = {}) {
  const { db, requireAdmin, writeActivityLog } = deps;
  const router = express.Router();

  // GET /api/enrollment/status - Public endpoint to check if enrollment is open
  router.get('/status', async (req, res) => {
    try {
      const doc = await db.collection('settings').doc('enrollment').get();
      
      if (!doc.exists) {
        // Default: both closed
        return res.json({
          jhs: { status: 'closed', isOpen: false, startDate: null, endDate: null },
          shs: { status: 'closed', isOpen: false, startDate: null, endDate: null }
        });
      }

      const data = doc.data();
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Calculate JHS status - Check isOpen field first for manual control
      const jhsStart = data.jhs?.startDate ? new Date(data.jhs.startDate) : null;
      const jhsEnd = data.jhs?.endDate ? new Date(data.jhs.endDate) : null;
      const jhsIsOpen = data.jhs?.isOpen ?? true; // Default to true if not set (backward compatibility)
      const jhsStatus = calculateStatus(today, jhsStart, jhsEnd, jhsIsOpen);

      // Calculate SHS status - Check isOpen field first for manual control
      const shsStart = data.shs?.startDate ? new Date(data.shs.startDate) : null;
      const shsEnd = data.shs?.endDate ? new Date(data.shs.endDate) : null;
      const shsIsOpen = data.shs?.isOpen ?? true; // Default to true if not set (backward compatibility)
      const shsStatus = calculateStatus(today, shsStart, shsEnd, shsIsOpen);

      return res.json({
        jhs: {
          status: jhsStatus.status,
          isOpen: jhsIsOpen,
          startDate: data.jhs?.startDate || null,
          endDate: data.jhs?.endDate || null,
          daysRemaining: jhsStatus.daysRemaining
        },
        shs: {
          status: shsStatus.status,
          isOpen: shsIsOpen,
          startDate: data.shs?.startDate || null,
          endDate: data.shs?.endDate || null,
          daysRemaining: shsStatus.daysRemaining
        }
      });
    } catch (err) {
      console.error('Error fetching enrollment status:', err);
      return res.status(500).json({ error: 'Failed to fetch enrollment status' });
    }
  });

  // GET /api/enrollment/settings - Admin only
  router.get('/settings', requireAdmin, async (req, res) => {
    try {
      const doc = await db.collection('settings').doc('enrollment').get();
      
      if (!doc.exists) {
        return res.json({
          jhs: { startDate: '', endDate: '' },
          shs: { startDate: '', endDate: '' }
        });
      }

      return res.json(doc.data());
    } catch (err) {
      console.error('Error fetching enrollment settings:', err);
      return res.status(500).json({ error: 'Failed to fetch settings' });
    }
  });

  // PUT /api/enrollment/settings - Admin only
  router.put('/settings', requireAdmin, async (req, res) => {
    try {
      const { jhs, shs } = req.body;

      // Validate dates
      if (!jhs?.startDate || !jhs?.endDate || !shs?.startDate || !shs?.endDate) {
        return res.status(400).json({ error: 'All dates are required' });
      }

      // Validate date order
      if (new Date(jhs.startDate) > new Date(jhs.endDate)) {
        return res.status(400).json({ error: 'JHS start date must be before end date' });
      }
      if (new Date(shs.startDate) > new Date(shs.endDate)) {
        return res.status(400).json({ error: 'SHS start date must be before end date' });
      }

      const data = {
        jhs: {
          startDate: jhs.startDate,
          endDate: jhs.endDate,
          isOpen: jhs.isOpen ?? true // Preserve isOpen status or default to true
        },
        shs: {
          startDate: shs.startDate,
          endDate: shs.endDate,
          isOpen: shs.isOpen ?? true // Preserve isOpen status or default to true
        },
        updatedAt: new Date().toISOString(),
        updatedBy: req.adminUser?.email || req.user?.email || 'admin'
      };

      await db.collection('settings').doc('enrollment').set(data, { merge: true });

      // Log activity
      if (writeActivityLog) {
        await writeActivityLog({
          actorUid: req.adminUser?.uid || req.user?.uid,
          actorEmail: req.adminUser?.email || req.user?.email,
          action: 'update-enrollment-settings',
          detail: JSON.stringify({
            jhs: { startDate: jhs.startDate, endDate: jhs.endDate },
            shs: { startDate: shs.startDate, endDate: shs.endDate }
          })
        });
      }

      return res.json({ ok: true, message: 'Enrollment settings updated successfully' });
    } catch (err) {
      console.error('Error updating enrollment settings:', err);
      return res.status(500).json({ error: 'Failed to update settings' });
    }
  });

  // POST /api/enrollment/start - Start enrollment with dates (Admin only)
  router.post('/start', requireAdmin, async (req, res) => {
    try {
      const { level, startDate, endDate } = req.body;

      // Validate level (jhs or shs)
      if (!level || (level !== 'jhs' && level !== 'shs')) {
        return res.status(400).json({ error: 'Invalid level. Must be "jhs" or "shs"' });
      }

      // Validate dates
      if (!startDate || !endDate) {
        return res.status(400).json({ error: 'Start date and end date are required' });
      }

      // Validate date order
      if (new Date(startDate) > new Date(endDate)) {
        return res.status(400).json({ error: 'Start date must be before end date' });
      }

      // Get current enrollment document
      const docRef = db.collection('settings').doc('enrollment');
      const doc = await docRef.get();
      const currentData = doc.exists ? doc.data() : {};

      // Update the specific level with isOpen = true
      const updateData = {
        [level]: {
          startDate: startDate,
          endDate: endDate,
          isOpen: true // Manually open enrollment
        },
        updatedAt: new Date().toISOString(),
        updatedBy: req.user?.email || req.adminUser?.email || 'admin'
      };

      // Merge with existing data to preserve other level's settings
      await docRef.set(updateData, { merge: true });

      console.log(`✅ Enrollment started for ${level.toUpperCase()}: ${startDate} to ${endDate}`);

      // Log activity
      if (writeActivityLog) {
        await writeActivityLog({
          actorUid: req.adminUser?.uid || req.user?.uid,
          actorEmail: req.adminUser?.email || req.user?.email,
          action: 'start-enrollment',
          detail: JSON.stringify({
            level: level.toUpperCase(),
            startDate: startDate,
            endDate: endDate,
            action: 'opened'
          })
        });
      }

      return res.json({ 
        ok: true, 
        message: `${level.toUpperCase()} enrollment started successfully`,
        data: updateData[level]
      });
    } catch (err) {
      console.error('Error starting enrollment:', err);
      return res.status(500).json({ error: 'Failed to start enrollment' });
    }
  });

  // POST /api/enrollment/close - Close enrollment immediately (Admin only)
  router.post('/close', requireAdmin, async (req, res) => {
    try {
      const { level } = req.body;

      // Validate level (jhs or shs)
      if (!level || (level !== 'jhs' && level !== 'shs')) {
        return res.status(400).json({ error: 'Invalid level. Must be "jhs" or "shs"' });
      }

      // Get current enrollment document
      const docRef = db.collection('settings').doc('enrollment');
      const doc = await docRef.get();
      
      if (!doc.exists) {
        return res.status(404).json({ error: 'Enrollment settings not found' });
      }

      const currentData = doc.data();
      const levelData = currentData[level] || {};

      // Update only the isOpen field to false, keep dates intact
      const updateData = {
        [level]: {
          ...levelData,
          isOpen: false // Manually close enrollment
        },
        updatedAt: new Date().toISOString(),
        updatedBy: req.user?.email || req.adminUser?.email || 'admin'
      };

      await docRef.set(updateData, { merge: true });

      console.log(`❌ Enrollment closed for ${level.toUpperCase()}`);

      // Log activity
      if (writeActivityLog) {
        await writeActivityLog({
          actorUid: req.adminUser?.uid || req.user?.uid,
          actorEmail: req.adminUser?.email || req.user?.email,
          action: 'close-enrollment',
          detail: JSON.stringify({
            level: level.toUpperCase(),
            startDate: levelData.startDate,
            endDate: levelData.endDate,
            action: 'closed'
          })
        });
      }

      return res.json({ 
        ok: true, 
        message: `${level.toUpperCase()} enrollment closed successfully` 
      });
    } catch (err) {
      console.error('Error closing enrollment:', err);
      return res.status(500).json({ error: 'Failed to close enrollment' });
    }
  });

  return router;
}

// Helper function to calculate enrollment status
// Now considers manual isOpen flag for admin control
function calculateStatus(today, startDate, endDate, isOpen) {
  // If manually closed by admin, always return closed status
  if (isOpen === false) {
    return { status: 'closed', daysRemaining: 0 };
  }

  // If no dates set, return closed
  if (!startDate || !endDate) {
    return { status: 'closed', daysRemaining: 0 };
  }

  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(0, 0, 0, 0);

  if (today < startDate) {
    // Not started yet
    const daysUntil = Math.ceil((startDate - today) / (1000 * 60 * 60 * 24));
    return { status: 'upcoming', daysRemaining: daysUntil };
  } else if (today > endDate) {
    // Already ended
    return { status: 'closed', daysRemaining: 0 };
  } else {
    // Currently open (within date range and isOpen = true)
    const daysLeft = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
    return { status: 'open', daysRemaining: daysLeft };
  }
}
