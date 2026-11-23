"""Run: uv run python tests/test_supabase_auth.py (also works under pytest)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException

from app.services.supabase_auth import login_outcome, resend_outcome, signup_outcome


def raises(fn, status):
    try:
        fn()
    except HTTPException as e:
        assert e.status_code == status, (e.status_code, status)
        return
    raise AssertionError(f"expected HTTP {status}")


def test_signup():
    # Confirmation on: user returned, no session -> needs confirmation.
    assert signup_outcome(200, {"id": "u1", "identities": [{"id": "i"}]}) is None
    # Confirmation off: session returned.
    s = signup_outcome(200, {"access_token": "a", "refresh_token": "r", "user": {"identities": [{"id": "i"}]}})
    assert (s.access_token, s.refresh_token) == ("a", "r")
    # Existing email with confirmation on: fake user with no identities -> 409, not a silent success.
    raises(lambda: signup_outcome(200, {"id": "fake", "identities": []}), 409)
    # Existing email with confirmation off.
    raises(lambda: signup_outcome(422, {"code": 422, "error_code": "user_already_exists"}), 409)
    raises(lambda: signup_outcome(422, {"error_code": "weak_password", "msg": "Password too weak"}), 422)
    raises(lambda: signup_outcome(429, {"error_code": "over_email_send_rate_limit"}), 429)
    raises(lambda: signup_outcome(500, {}), 502)


def test_login():
    s, user = login_outcome(200, {"access_token": "a", "refresh_token": "r", "user": {"user_metadata": {"school_name": "X"}}})
    assert s.access_token == "a" and user["user_metadata"]["school_name"] == "X"
    raises(lambda: login_outcome(400, {"error_code": "invalid_credentials"}), 401)
    raises(lambda: login_outcome(400, {"error_code": "email_not_confirmed"}), 403)
    raises(lambda: login_outcome(400, {"error": "invalid_grant", "error_description": "Email not confirmed"}), 403)
    raises(lambda: login_outcome(400, {"error": "invalid_grant", "error_description": "Invalid login credentials"}), 401)
    raises(lambda: login_outcome(429, {}), 429)
    raises(lambda: login_outcome(503, {}), 502)


def test_resend():
    resend_outcome(200, {})                                            # sent
    resend_outcome(400, {"error_code": "email_not_found"})             # unknown email: same answer
    resend_outcome(422, {"error_code": "email_address_invalid"})       # nothing leaked either
    raises(lambda: resend_outcome(429, {"error_code": "over_email_send_rate_limit"}), 429)
    raises(lambda: resend_outcome(400, {"error_code": "over_email_send_rate_limit"}), 429)
    raises(lambda: resend_outcome(503, {}), 502)


if __name__ == "__main__":
    test_signup()
    test_login()
    test_resend()
    print("ok")
