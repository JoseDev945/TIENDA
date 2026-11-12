@echo off
title Publicar la tienda en Vercel
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto sin_node

echo.
echo  Publicando la tienda en Vercel...
echo  La primera vez se abre el navegador para entrar a tu cuenta y hace
echo  unas preguntas en ingles: acepta lo que propone pulsando Enter.
echo.
call npx --yes vercel@latest --prod
if errorlevel 1 goto fallo
echo.
echo  Listo. Arriba aparece la direccion de tu tienda.
echo  Si es la primera vez, sigue con el paso 2 de DESPLEGAR.md.
echo.
pause
exit /b 0

:fallo
echo.
echo  No se pudo publicar. Copia el mensaje de arriba para poder revisarlo.
echo.
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
