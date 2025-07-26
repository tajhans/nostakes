import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface CopyCodeProps {
	joinCode: string;
	showCopyButton?: boolean;
	className?: string;
}

export function CopyCode({
	joinCode,
	showCopyButton = true,
	className,
}: CopyCodeProps) {
	const [isCopied, setIsCopied] = useState(false);

	const formattedCode =
		joinCode.length === 8
			? `${joinCode.substring(0, 4)}-${joinCode.substring(4, 8)}`
			: joinCode;

	const handleCopy = async () => {
		if (!joinCode) return;

		try {
			await navigator.clipboard.writeText(joinCode);
			setIsCopied(true);
			toast.success("Join code copied to clipboard!");
			setTimeout(() => setIsCopied(false), 2000);
		} catch (err) {
			console.error(
				"Failed to copy join code using navigator.clipboard: ",
				err,
			);
			const textArea = document.createElement("textarea");
			textArea.value = joinCode;
			textArea.style.position = "fixed";
			textArea.style.opacity = "0";
			document.body.appendChild(textArea);
			textArea.focus();
			textArea.select();
			try {
				const successful = document.execCommand("copy");
				if (successful) {
					setIsCopied(true);
					toast.success("Join code copied to clipboard! (fallback)");
					setTimeout(() => setIsCopied(false), 2000);
				} else {
					throw new Error("Fallback copy command failed");
				}
			} catch (fallbackErr) {
				console.error("Fallback copy failed: ", fallbackErr);
				toast.error("Failed to copy join code.");
			} finally {
				document.body.removeChild(textArea);
			}
		}
	};

	return (
		<div className={className}>
			<div className="flex items-center rounded-md border bg-secondary px-2 py-1">
				<code className="font-mono text-sm tracking-wider">
					{formattedCode}
				</code>
				{showCopyButton && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="ml-1 h-6 w-6"
								onClick={handleCopy}
								disabled={!joinCode || isCopied}
							>
								{isCopied ? (
									<Check className="h-4 w-4 text-green-500" />
								) : (
									<Copy className="h-4 w-4" />
								)}
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							<p>Copy Join Code</p>
						</TooltipContent>
					</Tooltip>
				)}
			</div>
		</div>
	);
}
