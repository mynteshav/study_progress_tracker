import emailjs from '@emailjs/browser';

// EmailJS configuration from environment variables
const SERVICE_ID = import.meta.env.VITE_EMAILJS_SERVICE_ID || '';
const TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID || '';
const PUBLIC_KEY = import.meta.env.VITE_EMAILJS_PUBLIC_KEY || '';

// Track initialization
let initialized = false;

/**
 * Initialize EmailJS with the public key.
 * Safe to call multiple times — only initializes once.
 */
function initEmailJS(): boolean {
  if (initialized) return true;

  if (!PUBLIC_KEY || PUBLIC_KEY === 'your_public_key_here') {
    console.warn('[EmailJS] Public key not configured. Emails will not be sent.');
    return false;
  }

  emailjs.init(PUBLIC_KEY);
  initialized = true;
  console.log('[EmailJS] Initialized successfully.');
  return true;
}

/**
 * Check if EmailJS is properly configured with real credentials.
 */
export function isEmailConfigured(): boolean {
  return (
    !!SERVICE_ID &&
    SERVICE_ID !== 'your_service_id_here' &&
    !!TEMPLATE_ID &&
    TEMPLATE_ID !== 'your_template_id_here' &&
    !!PUBLIC_KEY &&
    PUBLIC_KEY !== 'your_public_key_here'
  );
}

interface SendResetEmailParams {
  toEmail: string;
  userName: string;
  resetLink: string;
}

/**
 * Send a password reset email via EmailJS.
 *
 * EmailJS template should use these variables:
 *   {{to_email}}    — recipient email address
 *   {{user_name}}   — display name of the user
 *   {{reset_link}}  — full URL to the password reset page
 *   {{app_name}}    — application name (always "Study Tracker")
 *
 * @returns true if email sent successfully, false otherwise
 */
export async function sendPasswordResetEmail({
  toEmail,
  userName,
  resetLink,
}: SendResetEmailParams): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.warn('[EmailJS] Not configured — skipping email send.');
    return false;
  }

  if (!initEmailJS()) {
    return false;
  }

  try {
    const templateParams = {
      to_email: toEmail,
      user_name: userName || 'User',
      reset_link: resetLink,
      app_name: 'Study Tracker',
    };

    const response = await emailjs.send(SERVICE_ID, TEMPLATE_ID, templateParams);
    console.log('[EmailJS] Email sent successfully:', response.status, response.text);
    return true;
  } catch (error: any) {
    console.error('[EmailJS] Failed to send email:', error);
    return false;
  }
}
