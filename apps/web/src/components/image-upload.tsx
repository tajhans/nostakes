import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "./ui/button";

interface ImageUploadProps {
	onImageSelect: (base64: string) => void;
}

export function ImageUpload({ onImageSelect }: ImageUploadProps) {
	const [isLoading, setIsLoading] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	const handleFileSelect = async (file: File) => {
		if (!file.type.startsWith("image/")) {
			toast.error("Please select an image file");
			return;
		}

		const maxSize = 5 * 1024 * 1024; // 5MB
		if (file.size > maxSize) {
			toast.error("Image must be less than 5MB");
			return;
		}

		setIsLoading(true);
		try {
			const reader = new FileReader();
			reader.onloadend = () => {
				const base64 = reader.result as string;
				onImageSelect(base64);
				setIsLoading(false);
			};
			reader.readAsDataURL(file);
		} catch (error) {
			toast.error("Failed to read image");
			setIsLoading(false);
		}
	};

	return (
		<div className="flex flex-col items-center gap-4">
			<input
				ref={inputRef}
				type="file"
				accept="image/*"
				className="hidden"
				onChange={(e) => {
					const file = e.target.files?.[0];
					if (file) {
						handleFileSelect(file);
					}
				}}
			/>
			<Button
				variant="outline"
				disabled={isLoading}
				onClick={() => inputRef.current?.click()}
			>
				{isLoading ? "Processing..." : "Choose Image"}
			</Button>
		</div>
	);
}
