# Indian place catalog

The journal supplements city-timezones with Indian populated places from the [GeoNames cities500 and administrative divisions downloads](https://download.geonames.org/export/dump/), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The bundled extract uses rounded coordinates, state names, alternate spellings and labels compatible with previously saved pins. Same-name places within a state are distinguished by coordinates.

The Goa town uses the name Canacona from the alternate names of [GeoNames record 1268022](https://www.geonames.org/1268022/). Palolem Beach is a separate destination with coordinates from [Wikidata Q2048357](https://www.wikidata.org/wiki/Q2048357), available under CC0.

Representative pins for [Spiti Valley](https://www.wikidata.org/wiki/Q2682249) and [Swaraj Dweep (Havelock Island)](https://www.wikidata.org/wiki/Q1591501) also use Wikidata coordinates.

To refresh the bundled snapshot, install the project dependencies, download the two GeoNames files, and run the importer from the repository root.

```sh
python3 scripts/import-india-places.py cities500.zip admin1CodesASCII.txt
npm test
```
