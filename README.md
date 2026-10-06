# ObjectVision

ObjectVision is a computer vision demo. It sends an image from the browser to Flask, which requests predictions from Roboflow's `coco/50` model and looks up information on Wikipedia for the detected object. The Roboflow API key stays on the server.

## Requirements

- Python 3.9 or later
- A Roboflow API key and detection model for live inference
- A browser with a camera for taking photos or running live detection (optional)

## Install and run locally

In PowerShell, from the project folder:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
python app.py
```

Open <http://127.0.0.1:5000>.

## Publish on Render

ObjectVision is a Flask application, so publish it as a **Web Service** (not a Static Site). Create an empty GitHub repository, preferably private. In PowerShell, from the project folder, upload only the application files:

```powershell
git init -b main
git add app.py templates static tests README.md requirements.txt .gitignore .env.example
git commit -m "Prepare ObjectVision for deployment"
git remote add origin https://github.com/YOUR-USERNAME/objectvision.git
git push -u origin main
```

In Render, select **New > Web Service**, connect that repository, and use these settings:

- Runtime: `Python 3`
- Branch: `main`
- Build Command: `pip install -r requirements.txt`
- Start Command: `gunicorn app:app`

Under the service's **Environment** tab, add `ROBOFLOW_API_KEY` with your private key, `ROBOFLOW_MODEL_ID` with `coco/50` (or your custom model ID), and `ROBOFLOW_API_URL` with `https://serverless.roboflow.com`. Do not upload `.env` to GitHub; Render stores these values in the service configuration. Once deployment finishes, Render will show the public HTTPS URL, such as `https://<service-name>.onrender.com`.

On the free plan, the service may sleep after a period without traffic and take longer to respond to the first visit. Anyone with the URL can use the app and trigger model inference requests, subject to your Roboflow quota.

## Configure Roboflow

1. The project currently uses the hosted COCO model `coco/50`.
2. Create or find a private API key in your Roboflow account settings.
3. Set these values in `.env`:

```dotenv
ROBOFLOW_API_KEY=your_private_api_key
ROBOFLOW_MODEL_ID=coco/50
ROBOFLOW_API_URL=https://serverless.roboflow.com
```

The app uses `inference-sdk` and sends the API key in the Authorization header. Never commit `.env` to Git.

## Look up information

ObjectVision queries the public MediaWiki API directly to show up to three Wikipedia results and a short summary. It does not require a RapidAPI account, key, or configuration. Requests are sent sequentially with a descriptive User-Agent header.

## Use the app

Try images of dogs, cats, cars, people, or other everyday objects. The model only returns predictions for classes it recognizes. Images are not downloaded automatically.

You can also select **Use camera** and allow access when your browser asks. **Start live detection** sends a reduced JPEG frame to Flask about every 1.5 seconds; Flask queries Roboflow and returns bounding boxes to draw over the video. Each processed frame counts as an inference request and depends on Roboflow's latency and quota. The camera feed is not processed locally. Wikipedia is not queried for every frame; it is used only when analyzing a still image or requesting information from a result. **Take photo** keeps the single-image capture option. The browser requires a secure context, such as `localhost` during development or HTTPS after deployment.

## Troubleshooting

- If Roboflow is not configured, the page still loads and detection returns a clear message.
- Authentication or model errors are reported as Roboflow configuration issues.
- If Wikipedia is temporarily unavailable, detections still appear and additional information shows an error message.
- JPG, JPEG, PNG, and WEBP images up to 10 MB are supported.
- The camera can capture a JPEG photo or run live detection on spaced frames.
- Predictions are sorted by confidence, and the slider filters results below a confidence threshold.
- Each detection has an option to search Wikipedia for that object.

## Run local checks

With the virtual environment activated, run the basic tests:

```powershell
python -m unittest discover -s tests
```
