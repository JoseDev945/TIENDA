// Función de Vercel que atiende toda la API de la tienda (/api/...).
import { handle } from '../lib/tienda.js';

export default { fetch: (request) => handle(request) };
