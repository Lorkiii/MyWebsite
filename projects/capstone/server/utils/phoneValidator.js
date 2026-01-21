/**
 * Phone Number Validator and Formatter
 * Validates and formats Philippine mobile numbers to +639XXXXXXXXX format
 */

/**
 * Validates and formats a Philippine mobile number
 * @param {string} phone - Phone number in various formats
 * @returns {string} Formatted phone number (+639XXXXXXXXX)
 * @throws {Error} If phone number is invalid
 */
function validateAndFormatPhone(phone) {
  // Handle null/undefined
  if (!phone || typeof phone !== 'string') {
    throw new Error('Phone number is required');
  }

  // Remove all non-digit characters (spaces, dashes, parentheses, etc.)
  const cleaned = phone.replace(/\D/g, '');

  // Check if empty after cleaning
  if (!cleaned) {
    throw new Error('Phone number must contain digits');
  }

  let formattedPhone;

  // Case 1: Already in format 639XXXXXXXXX (12 digits starting with 63)
  if (cleaned.startsWith('63') && cleaned.length === 12) {
    formattedPhone = '+' + cleaned;
  }
  // Case 2: Format 9XXXXXXXXX (10 digits starting with 9)
  else if (cleaned.startsWith('9') && cleaned.length === 10) {
    formattedPhone = '+63' + cleaned;
  }
  // Case 3: Format 09XXXXXXXXX (11 digits starting with 0)
  else if (cleaned.startsWith('0') && cleaned.length === 11) {
    // Remove leading 0 and add +63
    formattedPhone = '+63' + cleaned.substring(1);
  }
  // Invalid format
  else {
    throw new Error('Invalid phone number format. Must be 10 digits starting with 9 (e.g., 9123456789)');
  }

  // Final validation: Ensure the mobile number part starts with 9
  const mobileNumber = formattedPhone.replace('+63', '');
  if (!mobileNumber.startsWith('9')) {
    throw new Error('Phone number must start with 9 (Philippine mobile format)');
  }

  // Final validation: Ensure correct length
  if (formattedPhone.length !== 13) {
    throw new Error('Invalid phone number length');
  }

  return formattedPhone;
}

export { validateAndFormatPhone };
