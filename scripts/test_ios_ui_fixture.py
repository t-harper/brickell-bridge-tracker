#!/usr/bin/env python3
"""Real HTTP integration tests for the local XCTest fixture (stdlib only)."""

import contextlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import importlib.util
import io
import json
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen


SCRIPT = Path(__file__).with_name("ios-ui-fixture.py")
STATUS = "/api/bridges/brickell"
STATS = STATUS + "/stats?days=7"
HISTORY = STATUS + "/history?days=7&minDurationSec=60"


def parse_date(value):
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)


class FixtureIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SCRIPT.is_file(), "the loopback API fixture must exist")
        spec = importlib.util.spec_from_file_location("ios_ui_fixture", SCRIPT)
        self.fixture = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.fixture)
        self.server = self.fixture.create_server(port=0)
        self.thread = threading.Thread(
            target=self.server.serve_forever,
            kwargs={"poll_interval": 0.01},
            daemon=True,
        )
        self.thread.start()
        self.addCleanup(self.stop_server)
        self.base_url = "http://127.0.0.1:%d" % self.server.server_port

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.assertFalse(self.thread.is_alive(), "fixture server must shut down")

    def request(self, path, method="GET", body=None, raw=None, headers=None):
        data = json.dumps(body).encode("utf-8") if body is not None else raw
        request_headers = {"Content-Type": "application/json"}
        request_headers.update(headers or {})
        request = Request(self.base_url + path, data=data, headers=request_headers, method=method)
        try:
            response = urlopen(request, timeout=2)
        except HTTPError as error:
            response = error
        with response:
            content = response.read()
            self.assertEqual(response.headers.get_content_type(), "application/json")
            self.assertEqual(int(response.headers["Content-Length"]), len(content))
            return response.status, json.loads(content)

    def reset(self, scenario="down"):
        status, body = self.request("/__control/reset", "POST", {"scenario": scenario})
        self.assertEqual(status, 200)
        return body

    def change(self, scenario):
        status, body = self.request("/__control/scenario", "POST", {"scenario": scenario})
        self.assertEqual(status, 200)
        return body

    def audit(self):
        status, body = self.request("/__control/requests")
        self.assertEqual(status, 200)
        return body["requests"]

    def assert_date(self, value):
        self.assertRegex(value, r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
        return parse_date(value)

    def test_health_and_server_binding_are_loopback_only(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")
        self.assertEqual(self.request("/__control/health"), (200, {"ok": True}))
        self.assertEqual(self.audit(), [])
        for host in ("0.0.0.0", "localhost", "127.0.0.2", "::1"):
            with self.subTest(host=host), self.assertRaises(ValueError):
                self.fixture.create_server(host=host, port=0)

    def test_down_state_has_every_required_swift_field_and_metadata(self):
        before = datetime.now(timezone.utc) - timedelta(milliseconds=1)
        self.reset()
        after = datetime.now(timezone.utc)
        status, state = self.request(STATUS)
        self.assertEqual(status, 200)
        self.assertEqual(state["pk"], "BRICKELL")
        self.assertEqual(state["status"], "DOWN")
        self.assertEqual(state["nearbyAlerts"], [])
        self.assertEqual(state["metadata"], {
            "roadway": "US-1", "location": "Brickell Avenue", "county": "Miami-Dade",
            "direction": "N", "waterway": "Miami River", "lat": 25.770124, "lon": -80.190208,
        })
        polled = self.assert_date(state["lastPolledAt"])
        changed = self.assert_date(state["statusChangedAt"])
        self.assertLessEqual(before, polled)
        self.assertLessEqual(polled, after)
        self.assertEqual(polled - changed, timedelta(seconds=600))
        self.assertEqual(self.request(STATUS)[1], state, "responses stay deterministic after reset")

    def test_up_down_unknown_stats_match_status_and_nullable_predictions(self):
        for scenario, current, opens in (("down", "DOWN", 42), ("up", "UP", 43), ("unknown", "UNKNOWN", 42)):
            with self.subTest(scenario=scenario):
                self.reset(scenario)
                state = self.request(STATUS)[1]
                code, stats = self.request(STATS)
                self.assertEqual(code, 200)
                self.assertEqual(state["status"], current)
                self.assertEqual(stats["currentStatus"], current)
                self.assertEqual(stats["windowDays"], 7)
                self.assertEqual(stats["opens"], opens)
                self.assertEqual(stats["avgOpenDurationSec"], 420)
                self.assertEqual(stats["longestOpenDurationSec"], 900)
                self.assertEqual(stats["currentStatusSinceSec"], 600)
                for field in ("predictedNextOpenAt", "predictedNextCloseAt"):
                    self.assertIn(field, stats)
                    if stats[field] is not None:
                        self.assertGreater(self.assert_date(stats[field]), parse_date(state["lastPolledAt"]))
                self.assertIsNone(stats["predictedNextCloseAt"] if current == "DOWN" else stats["predictedNextOpenAt"])
                if current == "UNKNOWN":
                    self.assertIsNone(stats["predictedNextCloseAt"])

    def test_history_has_two_descending_coherent_transitions_for_each_phase(self):
        for scenario, transitions in (("down", [("UP", "DOWN"), ("DOWN", "UP")]),
                                      ("up", [("DOWN", "UP"), ("UP", "DOWN")])):
            with self.subTest(scenario=scenario):
                self.reset(scenario)
                state = self.request(STATUS)[1]
                code, history_response = self.request(HISTORY)
                self.assertEqual(code, 200)
                self.assertIsInstance(history_response, dict)
                self.assertIn("events", history_response)
                history = history_response["events"]
                self.assertEqual(len(history), 2)
                self.assertEqual([(row["from"], row["to"]) for row in history], transitions)
                latest, preceding = history
                self.assertEqual(latest["ts"], state["statusChangedAt"])
                self.assertEqual(latest["to"], state["status"])
                elapsed = self.assert_date(latest["ts"]) - self.assert_date(preceding["ts"])
                self.assertGreater(elapsed.total_seconds(), 0)
                self.assertEqual(latest["durationOfPrevStateSec"], int(elapsed.total_seconds()))
                self.assertEqual(preceding["to"], latest["from"])
                self.assertIsInstance(preceding["durationOfPrevStateSec"], int)
                self.assertGreater(preceding["durationOfPrevStateSec"], 0)

    def test_partial_failures_only_fail_the_selected_endpoint(self):
        for scenario, statuses in (("history-error", [200, 200, 500]),
                                   ("stats-error", [200, 500, 200]),
                                   ("all-error", [503, 503, 503])):
            with self.subTest(scenario=scenario):
                self.reset(scenario)
                responses = [self.request(path) for path in (STATUS, STATS, HISTORY)]
                self.assertEqual([item[0] for item in responses], statuses)
                if scenario != "all-error":
                    self.assertEqual(responses[0][1]["status"], "DOWN")
                self.assertEqual(len(self.audit()), 3, "failed API reads are also audited")
                self.assertEqual(self.request("/__control/health"), (200, {"ok": True}))

    def test_empty_history_is_a_successful_empty_envelope_with_down_state(self):
        self.reset("empty-history")
        self.assertEqual(self.request(HISTORY), (200, {"events": []}))
        self.assertEqual(self.request(STATUS)[1]["status"], "DOWN")
        self.assertEqual(self.request(STATS)[1]["opens"], 42)

    def test_audit_records_method_path_and_parsed_query_only(self):
        self.reset()
        self.request(HISTORY + "&days=14&empty=&limit=2&token=SECRET_QUERY&custom=PRIVATE")
        self.request(STATS)
        self.assertEqual(self.audit(), [
            {"method": "GET", "path": STATUS + "/history",
             "query": {"days": ["7", "14"], "minDurationSec": ["60"], "limit": ["2"]}},
            {"method": "GET", "path": STATUS + "/stats", "query": {"days": ["7"]}},
        ])

    def test_scenario_change_preserves_audit_and_base_time_reset_clears_it(self):
        self.reset()
        original_time = self.request(STATUS)[1]["lastPolledAt"]
        self.change("up")
        changed = self.request(STATUS)[1]
        self.assertEqual(changed["status"], "UP")
        self.assertEqual(changed["lastPolledAt"], original_time)
        self.assertEqual(len(self.audit()), 2)
        self.reset("unknown")
        self.assertEqual(self.audit(), [])
        self.assertEqual(self.request(STATUS)[1]["status"], "UNKNOWN")

    def test_local_api_writes_are_captured_without_bodies_or_tokens_or_logs(self):
        self.reset("all-error")
        output = io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            for method, route in (("POST", "/api/devices"), ("POST", "/api/activities"),
                                  ("DELETE", "/api/devices/fake-device")):
                self.assertEqual(self.request(route, method,
                    {"token": "SECRET_BODY", "url": "https://invalid.invalid/never-forward"},
                    headers={"Authorization": "Bearer SECRET_HEADER"}), (200, {}))
        self.assertEqual(self.audit(), [
            {"method": "POST", "path": "/api/devices", "query": {}},
            {"method": "POST", "path": "/api/activities", "query": {}},
            {"method": "DELETE", "path": "/api/devices/fake-device", "query": {}},
        ])
        self.assertEqual(output.getvalue(), "")

    def test_invalid_controls_return_400_without_mutating_scenario_or_audit(self):
        self.reset("up")
        self.request(STATUS)
        for route in ("/__control/reset", "/__control/scenario"):
            for raw in (b"not-json", b"{}", b"[]", b"null", b'{"scenario": 1}',
                        b'{"scenario": "production"}', b'{}\xff', b""):
                with self.subTest(route=route, raw=raw):
                    status, _ = self.request(route, "POST", raw=raw)
                    self.assertEqual(status, 400)
        self.assertEqual(len(self.audit()), 1)
        self.assertEqual(self.request(STATUS)[1]["status"], "UP")

    def test_unknown_routes_are_json_404_and_api_routes_still_audited(self):
        for path, method in (("/missing", "GET"), ("/__control/missing", "POST"),
                             ("/__control/reset", "GET"), ("/api/missing", "GET")):
            with self.subTest(path=path, method=method):
                self.assertEqual(self.request(path, method)[0], 404)
        self.assertEqual(self.audit(), [{"method": "GET", "path": "/api/missing", "query": {}}])

    def test_unknown_api_route_stays_404_during_an_outage(self):
        self.reset("all-error")
        self.assertEqual(self.request("/api/missing")[0], 404)
        self.assertEqual(self.audit(), [{"method": "GET", "path": "/api/missing", "query": {}}])

    def test_threaded_requests_are_all_audited(self):
        self.reset()
        with ThreadPoolExecutor(max_workers=4) as pool:
            responses = list(pool.map(self.request, [STATS] * 12))
        self.assertEqual([response[0] for response in responses], [200] * 12)
        self.assertEqual(self.audit(), [
            {"method": "GET", "path": STATUS + "/stats", "query": {"days": ["7"]}}
        ] * 12)

    def test_cli_serves_loopback_and_exits_successfully_on_sigterm(self):
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
        process = subprocess.Popen(
            [sys.executable, str(SCRIPT), "--port", str(port)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        try:
            ready = False
            for _ in range(100):
                if process.poll() is not None:
                    break
                try:
                    with urlopen("http://127.0.0.1:%d/__control/health" % port, timeout=0.1) as response:
                        ready = json.load(response) == {"ok": True}
                    if ready:
                        break
                except OSError:
                    time.sleep(0.02)
            self.assertTrue(ready, "CLI fixture must expose its health endpoint")
            process.terminate()
            stdout, stderr = process.communicate(timeout=3)
            self.assertEqual(process.returncode, 0)
            self.assertEqual((stdout, stderr), (b"", b""))
            with self.assertRaises(OSError):
                socket.create_connection(("127.0.0.1", port), timeout=0.2)
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate(timeout=3)


if __name__ == "__main__":
    unittest.main()
