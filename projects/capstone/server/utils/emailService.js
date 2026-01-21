/**
 * Email Service Utility
 * Simple wrapper for sending emails via nodemailer
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Send an email using the provided mail transporter
 * @param {Object} transporter - Nodemailer transporter instance
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML email body
 * @param {string} options.from - Sender email (optional, uses transporter default)
 * @returns {Promise<Object>} - Result object with success status
 */
export async function sendEmail(transporter, { to, subject, html, from }) {
  if (!transporter) {
    throw new Error("Email transporter not configured");
  }

  if (!to || !subject || !html) {
    throw new Error("Missing required email fields: to, subject, or html");
  }

  try {
    const mailOptions = {
      from: from || process.env.SMTP_USER || "noreply@holyfamilyacademy.edu",
      to,
      subject,
      html,
    };

    const info = await transporter.sendMail(mailOptions);

    console.log(`[emailService] Email sent to ${to}: ${info.messageId}`);

    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error) {
    console.error("[emailService] Failed to send email:", error);
    throw new Error(error.message || "Failed to send email");
  }
}

// Cache the email template to avoid reading file multiple times
let emailTemplateCache = null;

/**
 * Load email template from file
 * @returns {string} - HTML template content
 */
function loadEmailTemplate() {
  if (emailTemplateCache) {
    return emailTemplateCache;
  }

  try {
    const templatePath = join(__dirname, '../templates/email-template.html');
    emailTemplateCache = readFileSync(templatePath, 'utf-8');
    return emailTemplateCache;
  } catch (error) {
    console.error('[emailService] Failed to load email template:', error);
    throw new Error('Email template file not found');
  }
}

/**
 * Create a formatted HTML email template
 * PHASE 8: Refactored to use external HTML template file
 * @param {Object} options - Template options
 * @param {string} options.title - Email title
 * @param {string} options.content - Main email content (can include HTML)
 * @param {string} options.footer - Footer text (optional)
 * @returns {string} - Formatted HTML email
 */
export function createEmailTemplate({ title, content, footer }) {
  try {
    // Load template from external file
    let template = loadEmailTemplate();

    // Replace placeholders with actual values
    template = template.replace(/\{\{TITLE\}\}/g, title || 'Holy Family Academy');
    template = template.replace(/\{\{CONTENT\}\}/g, content || '');
    template = template.replace(
      /\{\{FOOTER\}\}/g,
      footer || 'This is an automated message from Holy Family Academy. Please do not reply to this email.'
    );
    template = template.replace(/\{\{YEAR\}\}/g, new Date().getFullYear());

    return template;
  } catch (error) {
    console.error('[emailService] Failed to create email template:', error);
    // Fallback: return a basic HTML template
    return `
      <html>
        <body>
          <h1>${title || 'Holy Family Academy'}</h1>
          <div>${content}</div>
          <p><small>${footer || 'Holy Family Academy'}</small></p>
        </body>
      </html>
    `;
  }
}
