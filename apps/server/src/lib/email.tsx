import { render } from "@react-email/render";
import { Resend } from "resend";
import ChangeEmailVerification from "../../../../packages/transactional/emails/change-email-verification";
import DeleteAccountVerification from "../../../../packages/transactional/emails/delete-account-verification";
import ResetPassword from "../../../../packages/transactional/emails/reset-password";
import VerificationEmail from "../../../../packages/transactional/emails/verification-email";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendVerificationEmail({
	email,
	url,
}: {
	email: string;
	url: string;
}) {
	const html = await render(<VerificationEmail email={email} url={url} />);
	const text = await render(<VerificationEmail email={email} url={url} />, {
		plainText: true,
	});

	const { data, error } = await resend.emails.send({
		from: "No Stakes Poker <support@nostakes.poker>",
		to: email,
		subject: "Verify your email address",
		html,
		text,
	});

	if (error) {
		console.error("Error sending verification email:", error);
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
	const html = await render(
		<DeleteAccountVerification email={email} url={url} />,
	);
	const text = await render(
		<DeleteAccountVerification email={email} url={url} />,
		{
			plainText: true,
		},
	);

	const { data, error } = await resend.emails.send({
		from: "No Stakes Poker <support@nostakes.poker>",
		to: email,
		subject: "Confirm Account Deletion",
		html,
		text,
	});

	if (error) {
		console.error("Error sending delete account verification email:", error);
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
	const html = await render(
		<ChangeEmailVerification
			oldEmail={oldEmail}
			newEmail={newEmail}
			url={url}
		/>,
	);
	const text = await render(
		<ChangeEmailVerification
			oldEmail={oldEmail}
			newEmail={newEmail}
			url={url}
		/>,
		{ plainText: true },
	);

	const { data, error } = await resend.emails.send({
		from: "No Stakes Poker <support@nostakes.poker>",
		to: oldEmail,
		subject: "Confirm Email Change",
		html,
		text,
	});

	if (error) {
		console.error("Error sending change email verification email:", error);
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
	const html = await render(<ResetPassword email={email} url={url} />);
	const text = await render(<ResetPassword email={email} url={url} />, {
		plainText: true,
	});

	const { data, error } = await resend.emails.send({
		from: "No Stakes Poker <support@nostakes.poker>",
		to: email,
		subject: "Reset Your Password",
		html,
		text,
	});

	if (error) {
		console.error("Error sending reset password email:", error);
		throw error;
	}

	return data;
}
