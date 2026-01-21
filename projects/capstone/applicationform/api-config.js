/**
 * API Configuration for Enrollment Forms
 * Automatically detects environment and provides correct API URL
 * 
 * Usage:
 *   import { API_BASE_URL } from './api-config.js';
 *   fetch(`${API_BASE_URL}/api/enrollees/enrollees`, { ... });
 */

const getApiBaseUrl = () => {
  const { protocol, hostname } = window.location;
  
  // Development Mode: Forms on localhost:5500 (Live Server), API on localhost:3000
  // CORS is already configured in server.mjs to allow cross-origin requests
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    console.log('🔧 Development mode detected - API URL: http://localhost:3000');
    return 'http://localhost:3000';
  }
  
  // Production Mode: Forms and API on same domain
  // Example: https://yourschool.com/jhsform.html → https://yourschool.com/api/...
  console.log(`🚀 Production mode detected - API URL: ${protocol}//${hostname}`);
  return `${protocol}//${hostname}`;
};

export const API_BASE_URL = getApiBaseUrl();

// Log for debugging (can be removed in production if needed)
console.log('📡 Enrollment Forms - API Base URL:', API_BASE_URL);
