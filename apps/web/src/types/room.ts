export interface RoomMemberInfo {
	userId: string;
	username: string;
	seatNumber: number;
	currentStack: number;
	isActive: boolean;
	wantsToPlayNextHand?: boolean;
	id?: string;
	image?: string | null;
	joinedAt?: Date;
}

export interface RoomData {
	id: string;
	createdAt: string;
	startingStack: number;
	smallBlind: number;
	bigBlind: number;
	ante: number;
	joinCode: string;
	maxPlayers: number;
	isActive: boolean;
	ownerId: string;
	members: RoomMemberInfo[];
	filterProfanity: boolean;
	public: boolean;
}
