export interface RoomMemberInfo {
	userId: string;
	username: string;
	seatNumber: number;
	currentStack: number;
	isActive: boolean;
	wantsToPlayNextHand?: boolean;
}
