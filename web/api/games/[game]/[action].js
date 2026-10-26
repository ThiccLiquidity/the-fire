// /api/games/<game>/<action>: the game server (docs/game-server.md). <game> is 'paperfb' or a FireGames id.
import { handleRequest } from '../_lib/default.js';

export const GET = (request) => handleRequest(request);
export const POST = (request) => handleRequest(request);
