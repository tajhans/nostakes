import { cn } from "@/lib/utils";
import type React from "react";
import { useEffect } from "react";

interface AdSenseAdProps {
	adSlot: string;
	adClient: string;
	adFormat?: string;
	style?: React.CSSProperties;
	className?: string;
	responsive?: boolean;
}

declare global {
	interface Window {
		adsbygoogle?: { push: (obj: object) => void }[];
	}
}

const AdSenseAd: React.FC<AdSenseAdProps> = ({
	adSlot,
	adClient,
	adFormat = "auto",
	style = { display: "block" },
	className,
	responsive = true,
}) => {
	useEffect(() => {
		try {
			if (typeof window !== "undefined" && window.adsbygoogle) {
				window.adsbygoogle = window.adsbygoogle || [];
				window.adsbygoogle.push({});
			} else {
				console.warn(
					"AdSense script (adsbygoogle.js) not loaded yet or blocked.",
				);
			}
		} catch (e) {
			console.error("Error pushing to adsbygoogle:", e);
		}
	}, []);

	if (!adClient) {
		console.warn("AdSenseAd: 'adClient' (publisher ID) is missing.");
		return (
			<div className={cn("text-center text-red-500", className)}>
				AdSense Publisher ID missing.
			</div>
		);
	}
	if (!adSlot) {
		console.warn("AdSenseAd: 'adSlot' ID is missing.");
		return (
			<div className={cn("text-center text-red-500", className)}>
				AdSense Slot ID missing.
			</div>
		);
	}

	return (
		<div className={cn("w-full text-center", className)}>
			<ins
				className="adsbygoogle"
				style={style}
				data-ad-client={adClient}
				data-ad-slot={adSlot}
				data-ad-format={adFormat}
				data-full-width-responsive={responsive ? "true" : "false"}
			/>
		</div>
	);
};

export default AdSenseAd;
