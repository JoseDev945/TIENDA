// Ajustes de la tienda. Cambia los valores de la derecha y vuelve a desplegar.
export default {
  // Nombre que aparece arriba a la izquierda.
  nombre: 'Regateo',
  // Símbolo delante de los precios: '$', 'B/.', '€'...
  simboloMoneda: '$',
  // Cómo se escriben los números. 'es-PA' muestra 1,250.50
  formatoRegional: 'es-PA',
  // Usuarios con permisos de moderación además de la primera cuenta creada.
  // También se pueden poner en Vercel, en la variable ADMINS (separados por comas).
  admins: [],
  // Peso máximo de videos y archivos, y de fotos.
  maxArchivoMB: 100,
  maxImagenMB: 15,
  // Solo para probar en tu computadora.
  puerto: 3000,
};
