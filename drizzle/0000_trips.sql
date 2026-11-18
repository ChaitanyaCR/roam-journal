CREATE TABLE trips (
  id TEXT NOT NULL,
  owner TEXT NOT NULL,
  title TEXT NOT NULL,
  destination TEXT NOT NULL,
  date TEXT NOT NULL,
  story TEXT NOT NULL,
  photos TEXT NOT NULL,
  PRIMARY KEY (owner, id)
);
--> statement-breakpoint
CREATE INDEX trips_owner_date ON trips (owner, date DESC, id DESC);
