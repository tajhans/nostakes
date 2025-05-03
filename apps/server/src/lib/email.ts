import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendVerificationEmail({
	email,
	url,
}: {
	email: string;
	url: string;
}) {
	const { data, error } = await resend.emails.send({
		from: "No Stakes Poker <noreply@nostakes.poker>",
		to: email,
		subject: "Verify your email address",
		html: `
          <h1>Welcome to No Stakes Poker!</h1>
          <p>Please click the link below to verify your email address:</p>
          <a href="${url}">${url}</a>
          <p>If you did not create an account, you can safely ignore this email.</p>
        `,
	});

	if (error) {
		throw error;
	}

	return data;
}

export async function sendDeleteAccountVerification({
	email,
	url,
}: {
	email: string;
	url: string;
}) {
	const { data, error } = await resend.emails.send({
		from: "No Stakes Poker <noreply@nostakes.poker>",
		to: email,
		subject: "Reset your password",
		html: `
            <h1>Sorry to see you go!</h1>
            <p>Please click the link below to confirm you want to delete your account:</p>
            <a href="${url}">${url}</a>
            <p>If you did not want to delete your account, change your password.</p>
          `,
	});

	if (error) {
		throw error;
	}

	return data;
}

export async function sendChangeEmailVerification({
	oldEmail,
	newEmail,
	url,
}: {
	oldEmail: string;
	newEmail: string;
	url: string;
}) {
	const { data, error } = await resend.emails.send({
		from: "No Stakes Poker <noreply@nostakes.poker>",
		to: oldEmail,
		subject: "Change email confirmation",
		html: `
            <h1>Confirm you want to change your email.</h1>
            <p>Please click the link below to confirm you want to change your email to ${newEmail}:</p>
            <a href="${url}">${url}</a>
            <p>If you did not want to change your email, change your password.</p>
          `,
	});

	if (error) {
		throw error;
	}

	return data;
}

export async function sendResetPassword({
	email,
	url,
}: {
	email: string;
	url: string;
}) {
	const { data, error } = await resend.emails.send({
		from: "No Stakes Poker <noreply@nostakes.poker>",
		to: email,
		subject: "Change your password",
		html: `
             <h1>Reset Your Password</h1>
             <p>You requested to reset your password. Click the link below to set a new password:</p>
             <a href="${url}">${url}</a>
             <p>If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>
           `,
	});

	if (error) {
		throw error;
	}

	return data;
}
