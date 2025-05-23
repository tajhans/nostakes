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

interface ResetPasswordProps {
	url: string;
	email: string;
}

export const ResetPassword = ({ url, email }: ResetPasswordProps) => (
	<Html>
		<Head />
		<Preview>Reset your password for No Stakes Poker</Preview>
		<Body style={main}>
			<Container style={container}>
				<Heading style={heading}>Reset Your Password</Heading>
				<Section style={body}>
					<Text style={paragraph}>
						Hi there, we received a request to reset the password for the No
						Stakes Poker account associated with {email}.
					</Text>
					<Text style={paragraph}>
						Click the button below to set a new password:
					</Text>
					<Button style={button} href={url}>
						Reset Password
					</Button>
					<Hr style={hr} />
					<Text style={paragraph}>
						If you did not request a password reset, you can safely ignore this
						email. Your password will remain unchanged.
					</Text>
				</Section>
				<Text style={footer}>No Stakes Poker</Text>
			</Container>
		</Body>
	</Html>
);

ResetPassword.PreviewProps = {
	url: "http://localhost:3001/reset-password?token=testtoken123",
	email: "test@example.com",
} as ResetPasswordProps;

export default ResetPassword;

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
