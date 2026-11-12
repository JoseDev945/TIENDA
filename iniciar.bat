@echo off
title Tienda (prueba en esta computadora)
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto sin_node
node -e "const v=process.versions.node.split(String.fromCharCode(46)).map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=13)?0:1)"
if errorlevel 1 goto node_viejo

if exist node_modules goto listo
echo.
echo  Instalando lo necesario. Solo pasa la primera vez y tarda un minuto...
echo.
call npm install --no-audit --no-fund
if errorlevel 1 goto fallo_instalar

:listo
if exist .env.local goto arrancar
if exist .env goto arrancar
echo.
echo  Falta el archivo .env.local con la direccion de tu base de datos.
echo  Se crea solo ejecutando en esta carpeta:   npx vercel env pull .env.local
echo  (antes hay que desplegar y conectar Neon; mira DESPLEGAR.md)
echo.
pause
exit /b 1

:arrancar
set ABRIR_NAVEGADOR=1
node --env-file-if-exists=.env.local --env-file-if-exists=.env servidor-local.js
echo.
echo  La tienda se detuvo. Si aparecio un error arriba, copialo para poder revisarlo.
pause
exit /b 0

:fallo_instalar
echo.
echo  No se pudo instalar. Revisa tu conexion a internet y vuelve a intentarlo.
pause
exit /b 1

:sin_node
echo.
echo  Falta instalar Node.js. Es gratis.
echo  1. Se va a abrir la pagina de descarga. Baja e instala la version LTS.
echo  2. Cuando termine, vuelve a hacer doble clic en este archivo.
echo.
start "" https://nodejs.org/
pause
exit /b 1

:node_viejo
echo.
echo  Tu Node.js es antiguo. Hace falta la version 22.13 o mas nueva.
echo  1. Se va a abrir la pagina de descarga. Baja e instala la version LTS.
echo  2. Cuando termine, vuelve a hacer doble clic en este archivo.
echo.
start "" https://nodejs.org/
pause
exit /b 1
