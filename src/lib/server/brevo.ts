import { BREVO_API_KEY } from '$env/static/private';
import { BREVO_SENDER_EMAIL, BREVO_SENDER_NAME } from '$env/dynamic/private';

/**
 * Brevo (API) email sender.
 *
 * IMPORTANT RAILWAY + BREVO GOTCHA:
 * Brevo has "IP security & authorization" (Settings > Security > Authorized IPs).
 * When "Block unknown IP addresses" is enabled for API keys, calls from
 * previously unseen IPs are rejected (even with a valid key).
 *
 * Railway (especially Hobby plan) uses dynamic outbound IPs that can change
 * on deploys, restarts, or scaling. This is the most common cause of
 * sudden "Brevo API error: 401/403 ..." after things were working.
 *
 * Quick test fix: In Brevo, go to Authorized IPs and deactivate blocking
 * for API keys (or manually authorize the IP shown in the logs below).
 *
 * For a stable long-term solution, consider Railway Pro + Static Outbound IPs
 * (then whitelist those fixed IPs in Brevo), or switch to an email provider
 * that is more tolerant of dynamic egress IPs.
 */

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

interface BrevoEmailPayload {
	sender: { name: string; email: string };
	to: Array<{ email: string; name?: string }>;
	subject: string;
	htmlContent: string;
}

async function getOutboundIp(): Promise<string> {
	try {
		const res = await fetch('https://api.ipify.org?format=json');
		if (res.ok) {
			const data = (await res.json()) as { ip?: string };
			return data.ip || 'unknown';
		}
	} catch {
		// ignore — IP detection is best-effort for debugging
	}
	return 'unknown';
}

async function sendBrevoEmail(payload: BrevoEmailPayload) {
	if (!BREVO_API_KEY) {
		throw new Error('BREVO_API_KEY is not configured (server env var missing)');
	}
	if (!payload.sender?.email) {
		throw new Error('No sender email configured (BREVO_SENDER_EMAIL env var missing or empty)');
	}

	const outboundIp = await getOutboundIp();
	console.log(`[brevo] Sending email via Brevo from outbound IP: ${outboundIp} (sender: ${payload.sender.email})`);

	const res = await fetch(BREVO_ENDPOINT, {
		method: 'POST',
		headers: {
			accept: 'application/json',
			'api-key': BREVO_API_KEY,
			'content-type': 'application/json'
		},
		body: JSON.stringify(payload)
	});

	if (!res.ok) {
		const errorText = await res.text();
		console.error(`[brevo] Brevo rejected send from IP ${outboundIp}: ${res.status} ${errorText}`);
		throw new Error(`Brevo API error: ${res.status} ${errorText}`);
	}

	console.log(`[brevo] Email accepted by Brevo (from IP ${outboundIp})`);
}

const SENDER = {
	name: BREVO_SENDER_NAME || 'Capital City Windows',
	email: BREVO_SENDER_EMAIL || ''
};

if (!SENDER.email) {
	console.warn('[brevo] BREVO_SENDER_EMAIL is not set — emails will fail until configured in Railway env vars.');
}

const LOGO_HTML = `<img src="https://static.wixstatic.com/media/5bfb6f_e26c222c0bf648c39eeed8e67ae87701.png/v1/fill/w_71,h_68,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/5bfb6f_e26c222c0bf648c39eeed8e67ae87701.png" style="height:40px; vertical-align:middle;" alt="Capital City Windows"> <strong style="font-size:20px; vertical-align:middle;">Capital City Windows</strong>`;

const CREDIT_HTML = `<p style="color:#999; font-size:10px; margin-top:16px;">Transactional emails powered by Brevo</p>`;

// === AUTH EMAILS (use links from PB internal routes) ===

export async function sendVerificationEmail(to: string, link: string) {
	const html = `
		<div style="font-family: sans-serif; max-width: 600px; line-height: 1.5;">
			${LOGO_HTML}
			<h2>Verify your email</h2>
			<p>Please confirm your email address for your Capital City Windows account.</p>
			<p><a href="${link}" style="background:#1e3a8a; color:white; padding:12px 24px; text-decoration:none; border-radius:4px; display:inline-block;">Verify Email</a></p>
			<p style="color:#666; font-size:12px;">If you did not request this, you can safely ignore this email.</p>
			${CREDIT_HTML}
		</div>
	`;
	await sendBrevoEmail({
		sender: SENDER,
		to: [{ email: to }],
		subject: 'Verify your email - Capital City Windows',
		htmlContent: html
	});
}

export async function sendPasswordResetEmail(to: string, link: string) {
	const html = `
		<div style="font-family: sans-serif; max-width: 600px; line-height: 1.5;">
			${LOGO_HTML}
			<h2>Reset your password</h2>
			<p>Click the button below to reset your password for your Capital City Windows account.</p>
			<p><a href="${link}" style="background:#1e3a8a; color:white; padding:12px 24px; text-decoration:none; border-radius:4px; display:inline-block;">Reset Password</a></p>
			<p style="color:#666; font-size:12px;">If you did not request this, you can safely ignore this email.</p>
			${CREDIT_HTML}
		</div>
	`;
	await sendBrevoEmail({
		sender: SENDER,
		to: [{ email: to }],
		subject: 'Reset your password - Capital City Windows',
		htmlContent: html
	});
}

export async function sendEmailChangeConfirmation(to: string, link: string) {
	const html = `
		<div style="font-family: sans-serif; max-width: 600px; line-height: 1.5;">
			${LOGO_HTML}
			<h2>Confirm email change</h2>
			<p>Click the button below to confirm your new email address for your Capital City Windows account.</p>
			<p><a href="${link}" style="background:#1e3a8a; color:white; padding:12px 24px; text-decoration:none; border-radius:4px; display:inline-block;">Confirm Email Change</a></p>
			<p style="color:#666; font-size:12px;">If you did not request this, you can safely ignore this email.</p>
			${CREDIT_HTML}
		</div>
	`;
	await sendBrevoEmail({
		sender: SENDER,
		to: [{ email: to }],
		subject: 'Confirm email change - Capital City Windows',
		htmlContent: html
	});
}

// === WELCOME FOR NEW USERS (created by admin) ===

export async function sendWelcomeEmail(to: string, resetLink: string) {
	const html = `
		<div style="font-family: sans-serif; max-width: 600px; line-height: 1.5;">
			${LOGO_HTML}
			<h2>Welcome to Capital City Windows!</h2>
			<p>An administrator has created an account for you in the Capital City Windows scheduling system.</p>

			<p>To activate your account and set your own secure password (replacing the temporary one), please click the button below.</p>

			<p style="margin: 24px 0;">
				<a href="${resetLink}" style="background:#1e3a8a; color:white; padding:14px 28px; text-decoration:none; border-radius:4px; display:inline-block; font-weight:600; font-size:16px;">Set My Password &amp; Activate Account</a>
			</p>

			<p>Completing the password setup will both verify your email and update your credentials.</p>

			<p style="color:#666; font-size:13px;">If you did not expect this account creation, you can safely ignore this email.</p>
			${CREDIT_HTML}
		</div>
	`;

	await sendBrevoEmail({
		sender: SENDER,
		to: [{ email: to }],
		subject: 'Welcome to Capital City Windows — Set Your Password & Activate Account',
		htmlContent: html
	});
}

// === JOB ASSIGNMENT (to assigned crew only) ===

export async function sendJobAssignmentEmail(
	to: string,
	data: {
		clientName: string;
		start: string;
		end: string;
		address: string;
		phone: string;
		mapLink?: string;
		coworkers: string[];
	}
) {
	const coworkersList = data.coworkers.length > 0 ? data.coworkers.join(', ') : 'None assigned';
	const mapHtml = data.mapLink
		? `<li><strong>Directions:</strong> <a href="${data.mapLink}">Open Google Maps</a></li>`
		: '';

	const html = `
		<div style="font-family: sans-serif; max-width: 600px; line-height: 1.5;">
			${LOGO_HTML}
			<h2>You've been assigned the following jobs</h2>
			<ul>
				<li><strong>Client:</strong> ${data.clientName}</li>
				<li><strong>Time:</strong> ${data.start} – ${data.end}</li>
				<li><strong>Address:</strong> ${data.address}</li>
				<li><strong>Phone:</strong> ${data.phone}</li>
				<li><strong>Coworkers:</strong> ${coworkersList}</li>
				${mapHtml}
			</ul>
			<p>See Calendar for more details.</p>
			${CREDIT_HTML}
		</div>
	`;

	await sendBrevoEmail({
		sender: SENDER,
		to: [{ email: to }],
		subject: "You've been assigned jobs - Capital City Windows",
		htmlContent: html
	});
}

// === INVOICE SENT (after client approval) ===

export async function sendInvoiceSentEmail(to: string, invoiceId: string, clientName: string) {
	const html = `
		<div style="font-family: sans-serif; max-width: 600px; line-height: 1.5;">
			${LOGO_HTML}
			<h2>Invoice sent</h2>
			<p>An invoice has been sent for client <strong>${clientName}</strong> (Invoice ID: ${invoiceId}).</p>
			<p>Please log in to the app to view and manage the invoice.</p>
			${CREDIT_HTML}
		</div>
	`;

	await sendBrevoEmail({
		sender: SENDER,
		to: [{ email: to }],
		subject: 'Invoice sent - Capital City Windows',
		htmlContent: html
	});
}
