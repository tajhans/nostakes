import Loader from "@/components/loader";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import type { trpc } from "@/lib/utils/trpc";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
	HeadContent,
	Outlet,
	createRootRouteWithContext,
	useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import "../index.css";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { VerificationNotice } from "@/components/verification-notice";

export interface RouterAppContext {
	trpc: typeof trpc;
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
	component: RootComponent,
	head: () => ({
		meta: [
			{
				title: "No Stakes Poker - Free Texas Hold'em Online",
			},
			{
				name: "description",
				content:
					"Play free Texas Hold'em poker online with friends. Create private rooms, customize games, and enjoy poker without real money stakes.",
			},
			{
				name: "keywords",
				content:
					"free poker, texas holdem, online poker, poker with friends, no money poker, private poker rooms",
			},
			{
				name: "author",
				content: "No Stakes Poker",
			},
			{
				property: "og:title",
				content: "No Stakes Poker - Free Texas Hold'em Online",
			},
			{
				property: "og:description",
				content:
					"Play free Texas Hold'em poker online with friends. Create private rooms, customize games, and enjoy poker without real money stakes.",
			},
			{
				property: "og:type",
				content: "website",
			},
			{
				property: "og:url",
				content: "https://nostakes.poker",
			},
			{
				name: "twitter:card",
				content: "summary_large_image",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
		],
		links: [
			{
				rel: "icon",
				href: "/favicon.ico",
			},
			{
				rel: "canonical",
				href: "https://nostakes.poker",
			},
		],
	}),
});

function RootComponent() {
	const isFetching = useRouterState({
		select: (s) => s.isLoading,
	});
	return (
		<>
			<HeadContent />
			<ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
				<div className="flex min-h-svh flex-col">
					<VerificationNotice />
					<Header />
					<main className="flex-grow pb-20">
						{isFetching ? <Loader /> : <Outlet />}
					</main>
					<Footer />
				</div>
				<Toaster richColors />
			</ThemeProvider>
			<TanStackRouterDevtools position="bottom-left" />
			<ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
		</>
	);
}
