"""Print an available iPhone simulator UDID from simctl's device JSON."""

import json
import sys

devices = json.load(sys.stdin)["devices"]
for runtime in sorted(devices, key=lambda key: tuple(
    int(part) for part in key.split("iOS-")[-1].split("-")
) if "iOS-" in key else (), reverse=True):
    iphones = [device for device in devices[runtime] if device["name"].startswith("iPhone")]
    if iphones:
        preferred = next((device for device in iphones if device["name"] == "iPhone 16"), iphones[0])
        print(preferred["udid"])
        break
else:
    sys.exit("No available iPhone simulators")
