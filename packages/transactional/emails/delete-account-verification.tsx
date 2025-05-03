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

interface DeleteAccountVerificationProps {
	url: string;
	email: string;
}

export const DeleteAccountVerification = ({
	url,
	email,
}: DeleteAccountVerificationProps) => (
	<Html>
		<Head />
		<Preview>Confirm Account Deletion for No Stakes Poker</Preview>
		<Body style={main}>
			<Container style={container}>
				<Heading style={heading}>Sorry to see you go!</Heading>
				<Section style={body}>
					<Text style={paragraph}>
						We received a request to delete the No Stakes Poker account
						associated with {email}.
					</Text>
					<Text style={paragraph}>
						To confirm this action and permanently delete your account, please
						click the button below. This action is irreversible.
					</Text>
					<Button style={button} href={url}>
						Confirm Account Deletion
					</Button>
					<Hr style={hr} />
					<Text style={paragraph}>
						If you did not request to delete your account, please secure your
						account immediately by changing your password. You can ignore this
						email if you wish to keep your account.
					</Text>
				</Section>
				<Text style={footer}>No Stakes Poker</Text>
			</Container>
		</Body>
	</Html>
);

DeleteAccountVerification.PreviewProps = {
	url: "http://localhost:3001/delete-account?token=testtoken123",
	email: "test@example.com",
} as DeleteAccountVerificationProps;

export default DeleteAccountVerification;

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
	backgroundColor: "#DC2626",
	borderRadius: "6px",
	color: "#ffffff",
	fontSize: "16px",
	fontWeight: "bold",
	textDecoration: "none",
	textAlign: "center" as const,
	display: "block",
	width: "100%",
	padding: "12px",
	margin: "24px 0",
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
