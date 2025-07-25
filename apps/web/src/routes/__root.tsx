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
				title: "No Stakes Poker",
			},
			{
				name: "description",
				content: "Texas Hold'em no limit poker with no stakes.",
			},
		],
		links: [
			{
				rel: "icon",
				href: "/favicon.ico",
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
					<main className="flex-grow">
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
