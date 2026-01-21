import express from 'express';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { firebaseConfig } from '../../server-firebase-client-config.js';

export default function createTeacherProfileRouter(deps = {}) {
  const { db, admin, requireAuth, writeActivityLog } = deps;
  const router = express.Router();

  // Initialize Firebase client auth for password verification
  let clientAuth = null;
  function getClientAuth() {
    if (!clientAuth) {
      const clientApp = initializeApp(firebaseConfig, 'auth-client');
      clientAuth = getAuth(clientApp);
    }
    return clientAuth;
  }

  // Helper: Verify current password using Firebase signInWithEmailAndPassword
  async function verifyPassword(email, password) {
    try {
      const auth = getClientAuth();
      await signInWithEmailAndPassword(auth, email, password);
      return true;
    } catch (err) {
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        throw new Error('Current password is incorrect');
      }
      if (err.code === 'auth/user-not-found') {
        throw new Error('User not found');
      }
      throw new Error(err.message || 'Failed to verify password');
    }
  }

  // Helper: Validate password requirements
  function validatePassword(password) {
    if (!password || password.length < 8) {
      return { valid: false, error: 'Password must be at least 8 characters long' };
    }
    
    if (!/[a-zA-Z]/.test(password)) {
      return { valid: false, error: 'Password must contain letters (a-z, A-Z)' };
    }
    
    if (!/[0-9]/.test(password)) {
      return { valid: false, error: 'Password must contain numbers (0-9)' };
    }
    
    return { valid: true };
  }

  // GET /api/teacher/profile - Get current teacher's profile
  router.get('/api/teacher/profile', requireAuth, async (req, res) => {
    try {
      const uid = req.user.uid;

      // Fetch user profile from Firestore
      const userDoc = await db.collection('users').doc(uid).get();
      
      if (!userDoc.exists) {
        return res.status(404).json({ error: 'Profile not found' });
      }

      const userData = userDoc.data();

      return res.json({
        displayName: userData.displayName || '',
        email: userData.email || req.user.email || '',
        phone: userData.phoneNumber || null
      });

    } catch (err) {
      console.error('[Teacher Profile] Error fetching profile:', err);
      return res.status(500).json({ 
        error: 'Failed to load profile',
        message: err.message 
      });
    }
  });

  // PUT /api/teacher/profile - Update teacher's phone number
  router.put('/api/teacher/profile', requireAuth, async (req, res) => {
    try {
      const uid = req.user.uid;
      const { phone } = req.body;

      // Validate phone format (must be +639XXXXXXXXX or null)
      if (phone !== null && phone !== undefined && phone !== '') {
        if (!/^\+639\d{9}$/.test(phone)) {
          return res.status(400).json({ 
            ok: false,
            error: 'Invalid phone format. Must be +639XXXXXXXXX (10 digits after +63)' 
          });
        }
      }

      const phoneValue = phone || null;

      // Update Firestore
      await db.collection('users').doc(uid).set({
        phoneNumber: phoneValue,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      // Update Firebase Auth
      try {
        await admin.auth().updateUser(uid, { 
          phoneNumber: phoneValue 
        });
      } catch (authErr) {
        console.warn('[Teacher Profile] Failed to update Firebase Auth phone:', authErr.message);
      }

      // Log activity for admin audit trail
      const userDoc = await db.collection('users').doc(uid).get();
      const userData = userDoc.data();
      
      await writeActivityLog?.({
        actorUid: uid,
        actorEmail: userData.email || req.user.email,
        targetUid: uid,
        action: 'update-teacher-profile',
        detail: JSON.stringify({ phone: phoneValue })
      });

      return res.json({ ok: true });

    } catch (err) {
      console.error('[Teacher Profile] Error updating profile:', err);
      return res.status(500).json({ 
        ok: false,
        error: 'Failed to update profile',
        message: err.message 
      });
    }
  });

  // POST /api/teacher/change-password - Change teacher's password
  router.post('/api/teacher/change-password', requireAuth, async (req, res) => {
    try {
      const uid = req.user.uid;
      const { currentPassword, newPassword } = req.body;

      // Validate inputs
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ 
          ok: false,
          error: 'Current password and new password are required' 
        });
      }

      // Validate new password requirements
      const validation = validatePassword(newPassword);
      if (!validation.valid) {
        return res.status(400).json({ 
          ok: false,
          error: validation.error 
        });
      }

      // Check if new password is same as current
      if (currentPassword === newPassword) {
        return res.status(400).json({ 
          ok: false,
          error: 'New password must be different from current password' 
        });
      }

      // Get user email from Firestore
      const userDoc = await db.collection('users').doc(uid).get();
      if (!userDoc.exists) {
        return res.status(404).json({ 
          ok: false,
          error: 'User profile not found' 
        });
      }

      const userData = userDoc.data();
      const email = userData.email || req.user.email;

      if (!email) {
        return res.status(400).json({ 
          ok: false,
          error: 'Email not found for password verification' 
        });
      }

      // Verify current password
      try {
        await verifyPassword(email, currentPassword);
      } catch (verifyErr) {
        return res.status(401).json({ 
          ok: false,
          error: verifyErr.message || 'Current password is incorrect' 
        });
      }

      // Update password in Firebase Auth
      await admin.auth().updateUser(uid, { 
        password: newPassword 
      });

      // Remove forcePasswordChange flag if it exists
      await db.collection('users').doc(uid).update({
        forcePasswordChange: false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Log password change activity for admin audit trail
      await writeActivityLog?.({
        actorUid: uid,
        actorEmail: email,
        targetUid: uid,
        action: 'change-teacher-password',
        detail: 'Password changed successfully'
      });

      return res.json({ ok: true });

    } catch (err) {
      console.error('[Teacher Profile] Error changing password:', err);
      return res.status(500).json({ 
        ok: false,
        error: 'Failed to change password',
        message: err.message 
      });
    }
  });

  return router;
}
