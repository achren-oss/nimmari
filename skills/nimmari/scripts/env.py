"""Shared configuration: NIMMARI_* first, deprecated PUUMERKKI_* aliases second."""
import os


def nimmari_env(name, default=""):
    return os.environ.get("NIMMARI_" + name, os.environ.get("PUUMERKKI_" + name, default))
