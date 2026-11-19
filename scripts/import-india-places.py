"""Refresh the bundled Indian place supplement from GeoNames cities500.zip and admin1CodesASCII.txt.

Run from the repository root: python3 scripts/import-india-places.py cities500.zip admin1CodesASCII.txt
Data sources and attribution are in scripts/data/README.md.
"""
import csv
import io
import json
import math
import sys
import unicodedata
import zipfile
from collections import Counter
from pathlib import Path


def folded(text):
    return "".join(c for c in unicodedata.normalize("NFKD", text.casefold()) if not unicodedata.combining(c))


with open(sys.argv[2], encoding="utf8") as source:
    states = {code: name for code, name, *_ in csv.reader(source, delimiter="\t") if code.startswith("IN.")}

legacy = json.loads(Path("node_modules/city-timezones/data/cityMap.json").read_text())
legacy = [city for city in legacy if city["iso2"] == "IN"]
places = []
with zipfile.ZipFile(sys.argv[1]) as archive, archive.open("cities500.txt") as source:
    for row in csv.reader(io.TextIOWrapper(source, encoding="utf8"), delimiter="\t", quoting=csv.QUOTE_NONE):
        if row[8] != "IN" or row[6] != "P" or row[0] == "6697165":
            # The second Canacona record assigns the Goa locality to Karnataka.
            continue
        name = "Canacona" if row[0] == "1268022" else row[2] or row[1]
        names = {name, row[1], row[2], *row[3].split(",")} - {""}
        lat, lng = map(float, row[4:6])
        label = ", ".join([name, states["IN." + row[10]], "India"])
        # Reuse existing pin labels where the name and approximate position agree.
        keys = {folded(n) for n in names}
        nearby = [c for c in legacy if abs(c["lat"] - lat) < .2 and abs(c["lng"] - lng) < .2
                  and folded(c["city"]) in keys]
        if nearby:
            city = min(nearby, key=lambda c: math.hypot(c["lat"] - lat, c["lng"] - lng))
            label = ", ".join(dict.fromkeys(filter(None, [city["city"], city["province"], city["country"]])))
        aliases = sorted(n for n in names if folded(n) != folded(label.split(",")[0]))
        places.append([label, round(lat, 4), round(lng, 4), aliases])

places.append(["Palolem Beach, Goa, India", 15.0089, 74.0228, ["Palolem"]])
places.append(["Spiti Valley, Himachal Pradesh, India", 32.2469, 78.0522, ["Spiti"]])
places.append(["Swaraj Dweep, Andaman and Nicobar Islands, India", 11.9667, 93.0000,
               ["Havelock Island", "Havelock Islands", "Havlock Islands", "Swaraj Dwip"]])
counts = Counter(place[0] for place in places)
for place in places:
    if counts[place[0]] > 1:
        name, region = place[0].split(", ", 1)
        place[0] = f"{name} ({place[1]:.4f}, {place[2]:.4f}), {region}"
output = Path("scripts/data/india-places.json")
with output.open("w", encoding="utf8") as dest:
    dest.write("[\n" + ",\n".join(json.dumps(p, ensure_ascii=False, separators=(",", ":")) for p in sorted(places)) + "\n]\n")
