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

interface VerificationEmailProps {
	url: string;
	email: string;
}

export const VerificationEmail = ({ url, email }: VerificationEmailProps) => (
	<Html>
		<Head />
		<Preview>Verify your email address for No Stakes Poker</Preview>
		<Body style={main}>
			<Container style={container}>
				<Heading style={heading}>Welcome to No Stakes Poker!</Heading>
				<Section style={body}>
					<Text style={paragraph}>
						Hi there, thanks for signing up! Please click the button below to
						verify your email address ({email}) and complete your registration.
					</Text>
					<Button style={button} href={url}>
						Verify Email Address
					</Button>
					<Hr style={hr} />
					<Text style={paragraph}>
						If you didn't create an account with No Stakes Poker, you can safely
						ignore this email.
					</Text>
				</Section>
				<Text style={footer}>No Stakes Poker</Text>
			</Container>
		</Body>
	</Html>
);

VerificationEmail.PreviewProps = {
	url: "http://localhost:3001/verify-email?token=testtoken123",
	email: "test@example.com",
} as VerificationEmailProps;

export default VerificationEmail;

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
