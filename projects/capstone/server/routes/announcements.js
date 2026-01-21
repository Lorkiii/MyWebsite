// server/routes/announcements.js
// Handles all announcement and news CRUD operations with image upload support

import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import crypto from 'crypto';

// Configure multer for file uploads (store in memory for processing)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }, // 30MB max upload size
  fileFilter: (req, file, cb) => {
    // Only accept image files
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, WebP, and GIF images are allowed.'));
    }
  }
});

export default function createAnnouncementsRouter(deps = {}) {
  const { db, admin, requireAdmin, writeActivityLog } = deps;
  const router = express.Router();
  
  // Helper: Generate random string for unique filenames
  function generateRandomId(length = 8) {
    return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
  }

  // Helper: Upload optimized image to Firebase Storage
  async function uploadImageToStorage(fileBuffer, originalFilename, postId) {
    try {
      // Optimize image: resize to max 1920px width, compress to 80% quality
      const optimizedBuffer = await sharp(fileBuffer)
        .resize(1920, null, { 
          withoutEnlargement: true, // Don't enlarge small images
          fit: 'inside' // Maintain aspect ratio
        })
        .jpeg({ quality: 80 }) // 80% quality compression as requested
        .toBuffer();

      // Generate unique filename
      const timestamp = Date.now();
      const randomId = generateRandomId();
      const extension = 'jpg'; // Always convert to JPEG after optimization
      const filename = `${timestamp}-${randomId}-${postId}.${extension}`;
      const filePath = `uploads/announcements/${filename}`;

      // Get Firebase Storage bucket
      const bucket = admin.storage().bucket();
      const fileRef = bucket.file(filePath);

      // Upload optimized image
      await fileRef.save(optimizedBuffer, {
        metadata: {
          contentType: 'image/jpeg',
          metadata: {
            originalName: originalFilename,
            optimized: 'true',
            quality: '80%'
          }
        }
      });

      // Make file publicly accessible
      await fileRef.makePublic();

      // Return public URL
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
      return publicUrl;

    } catch (error) {
      console.error('Error uploading image to storage:', error);
      throw new Error('Failed to upload image');
    }
  }

  // Helper: Delete image from Firebase Storage
  async function deleteImageFromStorage(imageUrl) {
    try {
      if (!imageUrl) return;

      // Extract file path from URL
      const bucket = admin.storage().bucket();
      const bucketName = bucket.name;
      const baseUrl = `https://storage.googleapis.com/${bucketName}/`;
      
      if (!imageUrl.startsWith(baseUrl)) {
        console.warn('Image URL does not match expected format:', imageUrl);
        return;
      }

      const filePath = imageUrl.replace(baseUrl, '');
      const fileRef = bucket.file(filePath);

      // Check if file exists before deleting
      const [exists] = await fileRef.exists();
      if (exists) {
        await fileRef.delete();
        console.log('Deleted image from storage:', filePath);
      }
    } catch (error) {
      console.error('Error deleting image from storage:', error);
      // Don't throw - image deletion failure shouldn't block other operations
    }
  }

  // Helper: Auto-cleanup old archived posts (45 days)
  async function cleanupOldArchivedPosts() {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 45); // 45 days ago

      const snapshot = await db.collection('announcements')
        .where('archived', '==', true)
        .where('archivedAt', '<', cutoffDate)
        .get();

      if (snapshot.empty) return;

      console.log(`Cleaning up ${snapshot.size} old archived posts...`);

      // Delete posts and their images
      const deletePromises = snapshot.docs.map(async (doc) => {
        const data = doc.data();
        
        // Delete image if exists
        if (data.imageUrl) {
          await deleteImageFromStorage(data.imageUrl);
        }
        
        // Delete document
        await doc.ref.delete();
      });

      await Promise.all(deletePromises);
      console.log(`Cleanup completed: ${snapshot.size} posts deleted`);
    } catch (error) {
      console.error('Error during cleanup:', error);
      // Don't throw - cleanup failure shouldn't affect main operations
    }
  }


  // CRUD ENDPOINTS


  // GET /api/announcements - Fetch all posts (public endpoint)
  router.get('/announcements', async (req, res) => {
    
    try {
      const { type, category, limit, includeArchived } = req.query;

      // Run cleanup in background (temporarily disabled - needs Firestore index)
      // cleanupOldArchivedPosts().catch(err => console.error('Background cleanup error:', err));

      // Build query
      let query = db.collection('announcements');

      // Filter by archived status (default: only active posts)
      if (includeArchived === 'true') {
        // Admin view: include all posts
        // (Note: This should ideally be protected by requireAdmin, but kept simple for now)
      } else {
        // Public view: only active posts
        query = query.where('archived', '==', false);
      }

      // Filter by type (announcement or news)
      if (type && (type === 'announcement' || type === 'news')) {
        query = query.where('type', '==', type);
      }

      // Filter by category
      if (category) {
        query = query.where('category', '==', category.toUpperCase());
      }

      // Sort by newest first (temporarily disabled - needs Firestore index)
      query = query.orderBy('createdAt', 'desc');

      // Apply limit
      const maxLimit = parseInt(limit) || 100; // Default 100, max safety
      query = query.limit(Math.min(maxLimit, 100));

      // Execute query
      const snapshot = await query.get();

      // Map documents to array
      const posts = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        // Convert Firestore timestamps to ISO strings
        createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || doc.data().createdAt,
        archivedAt: doc.data().archivedAt?.toDate?.()?.toISOString() || doc.data().archivedAt,
        updatedAt: doc.data().updatedAt?.toDate?.()?.toISOString() || doc.data().updatedAt
      }));

      return res.json({ 
        ok: true, 
        posts,
        count: posts.length 
      });

    } catch (error) {
      console.error('GET /api/announcements error:', error);
      return res.status(500).json({ 
        ok: false, 
        error: 'Failed to fetch announcements',
        message: error.message 
      });
    }
  });

  // GET /api/announcements/:id - Fetch single post (public endpoint)
  router.get('/announcements/:id', async (req, res) => {
    try {
      const { id } = req.params;

      const doc = await db.collection('announcements').doc(id).get();

      if (!doc.exists) {
        return res.status(404).json({ 
          ok: false, 
          error: 'Post not found' 
        });
      }

      const post = {
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || doc.data().createdAt,
        archivedAt: doc.data().archivedAt?.toDate?.()?.toISOString() || doc.data().archivedAt,
        updatedAt: doc.data().updatedAt?.toDate?.()?.toISOString() || doc.data().updatedAt
      };

      return res.json({ ok: true, post });

    } catch (error) {
      console.error('GET /api/announcements/:id error:', error);
      return res.status(500).json({ 
        ok: false, 
        error: 'Failed to fetch post',
        message: error.message 
      });
    }
  });

  // POST /api/announcements - Create new post with optional image (admin only)
  router.post('/announcements', requireAdmin, upload.single('image'), async (req, res) => {
    try {
      const { type, title, body, category } = req.body;
      const imageFile = req.file;

      // Validate required fields
      if (!type || (type !== 'announcement' && type !== 'news')) {
        return res.status(400).json({ 
          ok: false, 
          error: 'Invalid type. Must be "announcement" or "news"' 
        });
      }

      if (!title || !title.trim()) {
        return res.status(400).json({ 
          ok: false, 
          error: 'Title is required' 
        });
      }

      if (!body || !body.trim()) {
        return res.status(400).json({ 
          ok: false, 
          error: 'Body content is required' 
        });
      }

      if (!category) {
        return res.status(400).json({ 
          ok: false, 
          error: 'Category is required' 
        });
      }

      // Get admin info from request (set by requireAdmin middleware)
      const adminUid = req.adminUser?.uid || 'unknown';
      const adminEmail = req.adminUser?.email || 'unknown';

      // Get admin display name from Firestore
      let adminName = 'Admin';
      try {
        const adminDoc = await db.collection('users').doc(adminUid).get();
        if (adminDoc.exists) {
          adminName = adminDoc.data().displayName || adminDoc.data().email || 'Admin';
        }
      } catch (err) {
        console.warn('Failed to fetch admin name:', err.message);
      }

      // Create post document first (to get ID for image filename)
      const postRef = db.collection('announcements').doc();
      const postId = postRef.id;

      // Upload image if provided
      let imageUrl = null;
      if (imageFile) {
        imageUrl = await uploadImageToStorage(imageFile.buffer, imageFile.originalname, postId);
      }

      // Prepare post data
      const postData = {
        type: type.toLowerCase(),
        title: title.trim(),
        body: body.trim(),
        category: category.toUpperCase(),
        imageUrl: imageUrl,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: adminUid,
        createdByName: adminName,
        archived: false,
        archivedAt: null,
        updatedAt: null,
        updatedBy: null
      };

      // Save to Firestore
      await postRef.set(postData);

      // Log activity
      await writeActivityLog({
        actorUid: adminUid,
        actorEmail: adminEmail,
        action: 'create_announcement',
        detail: `Created ${type}: "${title}"`
      });

      // Return created post
      return res.json({ 
        ok: true, 
        message: 'Post created successfully',
        post: {
          id: postId,
          ...postData,
          createdAt: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('POST /api/announcements error:', error);
      return res.status(500).json({ 
        ok: false, 
        error: 'Failed to create post',
        message: error.message 
      });
    }
  });

  // PUT /api/announcements/:id - Update existing post (admin only)
  router.put('/announcements/:id', requireAdmin, upload.single('image'), async (req, res) => {
    try {
      const { id } = req.params;
      const { type, title, body, category, removeImage } = req.body;
      const newImageFile = req.file;

      // Fetch existing post
      const postRef = db.collection('announcements').doc(id);
      const postDoc = await postRef.get();

      if (!postDoc.exists) {
        return res.status(404).json({ 
          ok: false, 
          error: 'Post not found' 
        });
      }

      const existingData = postDoc.data();

      // Don't allow editing archived posts
      if (existingData.archived) {
        return res.status(400).json({ 
          ok: false, 
          error: 'Cannot edit archived post. Please restore it first.' 
        });
      }

      // Get admin info
      const adminUid = req.adminUser?.uid || 'unknown';
      const adminEmail = req.adminUser?.email || 'unknown';

      // Prepare update data (only update provided fields)
      const updateData = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: adminUid
      };

      if (type && (type === 'announcement' || type === 'news')) {
        updateData.type = type.toLowerCase();
      }

      if (title && title.trim()) {
        updateData.title = title.trim();
      }

      if (body && body.trim()) {
        updateData.body = body.trim();
      }

      if (category) {
        updateData.category = category.toUpperCase();
      }

      // Handle image changes
      let oldImageUrl = existingData.imageUrl;

      // If user wants to remove image
      if (removeImage === 'true' || removeImage === true) {
        if (oldImageUrl) {
          await deleteImageFromStorage(oldImageUrl);
        }
        updateData.imageUrl = null;
      }
      // If new image uploaded
      else if (newImageFile) {
        // Delete old image first
        if (oldImageUrl) {
          await deleteImageFromStorage(oldImageUrl);
        }
        // Upload new image
        const newImageUrl = await uploadImageToStorage(newImageFile.buffer, newImageFile.originalname, id);
        updateData.imageUrl = newImageUrl;
      }

      // Update document
      await postRef.update(updateData);

      // Log activity
      await writeActivityLog({
        actorUid: adminUid,
        actorEmail: adminEmail,
        action: 'update_announcement',
        detail: `Updated ${existingData.type}: "${existingData.title}"`
      });

      // Fetch and return updated post
      const updatedDoc = await postRef.get();
      const updatedPost = {
        id: updatedDoc.id,
        ...updatedDoc.data(),
        createdAt: updatedDoc.data().createdAt?.toDate?.()?.toISOString() || updatedDoc.data().createdAt,
        updatedAt: updatedDoc.data().updatedAt?.toDate?.()?.toISOString() || updatedDoc.data().updatedAt
      };

      return res.json({ 
        ok: true, 
        message: 'Post updated successfully',
        post: updatedPost
      });

    } catch (error) {
      console.error('PUT /api/announcements/:id error:', error);
      return res.status(500).json({ 
        ok: false, 
        error: 'Failed to update post',
        message: error.message 
      });
    }
  });

  // PUT /api/announcements/:id/archive - Archive post (soft delete, admin only)
  router.put('/announcements/:id/archive', requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;

      const postRef = db.collection('announcements').doc(id);
      const postDoc = await postRef.get();

      if (!postDoc.exists) {
        return res.status(404).json({ 
          ok: false, 
          error: 'Post not found' 
        });
      }

      // Get admin info
      const adminUid = req.adminUser?.uid || 'unknown';
      const adminEmail = req.adminUser?.email || 'unknown';

      // Archive the post
      await postRef.update({
        archived: true,
        archivedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: adminUid
      });

      // Log activity
      await writeActivityLog({
        actorUid: adminUid,
        actorEmail: adminEmail,
        action: 'archive_announcement',
        detail: `Archived ${postDoc.data().type}: "${postDoc.data().title}"`
      });

      return res.json({ 
        ok: true, 
        message: 'Post archived successfully' 
      });

    } catch (error) {
      console.error('PUT /api/announcements/:id/archive error:', error);
      return res.status(500).json({ 
        ok: false, 
        error: 'Failed to archive post',
        message: error.message 
      });
    }
  });

  // PUT /api/announcements/:id/restore - Restore archived post (admin only)
  router.put('/announcements/:id/restore', requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;

      const postRef = db.collection('announcements').doc(id);
      const postDoc = await postRef.get();

      if (!postDoc.exists) {
        return res.status(404).json({ 
          ok: false, 
          error: 'Post not found' 
        });
      }

      // Get admin info
      const adminUid = req.adminUser?.uid || 'unknown';
      const adminEmail = req.adminUser?.email || 'unknown';

      // Restore the post
      await postRef.update({
        archived: false,
        archivedAt: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: adminUid
      });

      // Log activity
      await writeActivityLog({
        actorUid: adminUid,
        actorEmail: adminEmail,
        action: 'restore_announcement',
        detail: `Restored ${postDoc.data().type}: "${postDoc.data().title}"`
      });

      return res.json({ 
        ok: true, 
        message: 'Post restored successfully' 
      });

    } catch (error) {
      console.error('PUT /api/announcements/:id/restore error:', error);
      return res.status(500).json({ 
        ok: false, 
        error: 'Failed to restore post',
        message: error.message 
      });
    }
  });

  // DELETE /api/announcements/:id - Permanently delete post (admin only, used by cleanup)
  router.delete('/announcements/:id', requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;

      const postRef = db.collection('announcements').doc(id);
      const postDoc = await postRef.get();

      if (!postDoc.exists) {
        return res.status(404).json({ 
          ok: false, 
          error: 'Post not found' 
        });
      }

      const postData = postDoc.data();

      // Get admin info
      const adminUid = req.adminUser?.uid || 'unknown';
      const adminEmail = req.adminUser?.email || 'unknown';

      // Delete image if exists
      if (postData.imageUrl) {
        await deleteImageFromStorage(postData.imageUrl);
      }

      // Delete document
      await postRef.delete();

      // Log activity
      await writeActivityLog({
        actorUid: adminUid,
        actorEmail: adminEmail,
        action: 'delete_announcement',
        detail: `Permanently deleted ${postData.type}: "${postData.title}"`
      });

      return res.json({ 
        ok: true, 
        message: 'Post permanently deleted' 
      });

    } catch (error) {
      console.error('DELETE /api/announcements/:id error:', error);
      return res.status(500).json({ 
        ok: false, 
        error: 'Failed to delete post',
        message: error.message 
      });
    }
  });

  return router;
}
