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
