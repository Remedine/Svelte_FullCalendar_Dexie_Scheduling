import { BREVO_API_KEY, PUBLIC_PB_URL } from '$env/static/private';

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

interface BrevoEmailPayload {
	sender: { name: string; email: string };
	to: Array<{ email: string; name?: string }>;
	subject: string;
	htmlContent: string;
}

async function sendBrevoEmail(payload: BrevoEmailPayload) {
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
		throw new Error(`Brevo API error: ${res.status} ${errorText}`);
	}
}

const SENDER = {
	name: 'Capital City Windows',
	email: 'brick@gotdirtywindows.com'
};

const LOGO_HTML = `<img src="https://static.wixstatic.com/media/5bfb6f_e26c222c0bf648c39eeed8e67ae87701.png/v1/fill/w_71,h_68,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/5bfb6f_e26c222c0bf648c39eeed8e67ae87701.png" style="height:40px; vertical-align:middle;" alt="Capital City Windows"> <strong style="font-size:20px; vertical-align:middle;">Capital City Windows</strong>`;

// === AUTH EMAILS (use links from PB internal routes) ===

export async function sendVerificationEmail(to: string, link: string) {
	const html = `
		<div style="font-family: sans-serif; max-width: 600px; line-height: 1.5;">
			${LOGO_HTML}
			<h2>Verify your email</h2>
			<p>Please confirm your email address for your Capital City Windows account.</p>
			<p><a href="${link}" style="background:#1e3a8a; color:white; padding:12px 24px; text-decoration:none; border-radius:4px; display:inline-block;">Verify Email</a></p>
			<p style="color:#666; font-size:12px;">If you did not request this, you can safely ignore this email.</p>
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
		</div>
	`;
	await sendBrevoEmail({
		sender: SENDER,
		to: [{ email: to }],
		subject: 'Confirm email change - Capital City Windows',
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
		</div>
	`;

	await sendBrevoEmail({
		sender: SENDER,
		to: [{ email: to }],
		subject: 'Invoice sent - Capital City Windows',
		htmlContent: html
	});
}
