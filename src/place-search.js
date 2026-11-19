function fold(text) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function indexPlaces(cities) {
  return cities.map(([label, , , aliases = []]) => ({
    label,
    text: fold(label),
    name: fold(label.split(",")[0]),
    aliases: aliases.map(alias => ({ alias, text: fold(alias) })),
  }));
}

export function findPlaces(index, input) {
  const query = fold(input.trim());
  if (!query) return [];
  const tokens = query.split(/[\s,]+/).filter(Boolean);
  const matches = [];
  for (const place of index) {
    const alternate = place.aliases.find(alias => alias.text === query)
      ?? place.aliases.find(alias => alias.text.startsWith(query));
    let rank;
    if (place.name === query || place.text === query) rank = 0;
    else if (alternate?.text === query) rank = 1;
    else if (place.text.startsWith(query)) rank = 2;
    else if (alternate) rank = 3;
    else if (tokens.length && tokens.every(token => place.text.includes(token))) rank = 4;
    else continue;
    matches.push({ label: place.label, alias: alternate?.alias, rank });
  }
  return matches.sort((a, b) => a.rank - b.rank).slice(0, 40);
}
