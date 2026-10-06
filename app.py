"""Small Flask app that keeps external API credentials on the server."""

import logging
import os
import tempfile
from pathlib import Path
from urllib.parse import quote

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from inference_sdk import InferenceConfiguration, InferenceHTTPClient

load_dotenv()

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024  # 10 MB
logging.basicConfig(level=logging.INFO)

ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
REQUEST_TIMEOUT = 30


class MissingRoboflowConfig(Exception):
    """Raised when required Roboflow settings are missing."""


def _roboflow_url():
    return os.getenv("ROBOFLOW_API_URL", "").strip() or "https://serverless.roboflow.com"


def detect_with_roboflow(image_file):
    api_key = os.getenv("ROBOFLOW_API_KEY", "").strip()
    model_id = os.getenv("ROBOFLOW_MODEL_ID", "").strip()
    if not api_key or not model_id:
        raise MissingRoboflowConfig(
            "Configure ROBOFLOW_API_KEY and ROBOFLOW_MODEL_ID in the .env file."
        )

    # The SDK accepts a local image path, so use and then remove a temporary file.
    suffix = Path(image_file.filename).suffix.lower() or ".jpg"
    temp_path = None
    try:
        client = InferenceHTTPClient(
            api_url=_roboflow_url(),
            api_key=api_key,
        ).configure(InferenceConfiguration(api_key_transport="header"))
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_image:
            temp_image.write(image_file.read())
            temp_path = temp_image.name
        return client.infer(temp_path, model_id=model_id)
    except Exception as error:
        logging.exception("Roboflow inference failed")
        status_code = getattr(getattr(error, "response", None), "status_code", None)
        if status_code in (401, 403):
            message = "Roboflow rejected the API key. Check ROBOFLOW_API_KEY and access to the model."
        elif status_code == 429:
            message = "The Roboflow inference limit was reached. Try again later."
        else:
            message = "Roboflow could not process the image. Check the API key, model ID, and image format."
        raise RuntimeError(message) from error
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


def normalize_predictions(data):
    """Convert common Roboflow prediction shapes to one simple format."""
    predictions = data.get("predictions", []) if isinstance(data, dict) else []
    if isinstance(predictions, dict):
        predictions = predictions.get("predictions", [])
    if not isinstance(predictions, list):
        return []

    normalized = []
    for item in predictions:
        if not isinstance(item, dict):
            continue
        label = item.get("class") or item.get("label") or item.get("name")
        if not label:
            continue
        prediction = {"class": str(label), "confidence": item.get("confidence", 0)}
        for key in ("x", "y", "width", "height"):
            value = item.get(key)
            if isinstance(value, (int, float)):
                prediction[key] = value
        normalized.append(prediction)
    return normalized


def search_wikipedia(object_name):
    """Search Wikipedia directly through its public MediaWiki API."""
    response = requests.get(
        "https://en.wikipedia.org/w/api.php",
        params={
            "action": "query", "list": "search", "srsearch": object_name,
            "srlimit": 3, "format": "json", "formatversion": 2,
        },
        headers={"User-Agent": "ObjectVision/1.0 (object detection demo; contact: local project)"},
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    data = response.json()
    search_items = data.get("query", {}).get("search", []) if isinstance(data, dict) else []
    results = []
    for item in search_items:
        title = item.get("title") if isinstance(item, dict) else None
        if title:
            page_title = quote(title.replace(" ", "_"), safe="()'")
            results.append({"title": title, "url": f"https://en.wikipedia.org/wiki/{page_title}"})
    output = {"query": object_name, "results": results, "count": len(results)}

    if results:
        title = results[0]["title"]
        try:
            summary_response = requests.get(
                f"https://en.wikipedia.org/api/rest_v1/page/summary/{quote(title, safe='')}",
                headers={"User-Agent": "ObjectVision/1.0 (object detection demo; contact: local project)"},
                timeout=REQUEST_TIMEOUT,
            )
            if summary_response.ok:
                summary = summary_response.json().get("extract")
                if summary:
                    output["summary"] = summary
        except (requests.RequestException, ValueError, AttributeError):
            logging.info("Wikipedia summary was unavailable for %s", title)
    return {"success": True, "data": output}


def wikipedia_error_message(error):
    status_code = getattr(error.response, "status_code", None)
    if status_code in (401, 403):
        return "Wikipedia temporarily rejected the request. Try again later."
    if status_code == 429:
        return "Wikipedia temporarily rate-limited the request. Wait a moment and try again."
    if status_code and status_code >= 500:
        return "Wikipedia is temporarily unavailable. Try again later."
    return "Could not search Wikipedia. Please try again."


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/api/detect")
def detect():
    image_file = request.files.get("image")
    if not image_file or not image_file.filename:
        return jsonify(success=False, error="Select an image to continue."), 400
    extension = image_file.filename.rsplit(".", 1)[-1].lower() if "." in image_file.filename else ""
    if extension not in ALLOWED_EXTENSIONS:
        return jsonify(success=False, error="Unsupported format. Use JPG, JPEG, PNG, or WEBP."), 400

    try:
        raw = detect_with_roboflow(image_file)
        predictions = normalize_predictions(raw)
        top = max(predictions, key=lambda item: float(item.get("confidence") or 0), default=None)
        external_info = {"success": False, "message": "No objects were detected to look up."}
        if top:
            try:
                external_info = search_wikipedia(top["class"])
            except requests.HTTPError as error:
                logging.exception("Wikipedia search failed")
                external_info = {"success": False, "message": wikipedia_error_message(error)}
            except requests.RequestException:
                logging.exception("Wikipedia search failed")
                external_info = {"success": False, "message": "Could not connect to Wikipedia."}
            except ValueError:
                logging.exception("Wikipedia returned invalid JSON")
                external_info = {"success": False, "message": "Wikipedia returned an invalid response."}
        return jsonify(success=True, predictions=predictions, top_prediction=top, external_info=external_info)
    except MissingRoboflowConfig as error:
        return jsonify(success=False, error=str(error)), 503
    except RuntimeError as error:
        return jsonify(success=False, error=str(error)), 502
    except requests.HTTPError as error:
        logging.warning("Roboflow HTTP error: %s", error)
        return jsonify(success=False, error="Roboflow could not process the image. Check the model and try again."), 502
    except requests.RequestException:
        logging.exception("Roboflow request failed")
        return jsonify(success=False, error="Could not connect to Roboflow. Please try again."), 502
    except (TypeError, KeyError):
        logging.exception("Unexpected Roboflow response")
        return jsonify(success=False, error="Roboflow returned an invalid response."), 502
    except Exception:
        logging.exception("Unexpected detection error")
        return jsonify(success=False, error="An internal error occurred. Please try again."), 500


@app.post("/api/detect-frame")
def detect_frame():
    """Run Roboflow only; real-time frames must not trigger Wikipedia lookups."""
    image_file = request.files.get("image")
    if not image_file or not image_file.filename:
        return jsonify(success=False, error="No camera frame was received."), 400
    extension = image_file.filename.rsplit(".", 1)[-1].lower() if "." in image_file.filename else ""
    if extension not in ALLOWED_EXTENSIONS:
        return jsonify(success=False, error="Unsupported frame format."), 400
    try:
        predictions = normalize_predictions(detect_with_roboflow(image_file))
        return jsonify(success=True, predictions=predictions)
    except MissingRoboflowConfig as error:
        return jsonify(success=False, error=str(error)), 503
    except RuntimeError as error:
        return jsonify(success=False, error=str(error)), 502
    except (TypeError, KeyError, ValueError):
        logging.exception("Invalid Roboflow frame response")
        return jsonify(success=False, error="Roboflow returned an invalid response."), 502
    except Exception:
        logging.exception("Unexpected real-time detection error")
        return jsonify(success=False, error="Could not analyze the camera frame."), 500


@app.post("/api/info")
def get_object_info():
    payload = request.get_json(silent=True) or {}
    object_name = payload.get("class", "")
    if not isinstance(object_name, str) or not object_name.strip() or len(object_name) > 100:
        return jsonify(success=False, error="Enter a valid object to search for."), 400
    try:
        return jsonify(success=True, external_info=search_wikipedia(object_name.strip()))
    except requests.HTTPError as error:
        logging.exception("Wikipedia lookup failed")
        return jsonify(success=False, error=wikipedia_error_message(error)), 502
    except requests.RequestException:
        logging.exception("Wikipedia lookup failed")
        return jsonify(success=False, error="Could not connect to Wikipedia."), 502
    except ValueError:
        logging.exception("Wikipedia returned invalid JSON")
        return jsonify(success=False, error="Wikipedia returned an invalid response."), 502


@app.errorhandler(413)
def too_large(_error):
    return jsonify(success=False, error="Image exceeds the 10 MB limit."), 413


if __name__ == "__main__":
    app.run(debug=True)
