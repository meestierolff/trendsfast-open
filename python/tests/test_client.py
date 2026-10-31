"""Offline tests against a local http.server fake of the V3 API. No socket leaves 127.0.0.1."""
import json
import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import trendsfast
from trendsfast import TrendsFast

KEY = "tf_test_Fixture1.fixture-only-key-not-for-production-000000000000"
CONTEXT_ID = "44444444-4444-4444-8444-444444444444"
FIXTURES = Path(__file__).parent / "fixtures"
CONTEXT = {
    "version": "trend-context-v3",
    "context": {"kind": "CONFIRMED_CONTEXT", "context_id": CONTEXT_ID, "revision": 3, "fields": []},
}


def fixture(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def result_for(call, name="customers-result.json"):
    result = fixture(name)
    if call["body"]:
        result["request_id"] = call["body"]["request_id"]
        result["operation"] = call["path"].rsplit("/", 1)[-1]
    else:
        result["request_id"] = call["path"].rsplit("/", 1)[-1]
    return result


class FakeApi:
    """Records each call and answers with ``handler(call, index)`` -> (status, body, headers),
    or "drop" to close the connection without an answer."""

    def __init__(self, handler):
        self.calls = []
        api = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _serve(self):
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length) if length else b""
                url = urlsplit(self.path)
                call = {
                    "method": self.command,
                    "path": url.path,
                    "query": {k: v[0] for k, v in parse_qs(url.query).items()},
                    "headers": {k.lower(): v for k, v in self.headers.items()},
                    "body": json.loads(raw) if raw else None,
                }
                api.calls.append(call)
                answer = handler(call, len(api.calls) - 1)
                if answer == "drop":
                    self.close_connection = True
                    return
                status, body, headers = answer if len(answer) == 3 else (*answer, {})
                payload = json.dumps(body).encode() if body is not None else b""
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                for name, value in headers.items():
                    self.send_header(name, value)
                self.end_headers()
                self.wfile.write(payload)

            do_GET = _serve
            do_POST = _serve

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.base = "http://127.0.0.1:%d" % self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class ApiTestCase(unittest.TestCase):
    def serve(self, handler):
        api = FakeApi(handler)
        self.addCleanup(api.close)
        return api, TrendsFast(KEY, api.base, env={}, sleep=lambda seconds: self.waits.append(seconds))

    def setUp(self):
        self.waits = []


class CatalogTest(unittest.TestCase):
    def test_prices_and_version(self):
        self.assertEqual(
            [(p["id"], p["command"], p["credits"]) for p in trendsfast.PRODUCTS],
            [("customers", "customers", 10), ("niche", "trending", 25), ("competitors", "competitors", 30), ("formats", "formats", 20), ("search", "search", 35)],
        )
        self.assertEqual(trendsfast.READ_CREDITS, {"global": 1, "niche": 3, "ask": 5, "discover": 5})
        pyproject = (Path(__file__).parent.parent / "pyproject.toml").read_text(encoding="utf-8")
        self.assertIn('version = "%s"' % trendsfast.__version__, pyproject)
        self.assertIn("dependencies = []", pyproject)


class CredentialsTest(unittest.TestCase):
    def test_precedence_option_env_stored(self):
        with tempfile.TemporaryDirectory() as home:
            path = Path(home, ".config", "trendsfast", "credentials.json")
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({"api_key": KEY, "base_url": "http://127.0.0.1:4010"}))
            env = {"HOME": home}
            self.assertEqual(TrendsFast(env=env).key_source, "stored")
            self.assertEqual(TrendsFast(env=env).base_url, "http://127.0.0.1:4010")
            self.assertEqual(TrendsFast(env=dict(env, TRENDSFAST_API_KEY=KEY)).key_source, "env")
            self.assertEqual(TrendsFast(env=dict(env, TRENDSFAST_API_KEY=KEY)).base_url, "https://trendsfast.com")
            self.assertEqual(TrendsFast(KEY, env=env).key_source, "option")
            self.assertEqual(TrendsFast(env={"HOME": os.path.join(home, "none")}).key_source, "none")
            xdg = Path(home, "xdg", "trendsfast")
            xdg.mkdir(parents=True)
            (xdg / "credentials.json").write_text(json.dumps({"api_key": KEY}))
            self.assertEqual(TrendsFast(env={"HOME": os.path.join(home, "none"), "XDG_CONFIG_HOME": str(Path(home, "xdg"))}).key_source, "stored")

    def test_base_url_is_https_or_loopback(self):
        for ok in ("https://trendsfast.com", "https://trendsfast.com/", "http://127.0.0.1:8080", "http://localhost:3000"):
            TrendsFast(KEY, ok, env={})
        for bad in ("http://trendsfast.com", "https://trendsfast.com/v3", "https://u:p@trendsfast.com", "ftp://x"):
            with self.assertRaises(trendsfast.InvalidRequestError, msg=bad):
                TrendsFast(KEY, bad, env={})

    def test_repr_never_shows_the_key(self):
        self.assertNotIn(KEY, repr(TrendsFast(KEY, env={})))

    def test_no_key_refuses_before_sending(self):
        with self.assertRaises(trendsfast.AuthRequiredError) as caught:
            TrendsFast(env={"HOME": "/nonexistent"}).wallet()
        self.assertEqual(caught.exception.exit_code, 2)


class ProductTest(ApiTestCase):
    def test_reads_context_then_runs_the_product_once_at_its_tariff(self):
        api, tf = self.serve(lambda call, i: (200, CONTEXT) if call["path"] == "/v3/trends/context" else (200, result_for(call)))
        result = tf.customers()
        self.assertEqual([(c["method"], c["path"]) for c in api.calls], [("GET", "/v3/trends/context"), ("POST", "/v3/trends/niche")])
        post = api.calls[1]
        self.assertEqual(post["body"]["max_credits"], 10)
        self.assertEqual(post["body"]["input"], {"product": "customers", "context_id": CONTEXT_ID})
        self.assertEqual(post["headers"]["authorization"], "Bearer " + KEY)
        self.assertTrue(post["headers"]["user-agent"].startswith("trendsfast-python/"))
        self.assertEqual(result["request_id"], post["body"]["request_id"])

    def test_filters_go_under_input_filters_with_the_api_names(self):
        api, tf = self.serve(lambda call, i: (200, result_for(call)))
        tf.trending(context_id=CONTEXT_ID, lookback_hours=168, platforms=["TIKTOK"], limit=5, request_id="00000000-0000-4000-8000-000000000001")
        self.assertEqual(
            api.calls[0]["body"],
            {
                "request_id": "00000000-0000-4000-8000-000000000001",
                "max_credits": 25,
                "input": {"product": "niche", "context_id": CONTEXT_ID, "filters": {"platforms": ["TIKTOK"], "lookback_hours": 168, "limit": 5}},
            },
        )

    def test_unknown_option_is_a_type_error(self):
        _, tf = self.serve(lambda call, i: (200, {}))
        with self.assertRaises(TypeError):
            tf.customers(lookback=5)

    def test_no_confirmed_context_stops_before_paying(self):
        api, tf = self.serve(lambda call, i: (200, {"version": "trend-context-v3", "context": None}))
        with self.assertRaises(trendsfast.ProductRequiresContextError) as caught:
            tf.formats()
        self.assertEqual(caught.exception.exit_code, 1)
        self.assertEqual([c["path"] for c in api.calls], ["/v3/trends/context"])

    def test_index_reads_send_the_api_shapes(self):
        api, tf = self.serve(lambda call, i: (200, result_for(call, "ask-result.json" if call["path"].endswith("/ask") else "global-result.json")))
        tf.global_trends(lookback_hours=24, limit=5)
        tf.niche("Scheduling software for dental clinics", limit=10)
        tf.ask("What are dentists stuck on?", context_id=CONTEXT_ID)
        tf.discover("What is rising?", scope=["global"], channels=["video"])
        self.assertEqual(
            [(c["path"], c["body"]["max_credits"], c["body"]["input"]) for c in api.calls],
            [
                ("/v3/trends/global", 1, {"lookback_hours": 24, "limit": 5}),
                ("/v3/trends/niche", 3, {"niche": {"description": "Scheduling software for dental clinics"}, "filters": {"limit": 10}}),
                ("/v3/trends/ask", 5, {"question": "What are dentists stuck on?", "context_id": CONTEXT_ID}),
                ("/v3/trends/discover", 5, {"question": "What is rising?", "scope": ["global"], "channels": ["video"]}),
            ],
        )


class ReadTest(ApiTestCase):
    def test_quote_result_recover_history(self):
        def handler(call, i):
            if call["path"] == "/v3/trends/quote":
                return 200, {"version": "trends-credit-quote-v3", "operation": call["query"]["operation"], "credits": 10, "max_credits": 10, "catalog_version": "x", "new_research": False, "available": True}
            if call["path"].startswith("/v3/trends/results/"):
                result = fixture("global-result.json")
                result["result_id"] = call["path"].rsplit("/", 1)[-1]
                return 200, result
            if call["path"].startswith("/v3/trends/requests/"):
                return 200, result_for(call, "global-result.json")
            return 200, {"version": "trends-history-v3", "results": [], "next_cursor": None}

        api, tf = self.serve(handler)
        self.assertEqual(tf.quote("niche", "customers")["credits"], 10)
        with self.assertRaises(trendsfast.InvalidRequestError):
            tf.quote("global", "customers")
        tf.result("33333333-3333-4333-8333-333333333333", "next-page")
        tf.recover("22222222-2222-4222-8222-222222222222")
        tf.history("cursor-1")
        self.assertEqual(
            [(c["path"], c["query"]) for c in api.calls],
            [
                ("/v3/trends/quote", {"operation": "niche", "product": "customers"}),
                ("/v3/trends/results/33333333-3333-4333-8333-333333333333", {"cursor": "next-page"}),
                ("/v3/trends/requests/22222222-2222-4222-8222-222222222222", {}),
                ("/v3/trends/history", {"cursor": "cursor-1"}),
            ],
        )

    def test_recover_without_a_record_says_it_never_started(self):
        _, tf = self.serve(lambda call, i: (404, {"error": "NOT_FOUND"}))
        with self.assertRaises(trendsfast.InvalidRequestError) as caught:
            tf.recover("22222222-2222-4222-8222-222222222222")
        self.assertIn("no record", str(caught.exception))

    def test_a_free_read_without_an_answer_is_a_service_failure(self):
        api = FakeApi(lambda call, i: "drop")
        self.addCleanup(api.close)
        tf = TrendsFast(KEY, api.base, env={}, max_retries=1, sleep=lambda s: None)
        with self.assertRaises(trendsfast.ServiceUnavailableError) as caught:
            tf.wallet()
        self.assertEqual(caught.exception.exit_code, 7)
        self.assertEqual(len(api.calls), 2)

    def test_a_redirect_is_not_followed(self):
        api, tf = self.serve(lambda call, i: (302, None, {"Location": "https://elsewhere.example/"}))
        with self.assertRaises(trendsfast.ServiceUnavailableError) as caught:
            tf.wallet()
        self.assertEqual(caught.exception.code, "REDIRECT_NOT_FOLLOWED")
        self.assertEqual(len(api.calls), 1)


class ErrorTest(ApiTestCase):
    CASES = [
        (401, "AUTH_REQUIRED", "AuthRequiredError", 2),
        (403, "FORBIDDEN", "InsufficientScopeError", 2),
        (403, "INSUFFICIENT_SCOPE", "InsufficientScopeError", 2),
        (402, "INSUFFICIENT_CREDITS", "InsufficientCreditsError", 3),
        (402, "CREDIT_QUOTE_EXCEEDS_LIMIT", "CreditQuoteExceedsLimitError", 3),
        (409, "IDEMPOTENCY_CONFLICT", "IdempotencyConflictError", 4),
        (409, "CONTEXT_NOT_CURRENT", "ContextNotCurrentError", 4),
        (400, "PRODUCT_REQUIRES_CONTEXT", "ProductRequiresContextError", 1),
        (410, "RESULT_UNAVAILABLE", "ResultUnavailableError", 4),
        (409, "REQUEST_IN_PROGRESS", "OutcomeUnconfirmedError", 6),
    ]

    def test_each_code_maps_to_its_class_and_exit_code_without_retrying(self):
        for status, code, name, exit_code in self.CASES:
            with self.subTest(code=code):
                api, tf = self.serve(lambda call, i, s=status, c=code: (s, {"error": c, "retryable": False}))
                with self.assertRaises(trendsfast.TrendsFastError) as caught:
                    tf.global_trends()
                error = caught.exception
                self.assertEqual(type(error).__name__, name)
                self.assertEqual((error.code, error.status, error.exit_code), (code, status, exit_code))
                self.assertTrue(error.request_id)
                self.assertNotIn(KEY, str(error))
                self.assertEqual(len(api.calls), 1)

    def test_429_is_retried_with_the_same_request_id_honouring_retry_after(self):
        api, tf = self.serve(lambda call, i: (429, {"error": "RATE_LIMITED"}, {"Retry-After": "2"}))
        with self.assertRaises(trendsfast.RateLimitedError) as caught:
            tf.global_trends()
        self.assertEqual(caught.exception.retry_after_seconds, 2)
        self.assertEqual(caught.exception.exit_code, 5)
        self.assertEqual(len(api.calls), 4)
        self.assertEqual(self.waits, [2.0, 2.0, 2.0])
        self.assertEqual(len({c["body"]["request_id"] for c in api.calls}), 1)


class LostAnswerTest(ApiTestCase):
    def test_a_dropped_answer_is_retried_with_the_same_id_then_read_back_once(self):
        api, tf = self.serve(lambda call, i: "drop" if call["method"] == "POST" else (200, result_for(call, "global-result.json")))
        result = tf.global_trends()
        posts = [c for c in api.calls if c["method"] == "POST"]
        reads = [c for c in api.calls if c["method"] == "GET"]
        self.assertEqual(len(posts), 4)
        self.assertEqual(len({c["body"]["request_id"] for c in posts}), 1)
        self.assertEqual(len(reads), 1)
        self.assertEqual(reads[0]["path"], "/v3/trends/requests/%s" % posts[0]["body"]["request_id"])
        self.assertEqual(result["request_id"], posts[0]["body"]["request_id"])

    def test_still_unknown_after_the_read_raises_outcome_unconfirmed(self):
        api, tf = self.serve(lambda call, i: (503, {"error": "REQUEST_OUTCOME_UNCONFIRMED"}) if call["method"] == "POST" else (404, {"error": "NOT_FOUND"}))
        tf._max_retries = 0
        with self.assertRaises(trendsfast.OutcomeUnconfirmedError) as caught:
            tf.customers(context_id=CONTEXT_ID)
        error = caught.exception
        self.assertEqual(error.exit_code, 6)
        self.assertEqual(error.request_id, api.calls[0]["body"]["request_id"])
        self.assertIn("trendsfast request %s" % error.request_id, str(error))
        self.assertEqual([c["method"] for c in api.calls], ["POST", "GET"])

    def test_a_503_is_recovered_by_the_same_request_id(self):
        api, tf = self.serve(lambda call, i: (503, {"error": "REQUEST_OUTCOME_UNCONFIRMED"}) if i == 0 else (200, result_for(call, "global-result.json")))
        result = tf.global_trends()
        self.assertEqual(len(api.calls), 2)
        self.assertEqual(api.calls[1]["body"]["request_id"], api.calls[0]["body"]["request_id"])
        self.assertEqual(result["request_id"], api.calls[0]["body"]["request_id"])


if __name__ == "__main__":
    unittest.main()
