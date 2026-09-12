"""Put the package on the path when pytest is run from `python/` without an install."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
