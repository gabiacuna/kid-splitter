"""Shared slowapi limiter. Every router and app.state uses this one instance."""
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
