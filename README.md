# ObjectVision

ObjectVision es una demostración sencilla de visión artificial. Envía una imagen desde el navegador a Flask, Flask solicita predicciones al modelo `coco/50` de Roboflow y, si hay un objeto detectado, busca información adicional directamente en Wikipedia. La clave de Roboflow se mantiene en el servidor.

## Requisitos

- Python 3.9 o posterior
- Una API key y un modelo de detección configurado en Roboflow para usar detección real
- Un navegador con cámara para tomar fotos o detectar objetos en vivo (opcional)

## Instalación y ejecución

En PowerShell, desde la carpeta del proyecto:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
python app.py
```

Abre <http://127.0.0.1:5000>.

## Publicar en Render

ObjectVision es una aplicación Flask, así que publícala como **Web Service** (no como Static Site). Crea un repositorio vacío en GitHub, preferiblemente privado, y desde PowerShell, en la carpeta del proyecto, sube solo los archivos de la aplicación:

```powershell
git init -b main
git add app.py templates static tests README.md requirements.txt .gitignore .env.example
git commit -m "Preparar ObjectVision para publicación"
git remote add origin https://github.com/TU-USUARIO/objectvision.git
git push -u origin main
```

En Render, selecciona **New > Web Service**, conecta ese repositorio y usa estos valores:

- Runtime: `Python 3`
- Branch: `main`
- Build Command: `pip install -r requirements.txt`
- Start Command: `gunicorn app:app`

En la pestaña **Environment** del servicio, agrega `ROBOFLOW_API_KEY` con tu clave privada, `ROBOFLOW_MODEL_ID` con `coco/50` (o el ID de tu modelo personalizado) y `ROBOFLOW_API_URL` con `https://serverless.roboflow.com`. No subas `.env` a GitHub; Render guarda estas variables en la configuración del servicio. Al terminar el deploy, Render mostrará la URL pública HTTPS `https://<nombre-del-servicio>.onrender.com`.

Si eliges el plan gratuito, el servicio puede dormirse tras un periodo sin visitas y tardar un poco más en responder al primer acceso. Cualquier persona que tenga la URL podrá usar la app y generar solicitudes al modelo, sujetas a la cuota de Roboflow.

## Configuración de Roboflow

1. El proyecto usa el modelo COCO alojado `coco/50`.
2. En tu cuenta de Roboflow, crea/consulta una API key privada desde la configuración de la cuenta.
3. En `.env`, configura:

```dotenv
ROBOFLOW_API_KEY=tu_api_key_privada
ROBOFLOW_MODEL_ID=coco/50
ROBOFLOW_API_URL=https://serverless.roboflow.com
```

La aplicación usa `inference-sdk` y envía la API key mediante el encabezado Authorization. No subas `.env` a Git.

## Búsqueda de información

ObjectVision consulta directamente la API pública de MediaWiki para mostrar hasta tres resultados y un resumen breve de Wikipedia. No requiere cuenta, clave ni configuración de RapidAPI. Se envían solicitudes secuenciales con un encabezado User-Agent descriptivo.

## Prueba

Usa imágenes propias de un perro, gato, automóvil, persona u objetos cotidianos. El modelo debe reconocer esas clases para devolver predicciones. No se descargan imágenes automáticamente.

También puedes pulsar **Usar cámara** y permitir el acceso cuando el navegador lo solicite. **Iniciar detección en vivo** envía a Flask un cuadro JPEG reducido aproximadamente cada 1.5 segundos; Flask consulta Roboflow y devuelve las cajas detectadas para dibujarlas sobre el video. Cada cuadro procesado cuenta como una solicitud de inferencia y depende de la latencia y cuota de Roboflow. La cámara no se procesa localmente. Wikipedia no se consulta en cada cuadro: se busca información únicamente al analizar una imagen fija o solicitarla desde un resultado. **Tomar foto** conserva el modo de captura individual. El navegador requiere un contexto seguro, como `localhost` durante el desarrollo o HTTPS al publicar la aplicación.

## Solución de problemas

- Si falta la configuración de Roboflow, la página sigue cargando y la ruta devuelve un mensaje claro al detectar.
- Un error de autenticación o modelo se informa como problema de configuración de Roboflow.
- Si Wikipedia no está disponible temporalmente, las detecciones siguen mostrándose y la información adicional presenta un mensaje de error.
- Se aceptan imágenes JPG, JPEG, PNG y WEBP de hasta 10 MB.
- La cámara puede capturar una foto JPEG o activar detección en vivo con cuadros espaciados.
- La lista se ordena por confianza y permite ocultar resultados por debajo de un umbral.
- Cada detección permite buscar información de ese objeto en Wikipedia.

## Comprobaciones locales

Con el entorno virtual activado, ejecuta las pruebas básicas con:

```powershell
python -m unittest discover -s tests
```
