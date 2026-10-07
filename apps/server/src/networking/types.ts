import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from '@blindshot/shared';

export type BlindShotServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
export type BlindShotSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
