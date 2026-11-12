// Función de Vercel que mantiene las conexiones en vivo del chat (/api/events).
import { handleEvents } from '../lib/eventos.js';

export default { fetch: (request) => handleEvents(request) };
