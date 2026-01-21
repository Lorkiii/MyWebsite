
import express from 'express';

export default function createNotesRouter(deps = {}) {
  const { db, requireAdmin } = deps;
  const router = express.Router();

  // fetch notes for current user
  router.get('/api/notes', requireAdmin, async (req, res) => {
    try {
      const userId = req.adminUser.uid;

      // Query notes collection filtered by userId, ordered by newest first
      const notesSnapshot = await db.collection('notes')
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .get();

      // Map Firestore documents to response format
      const notes = notesSnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          text: data.text || '',
          createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
          updatedAt: data.updatedAt?.toDate?.()?.toISOString() || null
        };
      });

    
      return res.json({ notes });

    } catch (err) {
      console.error('[Notes] Error fetching notes:', err);
      return res.status(500).json({ 
        error: 'Failed to fetch notes',
        message: err.message 
      });
    }
  });


  // POST /api/notes - Create a new note

  router.post('/api/notes', requireAdmin, async (req, res) => {
    try {
      const userId = req.adminUser.uid;
      const { text } = req.body;

      // Validate input
      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        return res.status(400).json({ error: 'Note text is required' });
      }

      // Limit note length to 500 characters
      if (text.length > 500) {
        return res.status(400).json({ error: 'Note text must be 500 characters or less' });
      }

      // Create note document in Firestore
      const noteData = {
        userId: userId,
        text: text.trim(),
        createdAt: new Date(),
        updatedAt: null
      };

      const docRef = await db.collection('notes').add(noteData);

      // Return created note with ID
      const createdNote = {
        id: docRef.id,
        text: noteData.text,
        createdAt: noteData.createdAt.toISOString(),
        updatedAt: null
      };

      console.log(`[Notes] Note created: ${docRef.id}`);
      return res.status(201).json({ note: createdNote });

    } catch (err) {
      console.error('[Notes] Error creating note:', err);
      return res.status(500).json({ 
        error: 'Failed to create note',
        message: err.message 
      });
    }
  });


  // PUT /api/notes/:noteId - Update an existing note

  router.put('/api/notes/:noteId', requireAdmin, async (req, res) => {
    try {
      const userId = req.adminUser.uid;
      const { noteId } = req.params;
      const { text } = req.body;

      // Validate input
      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        return res.status(400).json({ error: 'Note text is required' });
      }

      if (text.length > 500) {
        return res.status(400).json({ error: 'Note text must be 500 characters or less' });
      }

      // Get note document reference
      const noteRef = db.collection('notes').doc(noteId);
      const noteDoc = await noteRef.get();

      // Check if note exists
      if (!noteDoc.exists) {
        return res.status(404).json({ error: 'Note not found' });
      }

      // Check if user owns this note
      const noteData = noteDoc.data();
      if (noteData.userId !== userId) {
        return res.status(403).json({ error: 'You can only edit your own notes' });
      }

      // Update note in Firestore
      const updateData = {
        text: text.trim(),
        updatedAt: new Date()
      };

      await noteRef.update(updateData);

      // Return updated note
      const updatedNote = {
        id: noteId,
        text: updateData.text,
        createdAt: noteData.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
        updatedAt: updateData.updatedAt.toISOString()
      };

      
      return res.json({ note: updatedNote });

    } catch (err) {
      console.error('[Notes] Error updating note:', err);
      return res.status(500).json({ 
        error: 'Failed to update note',
        message: err.message 
      });
    }
  });


  // DELETE /api/notes/:noteId - Delete a note

  router.delete('/api/notes/:noteId', requireAdmin, async (req, res) => {
    try {
      const userId = req.adminUser.uid;
      const { noteId } = req.params;

      // Get note document reference
      const noteRef = db.collection('notes').doc(noteId);
      const noteDoc = await noteRef.get();

      // Check if note exists
      if (!noteDoc.exists) {
        return res.status(404).json({ error: 'Note not found' });
      }

      // Check if user owns this note
      const noteData = noteDoc.data();
      if (noteData.userId !== userId) {
        return res.status(403).json({ error: 'You can only delete your own notes' });
      }

      // Delete note from Firestore
      await noteRef.delete();

      return res.json({ 
        success: true,
        message: 'Note deleted successfully',
        noteId: noteId
      });

    } catch (err) {
      console.error('[Notes] Error deleting note:', err);
      return res.status(500).json({ 
        error: 'Failed to delete note',
        message: err.message 
      });
    }
  });

  return router;
}
