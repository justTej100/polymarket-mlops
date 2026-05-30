"""Startup / health-wait utilities."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from src.startup import print_service_urls, service_urls, wait_for_http_health


def test_wait_for_http_health_succeeds_when_ready():
    mock_resp = MagicMock()
    mock_resp.status = 200
    mock_resp.__enter__ = MagicMock(return_value=mock_resp)
    mock_resp.__exit__ = MagicMock(return_value=False)

    with patch("src.startup.urllib.request.urlopen", return_value=mock_resp) as urlopen:
        assert wait_for_http_health("http://localhost:8000", timeout_seconds=1.0) is True
        urlopen.assert_called()


def test_wait_for_http_health_times_out():
    with patch("src.startup.urllib.request.urlopen", side_effect=OSError("refused")):
        assert (
            wait_for_http_health(
                "http://localhost:8000",
                timeout_seconds=0.3,
                poll_interval_seconds=0.1,
            )
            is False
        )


def test_service_urls_defaults():
    urls = service_urls()
    assert urls["api_docs"] == "http://localhost:8000/docs"
    assert urls["grafana"] == "http://localhost:3000"
    assert urls["mlflow"] == "http://localhost:5000"
    assert "targets" in urls["prometheus_targets"]


def test_print_service_urls_writes_banner(capsys):
    print_service_urls()
    out = capsys.readouterr().out
    assert "polymarket-mlops" in out
    assert "http://localhost:8000/docs" in out
    assert "http://localhost:3000" in out
