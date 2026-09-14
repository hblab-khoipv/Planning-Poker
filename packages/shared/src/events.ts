/** Socket.io event names shared by the API and the web client (PRD §8). */
export const SOCKET_EVENTS = {
  ROOM_JOIN: 'room:join',
  ROOM_LEAVE: 'room:leave',
  PARTICIPANT_JOINED: 'participant:joined',
  PARTICIPANT_LEFT: 'participant:left',
  VOTE_CAST: 'vote:cast',
  ROUND_REVEALED: 'round:revealed',
  ROUND_RESET: 'round:reset',
} as const;

export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

/** Key used to persist the guest identity in browser storage (PRD §6, guest session). */
export const PARTICIPANT_ID_STORAGE_KEY = 'planning-poker:participant-id';
