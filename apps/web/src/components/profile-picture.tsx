import { cn } from "@/lib/utils";
import { User } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";

interface ProfilePictureProps {
	imageUrl?: string | null;
	imageBase64?: string | null;
	alt?: string;
	size?: "sm" | "md" | "lg";
	className?: string;
	username?: string | null;
}

const sizeClasses = {
	sm: "h-8 w-8",
	md: "h-9 w-9",
	lg: "h-12 w-12",
};

const textSizeClasses = {
	sm: "text-sm",
	md: "text-base",
	lg: "text-lg",
};

export const ProfilePicture: React.FC<ProfilePictureProps> = ({
	imageUrl,
	imageBase64,
	alt = "User avatar",
	size = "md",
	className,
	username,
}) => {
	const [isLoaded, setIsLoaded] = useState(false);
	const [hasError, setHasError] = useState(false);

	useEffect(() => {
		setIsLoaded(false);
		setHasError(false);
	}, [imageUrl]);

	const showImage = imageUrl && !hasError;
	const showPlaceholder = !isLoaded && imageBase64 && showImage;
	const showInitials = !showImage && username;
	const showDefaultIcon = !showImage && !showInitials;

	const initials = username
		? username
				.split(" ")
				.map((n) => n[0])
				.join("")
				.substring(0, 2)
				.toUpperCase()
		: "?";

	return (
		<div
			className={cn(
				"relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent text-accent-foreground",
				sizeClasses[size],
				className,
			)}
		>
			{showPlaceholder && (
				<img
					src={imageBase64}
					alt=""
					aria-hidden="true"
					className="absolute inset-0 h-full w-full object-cover blur-sm filter"
				/>
			)}
			{showImage && (
				<img
					src={imageUrl}
					alt={alt}
					className={cn(
						"absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
						isLoaded ? "opacity-100" : "opacity-0",
					)}
					onLoad={() => setIsLoaded(true)}
					onError={() => {
						console.warn(`Failed to load image: ${imageUrl}`);
						setHasError(true);
						setIsLoaded(true);
					}}
					loading="lazy"
				/>
			)}
			{showInitials && !showImage && (
				<span className={cn("select-none font-medium", textSizeClasses[size])}>
					{initials}
				</span>
			)}
			{showDefaultIcon && !showImage && !showInitials && (
				<User className={cn(sizeClasses[size], "p-1")} />
			)}
		</div>
	);
};
