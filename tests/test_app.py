import io
import unittest
from unittest.mock import patch

import app


class ObjectVisionTests(unittest.TestCase):
    def setUp(self):
        self.client = app.app.test_client()

    def test_home_page_loads(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"ObjectVision", response.data)

    def test_detect_requires_an_image(self):
        response = self.client.post("/api/detect")
        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.get_json())

    def test_detect_rejects_unsupported_extension(self):
        response = self.client.post(
            "/api/detect",
            data={"image": (io.BytesIO(b"not an image"), "sample.gif")},
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 400)

    def test_webp_image_is_accepted(self):
        with patch.object(app, "detectar_con_roboflow", return_value={"predictions": []}):
            response = self.client.post(
                "/api/detect",
                data={"image": (io.BytesIO(b"webp placeholder"), "sample.webp")},
                content_type="multipart/form-data",
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["predictions"], [])

    def test_camera_jpeg_snapshot_uses_detection_route(self):
        with patch.object(app, "detectar_con_roboflow", return_value={"predictions": []}):
            response = self.client.post(
                "/api/detect",
                data={"image": (io.BytesIO(b"camera snapshot"), "camera.jpg")},
                content_type="multipart/form-data",
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["predictions"], [])

    def test_live_frame_does_not_call_wikipedia(self):
        prediction = {"class": "dog", "confidence": 0.91, "x": 20, "y": 30, "width": 10, "height": 12}
        with patch.object(app, "detectar_con_roboflow", return_value={"predictions": [prediction]}), \
                patch.object(app, "consultar_wikipedia") as wikipedia:
            response = self.client.post(
                "/api/detect-frame",
                data={"image": (io.BytesIO(b"camera frame"), "camera-frame.jpg")},
                content_type="multipart/form-data",
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["predictions"][0]["class"], "dog")
        wikipedia.assert_not_called()

    def test_prediction_normalization_keeps_optional_box(self):
        result = app.normalizar_predicciones({
            "predictions": [{"class": "dog", "confidence": 0.9, "x": 12, "y": 20}]
        })
        self.assertEqual(result, [{"class": "dog", "confidence": 0.9, "x": 12, "y": 20}])

    def test_info_route_looks_up_selected_object(self):
        info = {"success": True, "data": {"results": [{"title": "Dog", "url": "https://example.test/dog"}]}}
        with patch.object(app, "consultar_wikipedia", return_value=info) as lookup:
            response = self.client.post("/api/info", json={"class": "dog"})
        self.assertEqual(response.status_code, 200)
        lookup.assert_called_once_with("dog")
        self.assertEqual(response.get_json()["external_info"], info)

    def test_wikipedia_search_uses_public_mediawiki_api(self):
        search_response = unittest.mock.Mock()
        search_response.json.return_value = {"query": {"search": [{"title": "Dog"}]}}
        summary_response = unittest.mock.Mock()
        summary_response.ok = True
        summary_response.json.return_value = {"extract": "A domesticated mammal."}
        with patch.object(app.requests, "get", side_effect=[search_response, summary_response]) as get:
            result = app.consultar_wikipedia("dog")
        self.assertTrue(result["success"])
        self.assertEqual(result["data"]["results"][0]["url"], "https://en.wikipedia.org/wiki/Dog")
        self.assertEqual(result["data"]["summary"], "A domesticated mammal.")
        self.assertEqual(get.call_args_list[0].kwargs["params"]["srsearch"], "dog")
        self.assertIn("User-Agent", get.call_args_list[0].kwargs["headers"])


if __name__ == "__main__":
    unittest.main()
