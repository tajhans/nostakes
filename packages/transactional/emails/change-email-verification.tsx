import {
	Body,
	Button,
	Container,
	Head,
	Heading,
	Hr,
	Html,
	Preview,
	Section,
	Text,
} from "@react-email/components";

interface ChangeEmailVerificationProps {
	url: string;
	oldEmail: string;
	newEmail: string;
}

export const ChangeEmailVerification = ({
	url,
	oldEmail,
	newEmail,
}: ChangeEmailVerificationProps) => (
	<Html>
		<Head />
		<Preview>Confirm Email Change for No Stakes Poker</Preview>
		<Body style={main}>
			<Container style={container}>
				<Heading style={heading}>Confirm Your Email Change</Heading>
				<Section style={body}>
					<Text style={paragraph}>
						We received a request to change the email address associated with
						your No Stakes Poker account from {oldEmail} to {newEmail}.
					</Text>
					<Text style={paragraph}>
						To confirm this change, please click the button below. This link was
						sent to your original email address ({oldEmail}) for security.
					</Text>
					<Button style={button} href={url}>
						Confirm Email Change to {newEmail}
					</Button>
					<Hr style={hr} />
					<Text style={paragraph}>
						If you did not request this change, please secure your account
						immediately by changing your password. You can ignore this email if
						you wish to keep your current email address ({oldEmail}).
					</Text>
				</Section>
				<Text style={footer}>No Stakes Poker</Text>
			</Container>
		</Body>
	</Html>
);

ChangeEmailVerification.PreviewProps = {
	url: "http://localhost:3001/change-email?token=testtoken123",
	oldEmail: "old@example.com",
	newEmail: "new@example.com",
} as ChangeEmailVerificationProps;

export default ChangeEmailVerification;

const main = {
	backgroundColor: "#ffffff",
	fontFamily:
		'-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen-Sans,Ubuntu,Cantarell,"Helvetica Neue",sans-serif',
};

const container = {
	margin: "0 auto",
	padding: "20px 0 48px",
	width: "580px",
	maxWidth: "100%",
};

const heading = {
	fontSize: "28px",
	fontWeight: "bold",
	marginTop: "48px",
	marginBottom: "24px",
	textAlign: "center" as const,
	color: "#1a1a1a",
};

const body = {
	padding: "24px",
	backgroundColor: "#f9fafb",
	borderRadius: "8px",
	border: "1px solid #e5e7eb",
};

const paragraph = {
	fontSize: "16px",
	lineHeight: "26px",
	color: "#374151",
};

const button = {
	backgroundColor: "#111827",
	borderRadius: "6px",
	color: "#ffffff",
	fontSize: "16px",
	fontWeight: "bold",
	textDecoration: "none",
	textAlign: "center" as const,
	display: "block",
	width: "auto",
	padding: "12px 24px",
	margin: "24px 48px",
};

const link = {
	color: "#111827",
	fontSize: "14px",
	wordBreak: "break-all" as const,
};

const hr = {
	borderColor: "#e5e7eb",
	margin: "20px 0",
};

const footer = {
	color: "#9ca3af",
	fontSize: "12px",
	textAlign: "center" as const,
	marginTop: "24px",
};
