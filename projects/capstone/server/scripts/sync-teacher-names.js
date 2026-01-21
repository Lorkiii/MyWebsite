/**
 * One-time migration script to sync displayNames from users to teacher applicants
 * Run this script to sync all existing records
 * 
 * Usage: node sync-teacher-names.js
 */

import admin from 'firebase-admin';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '../../.env') });

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();

// Helper: Parse displayName into firstName, middleName, lastName
function parseDisplayName(displayName) {
  if (!displayName) return { firstName: '', middleName: '', lastName: '' };
  
  const parts = displayName.trim().split(/\s+/);
  
  if (parts.length === 0) {
    return { firstName: '', middleName: '', lastName: '' };
  } else if (parts.length === 1) {
    return { firstName: parts[0], middleName: '', lastName: '' };
  } else if (parts.length === 2) {
    return { firstName: parts[0], middleName: '', lastName: parts[1] };
  } else {
    return { 
      firstName: parts[0], 
      middleName: parts.slice(1, -1).join(' '), 
      lastName: parts[parts.length - 1] 
    };
  }
}

async function syncAllTeacherNames() {
  console.log('🚀 Starting teacher name sync migration...\n');
  
  let syncedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  
  try {
    // Get all teacher applicants with uid
    const applicantsSnapshot = await db.collection('teacherApplicants')
      .where('uid', '!=', null)
      .get();
    
    console.log(`Found ${applicantsSnapshot.size} teacher applicants with user accounts\n`);
    
    // Process each applicant
    for (const applicantDoc of applicantsSnapshot.docs) {
      const applicantData = applicantDoc.data();
      const uid = applicantData.uid;
      
      try {
        // Get user record
        const userDoc = await db.collection('users').doc(uid).get();
        
        if (!userDoc.exists) {
          console.log(`⚠️  User not found for uid: ${uid}`);
          skippedCount++;
          continue;
        }
        
        const userData = userDoc.data();
        const displayName = userData.displayName;
        
        if (!displayName) {
          console.log(`⚠️  No displayName for user: ${uid}`);
          skippedCount++;
          continue;
        }
        
        // Parse the display name
        const { firstName, middleName, lastName } = parseDisplayName(displayName);
        
        // Check if update is needed
        const currentFirstName = applicantData.firstName || '';
        const currentLastName = applicantData.lastName || '';
        const currentMiddleName = applicantData.middleName || '';
        
        if (currentFirstName === firstName && 
            currentMiddleName === middleName && 
            currentLastName === lastName) {
          console.log(`✓ Already synced: ${displayName}`);
          skippedCount++;
          continue;
        }
        
        // Update the teacher applicant
        await applicantDoc.ref.update({
          firstName: firstName || '',
          middleName: middleName || '',
          lastName: lastName || '',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`✅ Synced: ${displayName} → ${firstName} ${middleName} ${lastName}`);
        syncedCount++;
        
      } catch (error) {
        console.error(`❌ Error processing applicant ${applicantDoc.id}:`, error.message);
        errorCount++;
      }
    }
    
    // Summary
    console.log('\n📊 Migration Summary:');
    console.log(`✅ Successfully synced: ${syncedCount}`);
    console.log(`⚠️  Skipped: ${skippedCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log(`📋 Total processed: ${applicantsSnapshot.size}`);
    
  } catch (error) {
    console.error('Fatal error during migration:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

// Run the migration
syncAllTeacherNames();
